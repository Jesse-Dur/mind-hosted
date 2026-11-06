import { describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  GITHUB_ACTIONS_BOT_ID,
  GITHUB_ACTIONS_BOT_LOGIN,
  KODY_BOT_ID,
  KODY_BOT_LOGIN,
  KODY_STATUS_CONTEXT,
  classifyPolicy,
  currentKodyReviewOutcome,
  currentReviewState,
  currentRevisionTime,
  hasCurrentApproval,
  kodyApprovalPolicy,
  kodyApprovalStatus,
  kodyCommitStatus,
  kodyReviewPassed,
  latestTestResult,
  mergeCurrentRevision,
  publishKodyApprovalStatus,
  publishKodyApprovalStatusSafely,
  trustedClassification,
} from "./dependency-gate.mjs";

describe("dependency policy classification", () => {
  test("auto-merges routine patches and minors", () => {
    expect(classifyPolicy({ updateLevel: "patch" })).toEqual({
      kind: "patch",
      autoMerge: true,
      needsMaintainerApproval: false,
      requiresKodyReview: true,
    });
    expect(classifyPolicy({ updateLevel: "minor" })).toEqual({
      kind: "minor",
      autoMerge: true,
      needsMaintainerApproval: false,
      requiresKodyReview: true,
    });
  });

  test("security bypasses the semver gate", () => {
    expect(
      classifyPolicy({
        updateLevel: "major",
        security: true,
      }),
    ).toEqual({
      kind: "security",
      autoMerge: true,
      needsMaintainerApproval: false,
      requiresKodyReview: true,
    });
  });

  test("GitHub Actions always stays manual, including security updates", () => {
    expect(
      classifyPolicy({
        updateLevel: "major",
        security: true,
        githubActions: true,
      }),
    ).toEqual({
      kind: "actions",
      autoMerge: false,
      needsMaintainerApproval: false,
      requiresKodyReview: true,
    });
  });

  test("routine majors require the maintainer's approval", () => {
    expect(classifyPolicy({ updateLevel: "major" })).toEqual({
      kind: "major",
      autoMerge: false,
      needsMaintainerApproval: true,
      requiresKodyReview: true,
    });
  });

  test("accepts classification only from GitHub Actions for the current SHA", () => {
    const classification = {
      headSha: "current-sha",
      updateLevel: "major",
      security: true,
      githubActions: false,
      securityLookupAvailable: true,
    };
    const trustedComment = {
      user: {
        id: GITHUB_ACTIONS_BOT_ID,
        login: GITHUB_ACTIONS_BOT_LOGIN,
      },
      body: `<!-- mind-dependency-classification:${JSON.stringify(
        classification,
      )} -->`,
    };

    expect(trustedClassification([trustedComment], "current-sha")).toEqual(
      classification,
    );
    expect(trustedClassification([trustedComment], "new-sha")).toBeNull();
    expect(
      trustedClassification(
        [
          {
            ...trustedComment,
            user: { id: 123, login: GITHUB_ACTIONS_BOT_LOGIN },
          },
        ],
        "current-sha",
      ),
    ).toBeNull();
  });

  test("requires Kody for automatic and manual dependency policies", () => {
    const automaticPolicy = classifyPolicy({ updateLevel: "minor" });
    const manualPolicy = classifyPolicy({ updateLevel: "major" });

    expect(kodyReviewPassed(automaticPolicy, "PENDING")).toBe(false);
    expect(kodyReviewPassed(automaticPolicy, "CHANGES_REQUESTED")).toBe(false);
    expect(kodyReviewPassed(manualPolicy, "PENDING")).toBe(false);
    expect(kodyReviewPassed(manualPolicy, "APPROVED")).toBe(true);
  });
});

