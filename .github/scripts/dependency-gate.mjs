import { pathToFileURL } from "node:url";
import { appendFileSync } from "node:fs";

export const GITHUB_ACTIONS_BOT_ID = 41898282;
export const GITHUB_ACTIONS_BOT_LOGIN = "github-actions[bot]";
export const KODY_BOT_ID = 148880201;
export const KODY_BOT_LOGIN = "kody-ai[bot]";
export const KODY_STATUS_CONTEXT = "Kody approval status";
export const MAINTAINER_LOGIN = "Jesse-Dur";
export const TEST_CHECK_NAME = "Test suite";
export const VERSION_CHECK_NAME = "Version policy";

const AUTOMATION_LABEL_PREFIX = "automation/";
const CLASSIFICATION_COMMENT_MARKER = "<!-- mind-dependency-classification:";
const STATUS_COMMENT_MARKER = "<!-- mind-dependency-gate -->";

const LABELS = {
  dependency: {
    name: "automation/dependency",
    color: "0e8a16",
    description: "Managed by the dependency update policy",
  },
  patch: {
    name: "automation/patch",
    color: "1d76db",
    description: "Patch dependency update",
  },
  minor: {
    name: "automation/minor",
    color: "5319e7",
    description: "Minor dependency update",
  },
  major: {
    name: "automation/major",
    color: "b60205",
    description: "Major dependency update",
  },
  security: {
    name: "automation/security",
    color: "d93f0b",
    description: "Fixes an open Dependabot security alert",
  },
  actions: {
    name: "automation/github-actions",
    color: "000000",
    description: "Updates GitHub Actions workflow code",
  },
  securityUnverified: {
    name: "automation/security-unverified",
    color: "fbca04",
    description: "Dependabot alert lookup was unavailable",
  },
};

const FAILURE_CONCLUSIONS = new Set([
  "action_required",
  "cancelled",
  "failure",
  "skipped",
  "stale",
  "startup_failure",
  "timed_out",
]);

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export function isDependabotPullRequest(pullRequest, repository) {
  return (
    pullRequest?.user?.login === "dependabot[bot]" &&
    pullRequest?.head?.repo?.full_name === repository &&
    pullRequest?.head?.ref?.startsWith("dependabot/")
  );
}

function normaliseUpdateLevel(updateType) {
  const match = String(updateType ?? "").match(
    /version-update:semver-(patch|minor|major)/,
  );
  return match?.[1] ?? null;
}

export function classifyPolicy(classification) {
  if (classification?.githubActions) {
    return {
      kind: "actions",
      autoMerge: false,
      needsMaintainerApproval: false,
      requiresKodyReview: true,
    };
  }

  if (classification?.security) {
    return {
      kind: "security",
      autoMerge: true,
      needsMaintainerApproval: false,
      requiresKodyReview: true,
    };
  }

  if (classification?.updateLevel === "patch") {
    return {
      kind: "patch",
      autoMerge: true,
      needsMaintainerApproval: false,
      requiresKodyReview: true,
    };
  }

  if (classification?.updateLevel === "minor") {
    return {
      kind: "minor",
      autoMerge: true,
      needsMaintainerApproval: false,
      requiresKodyReview: true,
    };
  }

  if (classification?.updateLevel === "major") {
    return {
      kind: "major",
      autoMerge: false,
      needsMaintainerApproval: true,
      requiresKodyReview: true,
    };
  }

  return {
    kind: "unknown",
    autoMerge: false,
    needsMaintainerApproval: false,
    requiresKodyReview: true,
  };
}

export function latestCheckResult(checkRuns, checkName) {
  const matchingChecks = checkRuns
    .filter(
      (check) =>
        check.name === checkName && check.app?.slug === "github-actions",
    )
    .sort(
      (left, right) =>
        new Date(left.started_at ?? left.created_at ?? 0).getTime() -
        new Date(right.started_at ?? right.created_at ?? 0).getTime(),
    );

  const latest = matchingChecks.at(-1);

  if (!latest || latest.status !== "completed") {
    return { state: "pending", conclusion: latest?.conclusion ?? null };
  }

  if (latest.conclusion === "success") {
    return { state: "success", conclusion: "success" };
  }

  if (FAILURE_CONCLUSIONS.has(latest.conclusion)) {
    return { state: "failure", conclusion: latest.conclusion };
  }

  return { state: "failure", conclusion: latest.conclusion ?? "unknown" };
}

