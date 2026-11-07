import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkRepositoryVersion, parseVersion } from "./version-policy.mjs";
import { isDependabotPullRequest, upsertClassificationComment } from "./dependency-gate.mjs";

const MANIFEST = "frontend/package.json";

function gitCommand(cwd, extraEnvironment = {}) {
  return (args, input) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd, input, encoding: "utf8", env: { ...process.env, ...extraEnvironment },
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function versionContent(content, version) {
  const manifest = JSON.parse(content);
  manifest.version = version;
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

// Work with Git objects and a temporary index; never check out or execute PR code.
export function createPreparationCommit({ cwd, baseSha, headSha, appSlug }) {
  const temporary = mkdtempSync(join(tmpdir(), "mind-dependency-preparation-"));
  const git = gitCommand(cwd, {
    GIT_INDEX_FILE: join(temporary, "index"),
    GIT_AUTHOR_NAME: `${appSlug}[bot]`,
    GIT_AUTHOR_EMAIL: `${appSlug}[bot]@users.noreply.github.com`,
    GIT_COMMITTER_NAME: `${appSlug}[bot]`,
    GIT_COMMITTER_EMAIL: `${appSlug}[bot]@users.noreply.github.com`,
  });
  const readManifest = (ref) => git(["show", `${ref}:${MANIFEST}`]);
  const changeVersion = (tree, content, version) => {
    git(["read-tree", tree]);
    const blob = git(["hash-object", "-w", "--stdin"], versionContent(content, version));
    git(["update-index", "--add", "--cacheinfo", `100644,${blob},${MANIFEST}`]);
    return git(["write-tree"]);
  };
  try {
    const baseVersion = JSON.parse(readManifest(baseSha)).version;
    const [major, release] = parseVersion(baseVersion);
    const headManifest = readManifest(headSha);
    const headVersion = JSON.parse(headManifest).version;
    parseVersion(headVersion);
    let version = `${major}.${release + 1n}`;
    // Preserve an already valid release or an intentional milestone selection.
    if (headVersion === version || headVersion === `${major + 1n}.0`) version = headVersion;

    const ancestor = git(["merge-base", baseSha, headSha]);
    if (ancestor === baseSha && headVersion === version) {
      checkRepositoryVersion(baseSha, headSha, cwd);
      return { sha: headSha, version, changed: false };
    }

    // Remove only the previous app version from the virtual merge input. This
    // avoids conflicts between our earlier bump and newer main releases, while
    // leaving genuine dependency and source conflicts for a maintainer.
    const ancestorVersion = JSON.parse(readManifest(ancestor)).version;
    let mergeHead = headSha;
    if (headVersion !== ancestorVersion) {
      const tree = changeVersion(headSha, headManifest, ancestorVersion);
      mergeHead = git(["commit-tree", tree, "-p", headSha, "-m", "Normalize app version for dependency preparation"]);
    }
    let mergedTree;
    try {
      mergedTree = git(["merge-tree", "--write-tree", baseSha, mergeHead]).split("\n")[0];
    } catch {
      throw new Error("Dependency branch conflicts with main; resolve its dependency or source changes before retrying.");
    }
    const mergedManifest = readManifest(mergedTree);
    const tree = changeVersion(mergedTree, mergedManifest, version);
    const parents = ancestor === baseSha ? ["-p", headSha] : ["-p", headSha, "-p", baseSha];
    const sha = git(["commit-tree", tree, ...parents, "-m", `Prepare dependency release v${version}`]);
    checkRepositoryVersion(baseSha, sha, cwd);
    return { sha, version, changed: true };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export async function prepareDependency(api, pullRequest, classification, {
  cwd = process.cwd(), token, appSlug,
  createCommit = createPreparationCommit,
  push,
} = {}) {
  if (!isDependabotPullRequest(pullRequest, api.repository) || pullRequest.base.ref !== "main" || pullRequest.draft) {
    throw new Error("Preparation is limited to same-repository Dependabot PRs targeting main.");
  }
  if (!classification || classification.headSha !== pullRequest.head.sha) {
    throw new Error("The current dependency commit needs a trusted classification before preparation.");
  }
  if (!token || !appSlug) throw new Error("Configure DEPENDENCY_APP_ID and DEPENDENCY_APP_PRIVATE_KEY before preparing dependencies.");

  const base = await api.request("/git/ref/heads/main");
  const baseSha = base.object.sha;
  const headSha = pullRequest.head.sha;
  const git = gitCommand(cwd);
  if (createCommit === createPreparationCommit) {
    git(["fetch", "origin", baseSha, headSha, "--tags"]);
  }
  const prepared = createCommit({ cwd, baseSha, headSha, appSlug });
  const latest = await api.request(`/pulls/${pullRequest.number}`);
  const latestBase = await api.request("/git/ref/heads/main");
  if (latest.state !== "open" || latest.head.sha !== headSha || latest.base.ref !== "main" || latestBase.object.sha !== baseSha) {
    return { state: "stale" };
  }

  const attested = {
    ...classification,
    headSha: prepared.sha,
    preparation: { baseSha, version: prepared.version, sourceHeadSha: classification.preparation?.sourceHeadSha ?? headSha },
  };
  // Attest before pushing: synchronize events can arrive immediately. Keep the
  // source attestation too, so a rejected concurrent push remains retryable.
  if (prepared.changed || classification.preparation?.baseSha !== baseSha) {
    await upsertClassificationComment(api, { ...pullRequest, head: { ...pullRequest.head, sha: prepared.sha } }, attested);
  }
  if (prepared.changed) {
    if (push) await push(prepared.sha, pullRequest.head.ref);
    else {
      const temporary = mkdtempSync(join(tmpdir(), "mind-dependency-auth-"));
      try {
        const askpass = join(temporary, "askpass");
        writeFileSync(askpass, '#!/bin/sh\ncase "$1" in\n  *Username*) printf "%s" "x-access-token" ;;\n  *Password*) printf "%s" "$DEPENDENCY_PREPARATION_TOKEN" ;;\nesac\n', { mode: 0o700 });
        const authenticatedGit = gitCommand(cwd, {
          GIT_ASKPASS: askpass, GIT_TERMINAL_PROMPT: "0", DEPENDENCY_PREPARATION_TOKEN: token,
        });
        try {
          authenticatedGit(["push", "origin", `${prepared.sha}:refs/heads/${pullRequest.head.ref}`]);
        } catch {
          throw new Error("Could not push dependency preparation; the branch may have moved or App permissions may be missing. No force push was attempted.");
        }
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    }
    return { state: "prepared", ...prepared };
  }
  return { state: "ready", classification: attested };
}
