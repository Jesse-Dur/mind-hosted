import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPreparationCommit, prepareDependency } from "./dependency-preparation.mjs";
import { GITHUB_ACTIONS_BOT_ID, GITHUB_ACTIONS_BOT_LOGIN, trustedClassification } from "./dependency-gate.mjs";

function repository() {
  const cwd = mkdtempSync(join(tmpdir(), "mind-dependency-git-test-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const manifest = (version: string, dependency = "1.0.0") => {
    writeFileSync(join(cwd, "frontend/package.json"), `${JSON.stringify({ name: "frontend", version, dependencies: { example: dependency } }, null, 2)}\n`);
  };
  const commit = (message: string) => {
    git("add", ".");
    git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", message);
    return git("rev-parse", "HEAD");
  };
  git("init", "-b", "main");
  mkdirSync(join(cwd, "frontend"));
  manifest("6.3");
  const baseSha = commit("Initial app");
  git("checkout", "-b", "dependency");
  manifest("6.3", "1.1.0");
  const headSha = commit("Dependency update");
  const prepare = (base = baseSha, head = headSha) => createPreparationCommit({ cwd, baseSha: base, headSha: head, appSlug: "mind-test" });
  const read = (sha: string) => JSON.parse(git("show", `${sha}:frontend/package.json`));
  return { cwd, git, manifest, commit, baseSha, headSha, prepare, read, close: () => rmSync(cwd, { recursive: true, force: true }) };
}

describe("dependency preparation Git objects", () => {
  test("adds just the app version while preserving dependency changes and the working checkout", () => {
    const r = repository();
    try {
      const before = readFileSync(join(r.cwd, "frontend/package.json"), "utf8");
      const result = r.prepare();
      expect(result.version).toBe("6.4");
      expect(r.read(result.sha)).toEqual({ name: "frontend", version: "6.4", dependencies: { example: "1.1.0" } });
      expect(r.git("show", "--format=", "--name-only", result.sha)).toBe("frontend/package.json");
      expect(r.git("rev-parse", "HEAD")).toBe(r.headSha);
      expect(readFileSync(join(r.cwd, "frontend/package.json"), "utf8")).toBe(before);
      expect(r.git("status", "--short")).toBe("");
      expect(r.prepare(r.baseSha, result.sha)).toEqual({ sha: result.sha, version: "6.4", changed: false });
    } finally { r.close(); }
  });

  test("refreshes a prepared branch after main advances multiple versions, preserving both sides", () => {
    const r = repository();
    try {
      const first = r.prepare();
      r.git("checkout", "main");
      r.manifest("6.5");
      writeFileSync(join(r.cwd, "main-change.txt"), "new main content\n");
      const main = r.commit("New main release");
      const refreshed = r.prepare(main, first.sha);
      expect(r.read(refreshed.sha)).toEqual({ name: "frontend", version: "6.6", dependencies: { example: "1.1.0" } });
      expect(r.git("show", `${refreshed.sha}:main-change.txt`)).toBe("new main content");
      expect(r.git("rev-list", "--parents", "-n", "1", refreshed.sha).split(" ").slice(1)).toEqual([first.sha, main]);
      expect(r.git("rev-parse", "HEAD")).toBe(main);
    } finally { r.close(); }
  });

  test("keeps a valid intentional milestone version", () => {
    const r = repository();
    try {
      r.manifest("7.0", "1.1.0");
      const milestone = r.commit("Intentional milestone");
      expect(r.prepare(r.baseSha, milestone)).toEqual({ sha: milestone, version: "7.0", changed: false });
    } finally { r.close(); }
  });

  test("does not resolve real dependency conflicts by discarding either change", () => {
    const r = repository();
    try {
      r.git("checkout", "main");
      r.manifest("6.4", "2.0.0");
      const main = r.commit("Conflicting dependency update");
      expect(() => r.prepare(main)).toThrow("conflicts with main");
      expect(r.git("rev-parse", "dependency")).toBe(r.headSha);
    } finally { r.close(); }
  });

  test("rejects a next version whose tag already exists", () => {
    const r = repository();
    try {
      r.git("tag", "v6.4", r.baseSha);
      expect(() => r.prepare()).toThrow("already been used");
    } finally { r.close(); }
  });
});

const sourceClassification = { headSha: "source", updateLevel: "minor", githubActions: false, security: false, securityLookupAvailable: false };

function apiFixture({ movedHead = false, movedBase = false, changed = true } = {}) {
  const pullRequest = {
    number: 65, state: "open", draft: false, user: { login: "dependabot[bot]" },
    base: { ref: "main", sha: "base" },
    head: { sha: "source", ref: "dependabot/bun/example", repo: { full_name: "owner/mind" } },
  };
  const events: string[] = [];
  const comments: any[] = [{ user: { id: GITHUB_ACTIONS_BOT_ID, login: GITHUB_ACTIONS_BOT_LOGIN }, body: `<!-- mind-dependency-classification:${JSON.stringify(sourceClassification)} -->` }];
  let baseReads = 0;
  const api = {
    repository: "owner/mind",
    async request(path: string, options?: any): Promise<any> {
      events.push(`${options?.method ?? "GET"} ${path}`);
      if (path === "/git/ref/heads/main") return { object: { sha: movedBase && baseReads++ > 0 ? "new-base" : "base" } };
      if (path === "/pulls/65") return { ...pullRequest, head: { ...pullRequest.head, sha: movedHead ? "new-head" : "source" } };
      if (path === "/issues/65/comments" && options?.method === "POST") {
        comments.push({ user: { id: GITHUB_ACTIONS_BOT_ID, login: GITHUB_ACTIONS_BOT_LOGIN }, body: options.body.body });
        return {};
      }
      throw new Error(`Unexpected API request ${path}`);
    },
    async paginate() { return comments; },
  };
  const options = {
    token: "test-token", appSlug: "mind-test",
    createCommit: () => ({ sha: changed ? "prepared" : "source", version: "6.4", changed }),
    push: async () => { events.push("push"); },
  };
  return { api, pullRequest, options, events, comments };
}

describe("trusted dependency preparation", () => {
  test("attests the prepared SHA before pushing and keeps the source classification retryable", async () => {
    const f = apiFixture();
    expect((await prepareDependency(f.api, f.pullRequest, sourceClassification, f.options)).state).toBe("prepared");
    expect(f.events.slice(-2)).toEqual(["POST /issues/65/comments", "push"]);
    expect(trustedClassification(f.comments, "source")).toEqual(sourceClassification);
    expect(trustedClassification(f.comments, "prepared")).toEqual({
      ...sourceClassification, headSha: "prepared", preparation: { baseSha: "base", version: "6.4", sourceHeadSha: "source" },
    });
  });

  for (const race of [{ movedHead: true }, { movedBase: true }]) {
    test(`a concurrent change prevents attestation and push: ${JSON.stringify(race)}`, async () => {
      const f = apiFixture(race);
      expect((await prepareDependency(f.api, f.pullRequest, sourceClassification, f.options)).state).toBe("stale");
      expect(f.events.some((event) => event.startsWith("POST") || event === "push")).toBe(false);
    });
  }

  test("a preparation retry with the same base and head writes nothing", async () => {
    const f = apiFixture({ changed: false });
    const classification = { ...sourceClassification, preparation: { baseSha: "base", version: "6.4", sourceHeadSha: "source" } };
    expect((await prepareDependency(f.api, f.pullRequest, classification, f.options)).state).toBe("ready");
    expect(f.events.some((event) => event.startsWith("POST") || event === "push")).toBe(false);
  });

  test("a rejected push retains the original trusted classification for retry", async () => {
    const f = apiFixture();
    await expect(prepareDependency(f.api, f.pullRequest, sourceClassification, {
      ...f.options, push: async () => { throw new Error("Branch moved during push"); },
    })).rejects.toThrow("Branch moved during push");
    expect(trustedClassification(f.comments, "source")).toEqual(sourceClassification);
    expect(trustedClassification(f.comments, "prepared")?.headSha).toBe("prepared");
  });

  test("unclassified commits, forks, other authors, drafts, and missing credentials cannot be pushed", async () => {
    const f = apiFixture();
    await expect(prepareDependency(f.api, f.pullRequest, { ...sourceClassification, headSha: "old" }, f.options)).rejects.toThrow("trusted classification");
    await expect(prepareDependency(f.api, { ...f.pullRequest, user: { login: "someone" } }, sourceClassification, f.options)).rejects.toThrow("same-repository Dependabot");
    await expect(prepareDependency(f.api, { ...f.pullRequest, head: { ...f.pullRequest.head, repo: { full_name: "fork/mind" } } }, sourceClassification, f.options)).rejects.toThrow("same-repository Dependabot");
    await expect(prepareDependency(f.api, { ...f.pullRequest, draft: true }, sourceClassification, f.options)).rejects.toThrow("same-repository Dependabot");
    await expect(prepareDependency(f.api, f.pullRequest, sourceClassification, { ...f.options, token: "" })).rejects.toThrow("Configure DEPENDENCY_APP_ID");
    expect(f.events).toHaveLength(0);
  });
});