export function latestTestResult(checkRuns) {
  return latestCheckResult(checkRuns, TEST_CHECK_NAME);
}

export function currentRevisionTime({ pullRequest, commit, timelineEvents }) {
  const headSha = pullRequest.head.sha;
  const candidateTimes = [
    pullRequest.created_at,
    commit?.commit?.author?.date,
    commit?.commit?.committer?.date,
  ];

  for (const event of timelineEvents) {
    const eventSha =
      event.commit_id ??
      event.sha ??
      event.after ??
      event?.commit_url?.split("/").at(-1);

    if (eventSha === headSha) {
      candidateTimes.push(event.created_at);
    }
  }

  const timestamps = candidateTimes
    .map((value) => new Date(value ?? 0).getTime())
    .filter(Number.isFinite);

  return new Date(Math.max(...timestamps));
}

export function currentReviewState(reviews, login, headSha, userId) {
  const decisiveReviews = reviews
    .filter(
      (review) =>
        review.user?.login === login &&
        (userId === undefined || review.user?.id === userId) &&
        review.commit_id === headSha &&
        ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state),
    )
    .sort(
      (left, right) =>
        new Date(left.submitted_at ?? 0).getTime() -
        new Date(right.submitted_at ?? 0).getTime(),
    );

  return decisiveReviews.at(-1)?.state ?? "PENDING";
}

export function currentKodyReviewOutcome(reviews, headSha) {
  const currentReviews = reviews
    .filter(
      (review) =>
        review.user?.login === KODY_BOT_LOGIN &&
        review.user?.id === KODY_BOT_ID &&
        review.commit_id === headSha &&
        ["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED"].includes(
          review.state,
        ),
    )
    .sort(
      (left, right) =>
        new Date(left.submitted_at ?? 0).getTime() -
        new Date(right.submitted_at ?? 0).getTime(),
    );

  return currentReviews.at(-1)?.state ?? "PENDING";
}

export function hasCurrentApproval(reviews, login, headSha, userId) {
  return currentReviewState(reviews, login, headSha, userId) === "APPROVED";
}

export function kodyReviewPassed(policy, reviewState) {
  return !policy.requiresKodyReview || reviewState === "APPROVED";
}

export function kodyApprovalStatus(policy, reviewState) {
  if (!policy.requiresKodyReview) {
    return {
      state: "success",
      message: `Kody approval is not required for this ${policy.kind} update.`,
    };
  }

  if (reviewState === "APPROVED") {
    return {
      state: "success",
      message: "Kody approved the current pull-request revision.",
    };
  }

  if (reviewState === "PENDING") {
    return {
      state: "pending",
      message: "Waiting for Kody to review the current pull-request revision.",
    };
  }

  return {
    state: "failure",
    message: `Kody did not approve the current pull-request revision (${reviewState.toLowerCase()}).`,
  };
}

export function kodyApprovalPolicy(pullRequest, repository, comments = []) {
  if (!isDependabotPullRequest(pullRequest, repository)) {
    return {
      kind: "human-authored",
      autoMerge: false,
      needsMaintainerApproval: false,
      requiresKodyReview: true,
    };
  }

  return classifyPolicy(
    trustedClassification(comments, pullRequest.head.sha),
  );
}

export function trustedClassification(comments, headSha) {
  for (const comment of comments) {
    if (
      comment.user?.id !== GITHUB_ACTIONS_BOT_ID ||
      comment.user?.login !== GITHUB_ACTIONS_BOT_LOGIN
    ) {
      continue;
    }

    const markerStart = comment.body?.indexOf(CLASSIFICATION_COMMENT_MARKER);
    if (markerStart === -1 || markerStart === undefined) {
      continue;
    }

    const jsonStart = markerStart + CLASSIFICATION_COMMENT_MARKER.length;
    const jsonEnd = comment.body.indexOf(" -->", jsonStart);
    if (jsonEnd === -1) {
      continue;
    }

    try {
      const classification = JSON.parse(comment.body.slice(jsonStart, jsonEnd));
      if (classification.headSha === headSha) {
        return classification;
      }
    } catch {
      // Ignore malformed comments and fail closed.
    }
  }

  return null;
}

export class GitHubApi {
  constructor(repository, token) {
    this.repository = repository;
    this.baseUrl = `https://api.github.com/repos/${repository}`;
    this.token = token;
  }

