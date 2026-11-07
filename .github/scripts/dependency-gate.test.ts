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
  dispatchMergedDeployment,
  hasCurrentApproval,
  kodyApprovalPolicy,
  kodyApprovalStatus,
  kodyCommitStatus,
  kodyReviewPassed,
  latestTestResult,
  mergeCurrentRevision,
  publishKodyApprovalStatus,
  publishKodyApprovalStatusSafely,
  requestCurrentKodyReview,
  runGate,
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

  test("uses trusted base or default-branch policy code for every privileged trigger", () => {
    const parsed = Bun.YAML.parse(workflow) as { jobs: { gate: { steps: Array<{ uses?: string; with?: Record<string, unknown> }> } } };
    const checkout = parsed.jobs.gate.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
    expect(checkout?.with?.ref).toBe("${{ github.event.pull_request.base.sha || github.event.repository.default_branch }}");
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
  });

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

describe("post-merge deployment dispatch", () => {
  const pullRequest = { number: 30, base: { ref: "main" }, assignees: [] };

  function fixture(failures: number) {
    const calls: Array<{ path: string; options?: any }> = [];
    let attempts = 0;
    const api = {
      repository: "Jesse-Dur/mind-hosted",
      async request(path: string, options?: any) {
        calls.push({ path, options });
        if (path === "/actions/workflows/deploy-backend.yml/dispatches" && attempts++ < failures) {
          throw new Error("GitHub dispatch unavailable");
        }
        return null;
      },
      async paginate() { return []; },
    };
    return { calls, api };
  }

  test("retries transient failures without merging a second time", async () => {
    const { calls, api } = fixture(2);
    const delays: number[] = [];
    await dispatchMergedDeployment(api, pullRequest, { pause: async (delay: number) => { delays.push(delay); } });
    expect(delays).toEqual([1000, 2000]);
    expect(calls).toHaveLength(3);
    expect(calls.every(({ path }) => path === "/actions/workflows/deploy-backend.yml/dispatches")).toBe(true);
  });

  test("reports exhausted retries on the merged PR and leaves the workflow failed", async () => {
    const { calls, api } = fixture(Infinity);
    const errors = spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(dispatchMergedDeployment(api, pullRequest, { pause: async () => {} })).rejects.toThrow("was merged, but deployment dispatch could not be confirmed");
      expect(calls.filter(({ path }) => path === "/actions/workflows/deploy-backend.yml/dispatches")).toHaveLength(3);
      expect(calls.some(({ path }) => path === "/issues/30/assignees")).toBe(true);
      const comment = calls.find(({ path }) => path === "/issues/30/comments");
      expect(comment?.options.body.body).toContain("Deployment dispatch unconfirmed");
      expect(comment?.options.body.body).toContain("The merge is complete");
    } finally { errors.mockRestore(); }
  });
});