describe("current revision checks", () => {
  const pullRequest = {
    created_at: "2026-07-27T08:50:00Z",
    head: { sha: "current-sha" },
  };
  const commit = {
    commit: {
      author: { date: "2026-07-27T08:55:39Z" },
      committer: { date: "2026-07-27T08:55:39Z" },
    },
  };

  test("uses the latest matching head event as the revision time", () => {
    const revisionTime = currentRevisionTime({
      pullRequest,
      commit,
      timelineEvents: [
        {
          event: "head_ref_force_pushed",
          commit_id: "old-sha",
          created_at: "2026-07-27T09:00:00Z",
        },
        {
          event: "head_ref_force_pushed",
          commit_id: "current-sha",
          created_at: "2026-07-27T08:55:40Z",
        },
      ],
    });

    expect(revisionTime.toISOString()).toBe("2026-07-27T08:55:40.000Z");
  });

  test("requires the latest decisive review on the current SHA", () => {
    const reviews = [
      {
        user: { login: "Jesse-Dur" },
        commit_id: "old-sha",
        state: "APPROVED",
        submitted_at: "2026-07-27T09:00:00Z",
      },
      {
        user: { login: "Jesse-Dur" },
        commit_id: "current-sha",
        state: "APPROVED",
        submitted_at: "2026-07-27T09:01:00Z",
      },
      {
        user: { login: "Jesse-Dur" },
        commit_id: "current-sha",
        state: "CHANGES_REQUESTED",
        submitted_at: "2026-07-27T09:02:00Z",
      },
    ];

    expect(hasCurrentApproval(reviews, "Jesse-Dur", "current-sha")).toBe(false);
    expect(
      hasCurrentApproval(reviews.slice(0, 2), "Jesse-Dur", "current-sha"),
    ).toBe(true);
  });

  test("trusts only Kody's current-revision approval", () => {
    const currentApproval = {
      user: { id: KODY_BOT_ID, login: KODY_BOT_LOGIN },
      commit_id: "current-sha",
      state: "APPROVED",
      submitted_at: "2026-07-27T09:03:00Z",
    };

    expect(
      currentReviewState(
        [currentApproval],
        KODY_BOT_LOGIN,
        "current-sha",
        KODY_BOT_ID,
      ),
    ).toBe("APPROVED");
    expect(
      currentReviewState(
        [{ ...currentApproval, commit_id: "old-sha" }],
        KODY_BOT_LOGIN,
        "current-sha",
        KODY_BOT_ID,
      ),
    ).toBe("PENDING");
    expect(
      currentReviewState(
        [
          currentApproval,
          {
            ...currentApproval,
            state: "CHANGES_REQUESTED",
            submitted_at: "2026-07-27T09:04:00Z",
          },
        ],
        KODY_BOT_LOGIN,
        "current-sha",
        KODY_BOT_ID,
      ),
    ).toBe("CHANGES_REQUESTED");
    expect(
      currentReviewState(
        [
          {
            ...currentApproval,
            user: { id: 1, login: KODY_BOT_LOGIN },
          },
        ],
        KODY_BOT_LOGIN,
        "current-sha",
        KODY_BOT_ID,
      ),
    ).toBe("PENDING");
  });

  test("reports Kody findings and approval for the exact current SHA", () => {
    const review = {
      user: { id: KODY_BOT_ID, login: KODY_BOT_LOGIN },
      commit_id: "current-sha",
      state: "COMMENTED",
      submitted_at: "2026-07-27T09:03:00Z",
    };

    expect(currentKodyReviewOutcome([review], "current-sha")).toBe(
      "COMMENTED",
    );
    expect(
      currentKodyReviewOutcome(
        [
          review,
          {
            ...review,
            state: "APPROVED",
            submitted_at: "2026-07-27T09:04:00Z",
          },
        ],
        "current-sha",
      ),
    ).toBe("APPROVED");
    expect(
      currentKodyReviewOutcome(
        [{ ...review, commit_id: "old-sha" }],
        "current-sha",
      ),
    ).toBe("PENDING");
    expect(
      currentKodyReviewOutcome(
        [{ ...review, user: { id: 1, login: KODY_BOT_LOGIN } }],
        "current-sha",
      ),
    ).toBe("PENDING");
  });
});