  async request(path, { method = "GET", body, accept } = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Accept: accept ?? "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "mind-dependency-gate",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (response.status === 204) {
      return null;
    }

    const responseText = await response.text();
    const responseBody = responseText ? JSON.parse(responseText) : null;

    if (!response.ok) {
      const error = new Error(
        `GitHub API ${method} ${path} failed (${response.status}): ${
          responseBody?.message ?? responseText
        }`,
      );
      error.status = response.status;
      throw error;
    }

    return responseBody;
  }

  async paginate(path, accept) {
    const separator = path.includes("?") ? "&" : "?";
    const results = [];

    for (let page = 1; ; page += 1) {
      const pageResults = await this.request(
        `${path}${separator}per_page=100&page=${page}`,
        { accept },
      );
      results.push(...pageResults);

      if (pageResults.length < 100) {
        return results;
      }
    }
  }
}

function getLabelNames(pullRequest) {
  return pullRequest.labels.map((label) =>
    typeof label === "string" ? label : label.name,
  );
}

async function ensureLabel(api, label) {
  try {
    await api.request("/labels", {
      method: "POST",
      body: label,
    });
  } catch (error) {
    if (error.status !== 422) {
      throw error;
    }
  }
}

async function classifyPullRequest(api, pullRequestNumber) {
  const pullRequest = await api.request(`/pulls/${pullRequestNumber}`);

  if (!isDependabotPullRequest(pullRequest, api.repository) ||
      (process.env.CLASSIFY_HEAD_SHA && process.env.CLASSIFY_HEAD_SHA !== pullRequest.head.sha)) {
    return;
  }

  const updateLevel = normaliseUpdateLevel(process.env.UPDATE_TYPE);
  const packageEcosystem = process.env.PACKAGE_ECOSYSTEM;
  const alertState = process.env.ALERT_STATE;
  const securityLookupAvailable =
    process.env.SECURITY_LOOKUP_AVAILABLE === "true";
  const classification = {
    headSha: pullRequest.head.sha,
    updateLevel: updateLevel ?? "unknown",
    security: alertState === "OPEN",
    githubActions: packageEcosystem === "github-actions",
    securityLookupAvailable,
  };

  const selectedLabels = [LABELS.dependency];

  if (updateLevel && LABELS[updateLevel]) {
    selectedLabels.push(LABELS[updateLevel]);
  }

  if (packageEcosystem === "github-actions") {
    selectedLabels.push(LABELS.actions);
  }

  if (alertState === "OPEN") {
    selectedLabels.push(LABELS.security);
  } else if (!securityLookupAvailable) {
    selectedLabels.push(LABELS.securityUnverified);
  }

  await Promise.all(selectedLabels.map((label) => ensureLabel(api, label)));

  const existingLabels = getLabelNames(pullRequest);
  const retainedLabels = existingLabels.filter(
    (label) => !label.startsWith(AUTOMATION_LABEL_PREFIX),
  );
  const desiredLabels = [
    ...new Set([...retainedLabels, ...selectedLabels.map(({ name }) => name)]),
  ];

  if (
    [...existingLabels].sort().join("\n") !==
    [...desiredLabels].sort().join("\n")
  ) {
    await api.request(`/issues/${pullRequestNumber}`, {
      method: "PATCH",
      body: { labels: desiredLabels },
    });
  }

  await upsertClassificationComment(api, pullRequest, classification);
}

export async function upsertClassificationComment(api, pullRequest, classification) {
  const classificationJson = JSON.stringify(classification);
  const classificationName = classification.githubActions
    ? "GitHub Actions"
    : classification.security
      ? "security"
      : classification.updateLevel;
  const completeBody = `${CLASSIFICATION_COMMENT_MARKER}${classificationJson} -->
Dependency automation classified revision \`${pullRequest.head.sha.slice(0, 7)}\` as **${classificationName}**.`;
  const comments = await api.paginate(`/issues/${pullRequest.number}/comments`);
  const existingComment = comments.find(
    (comment) =>
      comment.user?.id === GITHUB_ACTIONS_BOT_ID &&
      comment.user?.login === GITHUB_ACTIONS_BOT_LOGIN &&
      trustedClassification([comment], classification.headSha),
  );

  if (existingComment?.body === completeBody) {
    return;
  }

  if (existingComment) {
    await api.request(`/issues/comments/${existingComment.id}`, {
      method: "PATCH",
      body: { body: completeBody },
    });
    return;
  }

  await api.request(`/issues/${pullRequest.number}/comments`, {
    method: "POST",
    body: { body: completeBody },
  });
}