describe("final merge revalidation", () => {
  function fixture({
    reviewState = "APPROVED",
    reviewSha = "current-sha",
    reviewId = KODY_BOT_ID,
    checkConclusion = "success",
    versionConclusion = "success",
    versionStatus = "completed",
    latestSha = "current-sha",
    latestBase = "main-sha",
    maintainerApproval = false,
    previousApproval = false,
    failedBranchCleanup = false,
  } = {}) {
    const pullRequest = {
      number: 30,
      state: "open",
      title: "Update Hono",
      created_at: "2026-11-06T00:00:00Z",
      base: { ref: "main", sha: "main-sha" },
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
          return { ...pullRequest, head: { ...pullRequest.head, sha: latestSha }, base: { ...pullRequest.base, sha: latestBase } };
        }
        if (path === "/commits/current-sha/check-runs?per_page=100") {
          return { check_runs: [{
            name: "Test suite", app: { slug: "github-actions" },
            status: "completed", conclusion: checkConclusion,
          }, {
            name: "Version policy", app: { slug: "github-actions" },
            status: versionStatus, conclusion: versionConclusion,
          }] };
        }
        if (path === "/commits/current-sha") return {};
        if (path === "/pulls/30/merge") return { merged: true };
        if (path === "/actions/workflows/deploy-backend.yml/dispatches") return null;
        if (path.startsWith("/git/refs/heads/")) {
          if (failedBranchCleanup) throw new Error("GitHub branch deletion unavailable");
          return null;
        }
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

  test("branch cleanup failure preserves a successful merge and dispatch result", async () => {
    const { api, pullRequest, requests } = fixture({ failedBranchCleanup: true });
    const warning = spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await mergeCurrentRevision(api, pullRequest, classifyPolicy({ updateLevel: "patch" }))).toBe(true);
      expect(requests.filter(({ path }) => path === "/actions/workflows/deploy-backend.yml/dispatches")).toHaveLength(1);
      expect(warning).toHaveBeenCalledTimes(1);
    } finally { warning.mockRestore(); }
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
    ["version check fails", { versionConclusion: "failure" }],
    ["version check was skipped", { versionConclusion: "skipped" }],
    ["version check is still running", { versionStatus: "in_progress" }],
    ["a new commit was pushed", { latestSha: "new-sha" }],
    ["main advanced", { latestBase: "new-main-sha" }],
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
      base: { ref: "main", sha: "main-sha" },
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

describe("sequential dependency processing", () => {
  function fixture({ failed = false, pending = true, review = "APPROVED" } = {}) {
    const candidates = [11, 10].map((number) => ({
      number, state: "open", draft: false, user: { login: "dependabot[bot]" },
      created_at: "2026-11-07T00:00:00Z", assignees: [],
      base: { ref: "main", sha: "main-sha" },
      head: { sha: `head-${number}`, ref: `dependabot/bun/example-${number}`, repo: { full_name: "owner/mind" } },
    }));
    const classification = (number: number) => ({
      headSha: `head-${number}`, updateLevel: "patch", security: false, githubActions: false,
      ...(number === 10 ? { preparation: { baseSha: "main-sha", version: "6.4" } } : {}),
    });
    const comments = new Map(candidates.map((pr) => [pr.number, [{
      user: { id: GITHUB_ACTIONS_BOT_ID, login: GITHUB_ACTIONS_BOT_LOGIN },
      body: `<!-- mind-dependency-classification:${JSON.stringify(classification(pr.number))} -->`,
    }]]));
    const requests: Array<{ path: string; options?: any }> = [];
    const prepared: number[] = [];
    const api = {
      repository: "owner/mind",
      async request(path: string, options?: any): Promise<any> {
        requests.push({ path, options });
        if (path === "/pulls/10") return candidates[1];
        if (path === "/pulls/11") return candidates[0];
        if (path === "/commits/head-10/check-runs?per_page=100") return { check_runs: ["Test suite", "Version policy"].map((name) => ({
          name, app: { slug: "github-actions" }, status: pending ? "in_progress" : "completed", conclusion: failed ? "failure" : "success",
        })) };
        if (path === "/commits/head-10") return {};
        if (path.startsWith("/statuses/")) return {};
        if (path === "/pulls/10/merge") return { merged: true };
        if (path.startsWith("/git/refs/heads/") || path === "/actions/workflows/deploy-backend.yml/dispatches") return {};
        if (path === "/issues/10/assignees" || path === "/issues/10/comments") return {};
        throw new Error(`Unexpected API call ${path}`);
      },
      async paginate(path: string): Promise<any[]> {
        if (path.startsWith("/pulls?")) return candidates;
        for (const pr of candidates) {
          if (path === `/issues/${pr.number}/comments`) return comments.get(pr.number)!;
          if (path === `/issues/${pr.number}/timeline`) return [];
          if (path === `/pulls/${pr.number}/reviews`) return [{
            user: { id: KODY_BOT_ID, login: KODY_BOT_LOGIN }, commit_id: pr.head.sha, state: review,
            submitted_at: "2026-11-07T00:01:00Z",
          }];
        }
        throw new Error(`Unexpected pagination ${path}`);
      },
    };
    const prepare = async (_api: any, pr: any) => {
      prepared.push(pr.number);
      return pr.number === 10 ? { state: "ready", classification: classification(10) } : { state: "prepared" };
    };
    return { api, prepare, prepared, requests };
  }

  test("keeps the active prepared PR ahead of newer PRs while its checks run", async () => {
    const f = fixture();
    await runGate(f.api, { prepare: f.prepare, requestedPullRequest: 0, allowMerge: true });
    expect(f.prepared).toEqual([10]);
    expect(f.requests.some(({ path }) => path.endsWith("/merge"))).toBe(false);
  });

  test("a real test failure leaves that PR open and allows the next update to prepare", async () => {
    const f = fixture({ pending: false, failed: true });
    await runGate(f.api, { prepare: f.prepare, requestedPullRequest: 0, allowMerge: true });
    expect(f.prepared).toEqual([10, 11]);
    expect(f.requests.some(({ path }) => path.endsWith("/merge"))).toBe(false);
  });

  test("prepare-only mode never merges even with passing checks and approval", async () => {
    const f = fixture({ pending: false });
    await runGate(f.api, { prepare: f.prepare, requestedPullRequest: 0, allowMerge: false });
    expect(f.prepared).toEqual([10]);
    expect(f.requests.some(({ path }) => path.endsWith("/merge"))).toBe(false);
  });

  test("merges only the ready update and stops before preparing another", async () => {
    const f = fixture({ pending: false });
    await runGate(f.api, { prepare: f.prepare, requestedPullRequest: 0, allowMerge: true });
    expect(f.prepared).toEqual([10]);
    expect(f.requests.filter(({ path }) => path.endsWith("/merge"))).toHaveLength(1);
  });

  test("review findings prevent merging without holding up unrelated updates", async () => {
    const f = fixture({ pending: false, review: "COMMENTED" });
    await runGate(f.api, { prepare: f.prepare, requestedPullRequest: 0, allowMerge: true });
    expect(f.prepared).toEqual([10, 11]);
    expect(f.requests.some(({ path }) => path.endsWith("/merge"))).toBe(false);
  });
});

test("requests Kody once per exact commit and ignores forged request markers", async () => {
  const pr = { number: 65, head: { sha: "new-head" } };
  const comments: any[] = [{ user: { login: "someone", id: 1 }, body: "<!-- mind-dependency-review:new-head -->" }];
  const requests: any[] = [];
  const api = {
    async paginate() { return comments; },
    async request(path: string, options: any) {
      requests.push({ path, options });
      comments.push({ user: { login: GITHUB_ACTIONS_BOT_LOGIN, id: GITHUB_ACTIONS_BOT_ID }, body: options.body.body });
    },
  };
  await requestCurrentKodyReview(api, pr);
  await requestCurrentKodyReview(api, pr);
  expect(requests).toHaveLength(1);
  expect(requests[0].options.body.body).toContain("@kody start-review");
  await requestCurrentKodyReview(api, { ...pr, head: { sha: "another-head" } });
  expect(requests).toHaveLength(2);
});