describe("Kody approval indicator", () => {
  const humanPolicy = {
    kind: "human-authored",
    autoMerge: false,
    needsMaintainerApproval: false,
    requiresKodyReview: true,
  };

  test("passes only a current-revision Kody approval", () => {
    expect(kodyApprovalStatus(humanPolicy, "APPROVED").state).toBe(
      "success",
    );
    expect(kodyApprovalStatus(humanPolicy, "PENDING").state).toBe("pending");
    expect(kodyApprovalStatus(humanPolicy, "COMMENTED").state).toBe(
      "failure",
    );
    expect(kodyApprovalStatus(humanPolicy, "CHANGES_REQUESTED").state).toBe(
      "failure",
    );
    expect(kodyApprovalStatus(humanPolicy, "DISMISSED").state).toBe(
      "failure",
    );
  });

  test("publishes pending, failure and success as distinct commit statuses", () => {
    const targetUrl = "https://github.com/Jesse-Dur/mind-hosted/pull/47";

    expect(
      kodyCommitStatus(kodyApprovalStatus(humanPolicy, "PENDING"), targetUrl),
    ).toEqual({
      state: "pending",
      context: KODY_STATUS_CONTEXT,
      description: "Waiting for Kody to review the current pull-request revision.",
      target_url: targetUrl,
    });
    expect(
      kodyCommitStatus(
        kodyApprovalStatus(humanPolicy, "COMMENTED"),
        targetUrl,
      ).state,
    ).toBe("failure");
    expect(
      kodyCommitStatus(
        kodyApprovalStatus(humanPolicy, "CHANGES_REQUESTED"),
        targetUrl,
      ).state,
    ).toBe("failure");
    expect(
      kodyCommitStatus(kodyApprovalStatus(humanPolicy, "APPROVED"), targetUrl)
        .state,
    ).toBe("success");
  });

  test("posts Kody findings as a failure on the exact head SHA", async () => {
    const requests: Array<{ path: string; options: unknown }> = [];
    const pullRequest = {
      number: 47,
      html_url: "https://github.com/Jesse-Dur/mind-hosted/pull/47",
      user: { login: "Jesse-Dur" },
      head: {
        sha: "current-sha",
        ref: "feature/example",
        repo: { full_name: "Jesse-Dur/mind-hosted" },
      },
    };
    const api = {
      repository: "Jesse-Dur/mind-hosted",
      paginate: async () => [
        {
          user: { id: KODY_BOT_ID, login: KODY_BOT_LOGIN },
          commit_id: "current-sha",
          state: "COMMENTED",
          submitted_at: "2026-08-21T09:56:26Z",
        },
      ],
      request: async (path: string, options: unknown) => {
        requests.push({ path, options });
      },
    };

    await publishKodyApprovalStatus(api, pullRequest, humanPolicy);

    expect(requests).toEqual([
      {
        path: "/statuses/current-sha",
        options: {
          method: "POST",
          body: {
            state: "failure",
            context: KODY_STATUS_CONTEXT,
            description:
              "Kody did not approve the current pull-request revision (commented).",
            target_url: pullRequest.html_url,
          },
        },
      },
    ]);
  });

  test("keeps security updates pending until Kody approves", async () => {
    const requests: Array<{
      path: string;
      options: {
        method: string;
        body: ReturnType<typeof kodyCommitStatus>;
      };
    }> = [];
    const pullRequest = {
      number: 52,
      html_url: "https://github.com/Jesse-Dur/mind-hosted/pull/52",
      user: { login: "dependabot[bot]" },
      head: {
        sha: "security-sha",
        ref: "dependabot/bun/example-2.0.0",
        repo: { full_name: "Jesse-Dur/mind-hosted" },
      },
    };
    const api = {
      repository: "Jesse-Dur/mind-hosted",
      paginate: async () => [],
      request: async (
        path: string,
        options: {
          method: string;
          body: ReturnType<typeof kodyCommitStatus>;
        },
      ) => {
        requests.push({ path, options });
      },
    };

    await publishKodyApprovalStatus(
      api,
      pullRequest,
      classifyPolicy({ updateLevel: "major", security: true }),
    );

    expect(requests[0].path).toBe("/statuses/security-sha");
    expect(requests[0].options.body.state).toBe("pending");
    expect(requests[0].options.body.description).toContain(
      "Waiting for Kody",
    );
  });

  test("keeps advisory status failures out of the dependency gates", async () => {
    const warning = spyOn(console, "warn").mockImplementation(() => {});
    const pullRequest = {
      number: 52,
      html_url: "https://github.com/Jesse-Dur/mind-hosted/pull/52",
      head: { sha: "security-sha" },
    };
    const api = {
      paginate: async () => [],
      request: async () => {
        throw new Error("status API unavailable");
      },
    };

    const result = await publishKodyApprovalStatusSafely(
      api,
      pullRequest,
      classifyPolicy({ updateLevel: "major", security: true }),
    );

    expect(result).toBeNull();
    expect(warning).toHaveBeenCalledTimes(1);
    warning.mockRestore();
  });

  test("requires approval even for Dependabot policies eligible for automatic merge", () => {
    const pullRequest = {
      user: { login: "dependabot[bot]" },
      head: {
        sha: "current-sha",
        ref: "dependabot/bun/example-1.2.3",
        repo: { full_name: "Jesse-Dur/mind-hosted" },
      },
    };
    const classification = {
      headSha: "current-sha",
      updateLevel: "minor",
      security: false,
      githubActions: false,
      securityLookupAvailable: true,
    };
    const trustedComment = {
      user: {
        id: GITHUB_ACTIONS_BOT_ID,
        login: GITHUB_ACTIONS_BOT_LOGIN,
      },
      body: `<!-- mind-dependency-classification:${JSON.stringify(
        classification,
      )} -->`,
    };
    const automaticPolicy = kodyApprovalPolicy(
      pullRequest,
      "Jesse-Dur/mind-hosted",
      [trustedComment],
    );
    const unclassifiedPolicy = kodyApprovalPolicy(
      pullRequest,
      "Jesse-Dur/mind-hosted",
    );

    expect(automaticPolicy.requiresKodyReview).toBe(true);
    expect(kodyApprovalStatus(automaticPolicy, "PENDING").state).toBe(
      "pending",
    );
    expect(unclassifiedPolicy.requiresKodyReview).toBe(true);
    expect(kodyApprovalStatus(unclassifiedPolicy, "PENDING").state).toBe(
      "pending",
    );
  });

  test("requires Kody for human-authored pull requests", () => {
    const policy = kodyApprovalPolicy(
      {
        user: { login: "Jesse-Dur" },
        head: {
          sha: "current-sha",
          ref: "feature/example",
          repo: { full_name: "Jesse-Dur/mind-hosted" },
        },
      },
      "Jesse-Dur/mind-hosted",
    );

    expect(policy).toEqual(humanPolicy);
  });
});