async function evaluateGates(api, pullRequest) {
  const headSha = pullRequest.head.sha;
  const [checkRunsResponse, timelineEvents, commit, reviews] = await Promise.all([
    api.request(`/commits/${headSha}/check-runs?per_page=100`),
    api.paginate(
      `/issues/${pullRequest.number}/timeline`,
      "application/vnd.github+json",
    ),
    api.request(`/commits/${headSha}`),
    api.paginate(`/pulls/${pullRequest.number}/reviews`),
  ]);

  const revisionTime = currentRevisionTime({
    pullRequest,
    commit,
    timelineEvents,
  });

  return {
    ci: latestTestResult(checkRunsResponse.check_runs),
    version: latestCheckResult(checkRunsResponse.check_runs, VERSION_CHECK_NAME),
    kodyReview: currentKodyReviewOutcome(reviews, headSha),
    kodyReviewRunning: checkRunsResponse.check_runs.some((check) => check.name === "Kody Code Review" && check.status !== "completed"),
    maintainerApproved: hasCurrentApproval(reviews, MAINTAINER_LOGIN, headSha),
    revisionTime,
  };
}

async function assignMaintainer(api, pullRequest) {
  if (
    pullRequest.assignees?.some(
      (assignee) => assignee.login === MAINTAINER_LOGIN,
    )
  ) {
    return;
  }

  await api.request(`/issues/${pullRequest.number}/assignees`, {
    method: "POST",
    body: { assignees: [MAINTAINER_LOGIN] },
  });
}

async function upsertStatusComment(api, pullRequestNumber, body) {
  const completeBody = `${STATUS_COMMENT_MARKER}\n${body}`;
  const comments = await api.paginate(`/issues/${pullRequestNumber}/comments`);
  const existingComment = comments.find(
    (comment) =>
      comment.user?.id === GITHUB_ACTIONS_BOT_ID &&
      comment.user?.login === GITHUB_ACTIONS_BOT_LOGIN &&
      comment.body?.includes(STATUS_COMMENT_MARKER),
  );

  if (existingComment?.body === completeBody) {
    return;
  }

  if (existingComment) {
    await api.request(`/issues/comments/${existingComment.id}`, {
      method: "PATCH",
      body: { body: completeBody },
    });
    return;
  }

  await api.request(`/issues/${pullRequestNumber}/comments`, {
    method: "POST",
    body: { body: completeBody },
  });
}

function gateSummary(pullRequest, classification, policy, gates, reason) {
  const shortSha = pullRequest.head.sha.slice(0, 7);
  const ci =
    gates.ci.state === "success"
      ? "passed"
      : gates.ci.state === "failure"
        ? `failed (${gates.ci.conclusion})`
        : "pending";
  const kodyReview = !policy.requiresKodyReview
    ? "not required for automatic merge"
    : gates.kodyReview === "APPROVED"
      ? "approved"
      : gates.kodyReview === "CHANGES_REQUESTED"
        ? "changes requested"
        : "pending";
  const securityNote = !classification?.securityLookupAvailable
    ? "\n\nDependabot security-alert lookup was unavailable. A major update will remain manual until it can be classified safely."
    : "";

  return `### Dependency gate: ${reason}

Revision: \`${shortSha}\`

- Test suite: **${ci}**
- Version policy: **${gates.version.state}**
- Kody review: **${kodyReview}**
- Policy: **${policy.kind}**

The pull request stays open and is assigned to @${MAINTAINER_LOGIN}.${securityNote}`;
}

async function deleteMergedBranch(api, pullRequest) {
  if (pullRequest.head.repo.full_name !== api.repository) {
    return;
  }

  const encodedRef = pullRequest.head.ref
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  try {
    await api.request(`/git/refs/heads/${encodedRef}`, {
      method: "DELETE",
    });
  } catch (error) {
    if (error.status !== 404 && error.status !== 422) {
      throw error;
    }
  }
}

export async function dispatchMergedDeployment(api, pullRequest, { pause = sleep } = {}) {
  let dispatchError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await api.request("/actions/workflows/deploy-backend.yml/dispatches", {
        method: "POST",
        body: { ref: pullRequest.base.ref },
      });
      return;
    } catch (error) {
      dispatchError = error;
      if (attempt < 2) await pause(1_000 * 2 ** attempt);
    }
  }

  const message = `Pull request #${pullRequest.number} was merged, but deployment dispatch could not be confirmed after three attempts.`;
  console.error(message, dispatchError);
  try {
    await assignMaintainer(api, pullRequest);
    await upsertStatusComment(api, pullRequest.number, `### Deployment dispatch unconfirmed

${message}

The merge is complete. Check the [deployment runs](https://github.com/${api.repository}/actions/workflows/deploy-backend.yml) before retrying: a failed API response can also occur after GitHub accepts a dispatch. If no deployment was queued, run **Deploy Backend** for the default branch. @${MAINTAINER_LOGIN}`);
  } catch (reportError) {
    console.error("Could not report the merged update's unconfirmed deployment on the pull request.", reportError);
  }
  throw new Error(message, { cause: dispatchError });
}

export async function mergeCurrentRevision(api, pullRequest, policy, preparedBaseSha) {
  if (!preparedBaseSha) throw new Error("The attested preparation base SHA is required before merging.");
  const latestPullRequest = await api.request(`/pulls/${pullRequest.number}`);

  if (
    latestPullRequest.state !== "open" ||
    latestPullRequest.head.sha !== pullRequest.head.sha ||
    latestPullRequest.base.ref !== "main" || pullRequest.base.ref !== "main"
  ) {
    return false;
  }

  const latestGates = await evaluateGates(api, latestPullRequest);

  if (
    latestGates.ci.state !== "success" ||
    latestGates.version.state !== "success" ||
    !kodyReviewPassed(policy, latestGates.kodyReview) ||
    (policy.needsMaintainerApproval && !latestGates.maintainerApproved)
  ) {
    return false;
  }

  // PR base.sha can be a cached snapshot. Resolve the branch after checking the
  // current head's gates, immediately before the guarded merge request.
  const liveBase = await api.request("/git/ref/heads/main");
  if (liveBase.object.sha !== preparedBaseSha) return false;

  const mergeResult = await api.request(
    `/pulls/${latestPullRequest.number}/merge`,
    {
      method: "PUT",
      body: {
        sha: latestPullRequest.head.sha,
        merge_method: "merge",
        commit_title: latestPullRequest.title,
        commit_message: `Dependabot update approved by the repository policy.\n\nTest suite passed for ${latestPullRequest.head.sha}.`,
      },
    },
  );

  if (!mergeResult.merged) {
    throw new Error(
      `GitHub did not merge the pull request: ${mergeResult.message}`,
    );
  }

  // GITHUB_TOKEN merges do not emit push-triggered Actions runs. Explicit
  // workflow_dispatch events do, so the normal deployment still follows.
  await dispatchMergedDeployment(api, latestPullRequest);
  try {
    await deleteMergedBranch(api, latestPullRequest);
  } catch (error) {
    // Deployment is already queued; branch housekeeping must not disguise that.
    console.warn(`Update #${latestPullRequest.number} merged and deployment was dispatched, but branch cleanup failed.`, error);
  }
  return true;
}