describe("Kody approval status workflow", () => {
  const workflow = readFileSync(
    resolve(import.meta.dir, "../workflows/kody-approval-status.yml"),
    "utf8",
  );

  test("reruns for PR revisions and Kody review-state changes", () => {
    expect(workflow).toContain("pull_request_target:");
    expect(workflow).toContain("pull_request_review:");
    expect(workflow).toContain("- synchronize");
    expect(workflow).toContain("- submitted");
    expect(workflow).toContain("- dismissed");
  });

  test("cancels superseded runs and handles only human-authored PRs", () => {
    expect(workflow).toContain(
      "group: kody-approval-status-${{ github.event.pull_request.number }}",
    );
    expect(workflow).toContain("cancel-in-progress: true");
    expect(workflow).toContain(
      "github.event.review.user.login == 'kody-ai[bot]'",
    );
    expect(workflow).toContain("github.event.review.user.id == 148880201");
    expect(workflow).toContain(
      "github.event.pull_request.user.login != 'dependabot[bot]'",
    );
  });

  test("uses minimal status permissions and trusted base policy code", () => {
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("issues: read");
    expect(workflow).toContain("pull-requests: read");
    expect(workflow).toContain("statuses: write");
    expect(workflow).toContain("ref: ${{ github.event.pull_request.base.sha }}");
    expect(workflow).toContain(
      "node .github/scripts/dependency-gate.mjs kody-status",
    );
  });

  test("reports event-driven status without polling", () => {
    expect(workflow).toContain("timeout-minutes: 5");
    expect(workflow).not.toContain("POLL_SECONDS");
    expect(workflow).not.toContain("WAIT_MINUTES");
  });

  test("skips only while the trusted base lacks the new reporter", () => {
    expect(workflow).toContain(
      "grep -q 'mode === \"kody-status\"' .github/scripts/dependency-gate.mjs",
    );
    expect(workflow).toContain(
      "The trusted base does not contain the status reporter yet",
    );
    expect(workflow).toContain("exit 0");
  });
});

describe("Dependabot status publishing", () => {
  const workflow = readFileSync(
    resolve(import.meta.dir, "../workflows/dependabot-policy.yml"),
    "utf8",
  );
  const script = readFileSync(
    resolve(import.meta.dir, "dependency-gate.mjs"),
    "utf8",
  );

  test("orders Dependabot status publishing after classification", () => {
    expect(workflow).toContain("statuses: write");
    expect(workflow).toContain("needs:");
    expect(workflow).toContain("- classify");
    expect(workflow).toContain(
      "node .github/scripts/dependency-gate.mjs gate",
    );
    expect(script).toContain(
      "await publishKodyApprovalStatusSafely(",
    );
    expect(script).not.toContain("recordKodyStatusWarningSafely");
  });
});