async function processPullRequest(
  api,
  pullRequestNumber,
  { prepare, allowMerge },
) {
  const initialPullRequest = await api.request(`/pulls/${pullRequestNumber}`);

  if (
    initialPullRequest.state !== "open" ||
    initialPullRequest.draft ||
    initialPullRequest.base.ref !== "main" ||
    !isDependabotPullRequest(initialPullRequest, api.repository)
  ) {
    return "blocked";
  }

  const classificationComments = await api.paginate(
    `/issues/${initialPullRequest.number}/comments`,
  );
  let classification = trustedClassification(
    classificationComments,
    initialPullRequest.head.sha,
  );
  if (!classification) return "blocked";
  const preparation = await prepare(api, initialPullRequest, classification);
  if (preparation.state !== "ready") return preparation.state;
  classification = preparation.classification;
  const policy = classifyPolicy(classification);

  // Do not add a fallback PR warning comment here. Statuses are scoped to the
  // exact commit; human-authored status runs fail visibly, while Dependabot's
  // deterministic gate reports any required Kody review independently.
  await publishKodyApprovalStatusSafely(
    api,
    initialPullRequest,
    policy,
  );

  if (policy.kind === "actions" || policy.needsMaintainerApproval) {
    await assignMaintainer(api, initialPullRequest);
  }

  const pullRequest = await api.request(`/pulls/${pullRequestNumber}`);
  const liveBase = await api.request("/git/ref/heads/main");
  if (pullRequest.state !== "open" || pullRequest.head.sha !== initialPullRequest.head.sha ||
      pullRequest.base.ref !== "main" || liveBase.object.sha !== classification.preparation.baseSha) return "stale";
  const gates = await evaluateGates(api, pullRequest);
  if (gates.ci.state === "failure" || gates.version.state === "failure" ||
      ["CHANGES_REQUESTED", "COMMENTED", "DISMISSED"].includes(gates.kodyReview)) {
    await assignMaintainer(api, pullRequest);
    await upsertStatusComment(api, pullRequest.number, gateSummary(pullRequest, classification, policy, gates, "attention required"));
    return "blocked";
  }
  if (!kodyReviewPassed(policy, gates.kodyReview) && !gates.kodyReviewRunning) await requestCurrentKodyReview(api, pullRequest);
  if (policy.kind === "actions" || (policy.needsMaintainerApproval && !gates.maintainerApproved)) return "manual";
  if (!policy.autoMerge && !gates.maintainerApproved) return "manual";
  if (gates.ci.state !== "success" || gates.version.state !== "success" || !kodyReviewPassed(policy, gates.kodyReview)) return "waiting";
  if (!allowMerge) return "waiting";
  return await mergeCurrentRevision(api, pullRequest, policy, classification.preparation.baseSha) ? "merged" : "stale";
}

export async function requestCurrentKodyReview(api, pullRequest) {
  const marker = `<!-- mind-dependency-review:${pullRequest.head.sha} -->`;
  const comments = await api.paginate(`/issues/${pullRequest.number}/comments`);
  if (comments.some((comment) => comment.user?.id === GITHUB_ACTIONS_BOT_ID &&
      comment.user?.login === GITHUB_ACTIONS_BOT_LOGIN && comment.body?.includes(marker))) return;
  await api.request(`/issues/${pullRequest.number}/comments`, {
    method: "POST",
    body: { body: `@kody review --force\n\nPlease review dependency revision \`${pullRequest.head.sha}\`, including its app version and current main changes.\n\n${marker}` },
  });
}

async function recordFailure(api, pullRequestNumber, error) {
  try {
    const pullRequest = await api.request(`/pulls/${pullRequestNumber}`);
    if (pullRequest.state !== "open") {
      return;
    }

    await assignMaintainer(api, pullRequest);
    await upsertStatusComment(
      api,
      pullRequest.number,
      `### Dependency gate: automation error

The policy workflow could not complete for revision \`${pullRequest.head.sha.slice(0, 7)}\`. The pull request remains open and is assigned to @${MAINTAINER_LOGIN}.

\`${String(error.message).replaceAll("`", "'")}\``,
    );
  } catch (recordingError) {
    console.error(
      "Could not record the dependency gate failure.",
      recordingError,
    );
  }
}

export async function runGate(api, {
  prepare,
  requestedPullRequest = Number(process.env.PR_NUMBER || 0),
  allowMerge = process.env.ALLOW_MERGE !== "false",
} = {}) {
  if (!prepare) {
    const { prepareDependency } = await import("./dependency-preparation.mjs");
    if (!process.env.DEPENDENCY_PREPARATION_TOKEN || !process.env.DEPENDENCY_APP_SLUG) {
      throw new Error("Configure DEPENDENCY_APP_ID and DEPENDENCY_APP_PRIVATE_KEY before preparing dependencies.");
    }
    prepare = (client, pullRequest, classification) => prepareDependency(client, pullRequest, classification, {
      token: process.env.DEPENDENCY_PREPARATION_TOKEN, appSlug: process.env.DEPENDENCY_APP_SLUG,
    });
  }
  let failures = 0;

  const candidates = requestedPullRequest
    ? [await api.request(`/pulls/${requestedPullRequest}`)]
    : (await api.paginate("/pulls?state=open&sort=updated&direction=desc"))
        .filter((pullRequest) => isDependabotPullRequest(pullRequest, api.repository) &&
          pullRequest.base.ref === "main" && !pullRequest.draft);
  const classified = await Promise.all(candidates.map(async (pullRequest) => {
    const comments = await api.paginate(`/issues/${pullRequest.number}/comments`);
    const classification = trustedClassification(comments, pullRequest.head.sha);
    const automatic = classifyPolicy(classification).autoMerge;
    return { pullRequest, priority: automatic ? (classification?.preparation ? 0 : 1) : 2 };
  }));
  const pullRequestNumbers = classified.sort((left, right) => left.priority - right.priority)
    .map(({ pullRequest }) => pullRequest.number);

  for (const pullRequestNumber of pullRequestNumbers) {
    try {
      const result = await processPullRequest(api, pullRequestNumber, {
        prepare, allowMerge,
      });
      // One active update at a time; real failures and manual approvals do not
      // hold up unrelated updates. The next event or schedule resumes the gate.
      if (["prepared", "waiting", "merged", "stale"].includes(result)) break;
    } catch (error) {
      failures += 1;
      console.error(
        `Dependency gate failed for pull request #${pullRequestNumber}.`,
        error,
      );
      await recordFailure(api, pullRequestNumber, error);
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
}

export function kodyCommitStatus(result, targetUrl) {
  return {
    state: result.state,
    context: KODY_STATUS_CONTEXT,
    description: result.message,
    target_url: targetUrl,
  };
}

export async function publishKodyApprovalStatus(api, pullRequest, policy) {
  if (!policy) {
    const comments = isDependabotPullRequest(pullRequest, api.repository)
      ? await api.paginate(`/issues/${pullRequest.number}/comments`)
      : [];
    policy = kodyApprovalPolicy(pullRequest, api.repository, comments);
  }

  const reviews = await api.paginate(
    `/pulls/${pullRequest.number}/reviews`,
  );
  const reviewState = currentKodyReviewOutcome(
    reviews,
    pullRequest.head.sha,
  );
  const result = kodyApprovalStatus(policy, reviewState);

  await api.request(`/statuses/${pullRequest.head.sha}`, {
    method: "POST",
    body: kodyCommitStatus(result, pullRequest.html_url),
  });

  console.log(result.message);
  return { policy, reviewState, ...result };
}

export async function publishKodyApprovalStatusSafely(
  api,
  pullRequest,
  policy,
) {
  try {
    return await publishKodyApprovalStatus(api, pullRequest, policy);
  } catch (error) {
    console.warn(
      `Could not publish the advisory Kody approval status for pull request #${pullRequest.number}; dependency gates will continue.`,
      error,
    );
    return null;
  }
}

async function runKodyApprovalStatus(api) {
  const pullRequestNumber = Number(process.env.PR_NUMBER || 0);

  if (!pullRequestNumber) {
    throw new Error("PR_NUMBER is required in kody-status mode.");
  }

  const pullRequest = await api.request(`/pulls/${pullRequestNumber}`);
  if (pullRequest.state !== "open") {
    console.log("Pull request is no longer open; no Kody status is needed.");
    return;
  }

  await publishKodyApprovalStatus(api, pullRequest);
}

async function main() {
  const repository = process.env.REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const mode = process.argv[2];

  if (!repository || !token) {
    throw new Error("REPOSITORY and GITHUB_TOKEN are required.");
  }

  const api = new GitHubApi(repository, token);

  if (mode === "classified") {
    const number = Number(process.env.PR_NUMBER);
    if (!number || !process.env.GITHUB_OUTPUT) throw new Error("PR_NUMBER and GITHUB_OUTPUT are required.");
    const pullRequest = await api.request(`/pulls/${number}`);
    const comments = await api.paginate(`/issues/${number}/comments`);
    const exists = isDependabotPullRequest(pullRequest, repository) && trustedClassification(comments, pullRequest.head.sha);
    appendFileSync(process.env.GITHUB_OUTPUT, `reuse=${Boolean(exists)}\n`);
    return;
  }

  if (mode === "classify") {
    const pullRequestNumber = Number(process.env.PR_NUMBER || 0);
    if (!pullRequestNumber) {
      throw new Error("PR_NUMBER is required in classify mode.");
    }
    await classifyPullRequest(api, pullRequestNumber);
    return;
  }

  if (mode === "gate") {
    await runGate(api);
    return;
  }

  if (mode === "kody-status") {
    await runKodyApprovalStatus(api);
    return;
  }

  throw new Error('Expected command "classify", "gate" or "kody-status".');
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