describe("test-suite check", () => {
  test("uses the newest GitHub Actions Test suite check", () => {
    expect(
      latestTestResult([
        {
          name: "Test suite",
          app: { slug: "github-actions" },
          status: "completed",
          conclusion: "success",
          started_at: "2026-07-27T09:00:00Z",
        },
        {
          name: "Test suite",
          app: { slug: "github-actions" },
          status: "completed",
          conclusion: "failure",
          started_at: "2026-07-27T09:01:00Z",
        },
        {
          name: "Test suite",
          app: { slug: "another-app" },
          status: "completed",
          conclusion: "success",
          started_at: "2026-07-27T09:02:00Z",
        },
      ]),
    ).toEqual({ state: "failure", conclusion: "failure" });
  });

  test("does not accept an incomplete check", () => {
    expect(
      latestTestResult([
        {
          name: "Test suite",
          app: { slug: "github-actions" },
          status: "in_progress",
          conclusion: null,
          started_at: "2026-07-27T09:00:00Z",
        },
      ]),
    ).toEqual({ state: "pending", conclusion: null });
  });
});

describe("final merge revalidation", () => {
  function fixture({
    reviewState = "APPROVED",
    reviewSha = "current-sha",
    reviewId = KODY_BOT_ID,
    checkConclusion = "success",
    latestSha = "current-sha",
    maintainerApproval = false,
    previousApproval = false,
  } = {}) {
    const pullRequest = {
      number: 30,
      state: "open",
      title: "Update Hono",
      created_at: "2026-11-06T00:00:00Z",
      base: { ref: "main" },
      head: {
        sha: "current-sha",
        ref: "dependabot/bun/hono-4.13.16",
        repo: { full_name: "Jesse-Dur/mind-hosted" },
      },
    };
    const requests: Array<{ path: string; options?: any }> = [];
    const api = {
      repository: "Jesse-Dur/mind-hosted",
      async request(path: string, options?: any) {
        requests.push({ path, options });
        if (path === "/pulls/30") {
          return { ...pullRequest, head: { ...pullRequest.head, sha: latestSha } };
        }
        if (path === "/commits/current-sha/check-runs?per_page=100") {
          return { check_runs: [{
            name: "Test suite", app: { slug: "github-actions" },
            status: "completed", conclusion: checkConclusion,
          }] };
        }
        if (path === "/commits/current-sha") return {};
        if (path === "/pulls/30/merge") return { merged: true };
        if (path === "/actions/workflows/deploy-backend.yml/dispatches") return null;
        if (path.startsWith("/git/refs/heads/")) return null;
        throw new Error(`Unexpected request: ${path}`);
      },
      async paginate(path: string) {
        if (path === "/issues/30/timeline") return [];
        if (path === "/pulls/30/reviews") {
          return [
            ...(previousApproval ? [{
              user: { login: KODY_BOT_LOGIN, id: KODY_BOT_ID },
              commit_id: "current-sha", state: "APPROVED",
              submitted_at: "2026-11-06T00:00:00Z",
            }] : []),
            {
              user: { login: KODY_BOT_LOGIN, id: reviewId },
              commit_id: reviewSha, state: reviewState,
              submitted_at: "2026-11-06T00:01:00Z",
            },
            ...(maintainerApproval ? [{
              user: { login: "Jesse-Dur" }, commit_id: "current-sha",
              state: "APPROVED", submitted_at: "2026-11-06T00:02:00Z",
            }] : []),
          ];
        }
        throw new Error(`Unexpected pagination: ${path}`);
      },
    };
    return { api, pullRequest, requests };
  }

  test("merges only the tested and approved SHA, then dispatches deployment", async () => {
    const { api, pullRequest, requests } = fixture();
    expect(await mergeCurrentRevision(api, pullRequest, classifyPolicy({ updateLevel: "patch" }))).toBe(true);
    const merge = requests.find(({ path }) => path === "/pulls/30/merge");
    expect(merge?.options.body.sha).toBe("current-sha");
    const dispatch = requests.find(({ path }) => path === "/actions/workflows/deploy-backend.yml/dispatches");
    expect(dispatch?.options).toEqual({ method: "POST", body: { ref: "main" } });
    expect(requests.indexOf(dispatch!)).toBeGreaterThan(requests.indexOf(merge!));
    expect(requests.some(({ path }) => path === "/pulls/30/reviews")).toBe(false);
  });

  for (const [name, options] of [
    ["Kody has not approved", { reviewState: "PENDING" }],
    ["Kody reports findings", { reviewState: "COMMENTED" }],
    ["Kody reports new findings after an approval", { reviewState: "COMMENTED", previousApproval: true }],
    ["approval was dismissed", { reviewState: "DISMISSED" }],
    ["approval belongs to an earlier commit", { reviewSha: "old-sha" }],
    ["reviewer identity does not match the Kody app", { reviewId: 1 }],
    ["tests fail", { checkConclusion: "failure" }],
    ["tests were skipped", { checkConclusion: "skipped" }],
    ["a new commit was pushed", { latestSha: "new-sha" }],
  ] as const) {
    test(`does not merge or deploy when ${name}`, async () => {
      const { api, pullRequest, requests } = fixture(options);
      expect(await mergeCurrentRevision(api, pullRequest, classifyPolicy({ updateLevel: "minor" }))).toBe(false);
      expect(requests.some(({ options }) => options?.method === "PUT" || options?.method === "POST")).toBe(false);
    });
  }

  test("a normal major waits for maintainer approval despite passing CI and Kody", async () => {
    const { api, pullRequest } = fixture();
    expect(await mergeCurrentRevision(api, pullRequest, classifyPolicy({ updateLevel: "major" }))).toBe(false);
    const approved = fixture({ maintainerApproval: true });
    expect(await mergeCurrentRevision(approved.api, approved.pullRequest, classifyPolicy({ updateLevel: "major" }))).toBe(true);
  });

  test("does not merge a patch when Kody requests changes", async () => {
    const pullRequest = {
      number: 29,
      state: "open",
      created_at: "2026-07-27T08:50:00Z",
      head: {
        sha: "current-sha",
        ref: "dependabot/npm_and_yarn/example-1.2.3",
        repo: { full_name: "Jesse-Dur/mind-hosted" },
      },
    };
    const requests: Array<{ path: string; options?: unknown }> = [];
    const api = {
      repository: "Jesse-Dur/mind-hosted",
      async request(path: string, options?: unknown) {
        requests.push({ path, options });

        if (path === "/pulls/29") {
          return pullRequest;
        }
        if (path === "/commits/current-sha/check-runs?per_page=100") {
          return {
            check_runs: [
              {
                name: "Test suite",
                app: { slug: "github-actions" },
                status: "completed",
                conclusion: "success",
                started_at: "2026-07-27T09:00:00Z",
              },
            ],
          };
        }
        if (path === "/commits/current-sha") {
          return {
            commit: {
              author: { date: "2026-07-27T08:55:00Z" },
              committer: { date: "2026-07-27T08:55:00Z" },
            },
          };
        }
        if (path === "/pulls/29/reviews") {
          return {};
        }
        if (path === "/pulls/29/merge") {
          return { merged: true };
        }
        if (path.startsWith("/git/refs/heads/")) {
          return null;
        }

        throw new Error(`Unexpected request: ${path}`);
      },
      async paginate(path: string) {
        if (path === "/issues/29/timeline") {
          return [];
        }
        if (path === "/pulls/29/reviews") {
          return [
            {
              user: { id: KODY_BOT_ID, login: KODY_BOT_LOGIN },
              commit_id: "current-sha",
              state: "APPROVED",
              submitted_at: "2026-07-27T08:58:00Z",
            },
            {
              user: { id: KODY_BOT_ID, login: KODY_BOT_LOGIN },
              commit_id: "current-sha",
              state: "CHANGES_REQUESTED",
              submitted_at: "2026-07-27T09:01:00Z",
            },
          ];
        }

        throw new Error(`Unexpected pagination request: ${path}`);
      },
    };

    const merged = await mergeCurrentRevision(api, pullRequest, {
      kind: "patch",
      autoMerge: true,
      needsMaintainerApproval: false,
      requiresKodyReview: true,
    });

    expect(merged).toBe(false);
    expect(requests.some(({ path }) => path === "/pulls/29/merge")).toBe(false);
  });
});
