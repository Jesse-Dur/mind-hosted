import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildVersion, checkRepositoryVersion, parseVersion, prepareBuildHistory, releaseVersion } from "../../scripts/release-version.mjs";

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), "mind-release-version-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "main");
  git("config", "user.name", "Release test");
  git("config", "user.email", "release@example.invalid");
  const commit = (message = "change") => {
    git("add", "-A");
    git("commit", "--allow-empty", "-m", message);
    return git("rev-parse", "HEAD");
  };
  const config = (major: number, initialMinor = 0) => writeFileSync(join(cwd, "release.json"), JSON.stringify({ major, initialMinor }));
  mkdirSync(join(cwd, "frontend"));
  writeFileSync(join(cwd, "frontend/package.json"), JSON.stringify({ version: "6.25" }));
  const legacy = commit("legacy v6.25");
  git("tag", "v6.25");
  config(6, 26);
  const migration = commit("calculated versions");
  return { cwd, git, commit, config, legacy, migration, clean: () => rmSync(cwd, { recursive: true, force: true }) };
}

function using(run: (r: ReturnType<typeof fixture>) => void) {
  const r = fixture();
  try { run(r); } finally { r.clean(); }
}

describe("calculated two-part release versions", () => {
  test("continues after v6.25 and keeps existing tags unchanged", () => using((r) => {
    expect(checkRepositoryVersion(r.legacy, r.migration, r.cwd)).toBe("6.26");
    expect(releaseVersion(r.commit(), r.cwd)).toBe("6.27");
    expect(releaseVersion(r.migration, r.cwd)).toBe("6.26");
    expect(r.git("rev-parse", "v6.25")).toBe(r.legacy);
  }));

  test("the migration merge starts at 6.26 regardless of its internal commits", () => using((r) => {
    r.git("checkout", "-b", "migration-pr");
    r.commit(); r.commit();
    r.git("checkout", "main");
    r.git("reset", "--hard", r.legacy);
    r.git("merge", "--no-ff", "migration-pr", "-m", "Merge calculated versions");
    expect(releaseVersion("HEAD", r.cwd)).toBe("6.26");
  }));

  for (const config of [{ major: 0, initialMinor: 0 }, { major: 7, initialMinor: -1 }, { major: 7.5, initialMinor: 0 }, { major: 7 }, { major: "7", initialMinor: 0 }]) {
    test(`rejects malformed release configuration ${JSON.stringify(config)}`, () => using((r) => {
      writeFileSync(join(r.cwd, "release.json"), JSON.stringify(config));
      const head = r.commit("bad config");
      expect(() => releaseVersion(head, r.cwd)).toThrow("requires a positive integer");
    }));
  }

  test("counts a multi-commit PR once and accepts PRs without a version edit", () => using((r) => {
    r.git("checkout", "-b", "feature");
    r.commit(); r.commit(); r.commit();
    const head = r.git("rev-parse", "HEAD");
    expect(checkRepositoryVersion(r.migration, head, r.cwd)).toBe("6.29");
    r.git("checkout", "main");
    r.git("merge", "--no-ff", "feature", "-m", "Merge feature");
    expect(releaseVersion("HEAD", r.cwd)).toBe("6.27");
    r.git("checkout", "-b", "dependency");
    writeFileSync(join(r.cwd, "frontend/package.json"), JSON.stringify({ dependencies: { example: "2.0.0" } }));
    expect(checkRepositoryVersion("main", r.commit("dependency update"), r.cwd)).toBe("6.28");
  }));

  test("a milestone starts at zero and later merges advance its counter", () => using((r) => {
    r.config(7);
    const major = r.commit("milestone");
    expect(checkRepositoryVersion(r.migration, major, r.cwd)).toBe("7.0");
    expect(releaseVersion(r.commit(), r.cwd)).toBe("7.1");
  }));

  for (const [major, initialMinor] of [[6, 26], [6, 0], [5, 0], [7, 1]]) {
    test(`rejects a reset or invalid milestone ${major}.${initialMinor}`, () => using((r) => {
      r.config(major, initialMinor);
      // A formatting-only rewrite is a change too; it must not reset the counter.
      writeFileSync(join(r.cwd, "release.json"), `${JSON.stringify({ major, initialMinor }, null, 2)}\n`);
      const head = r.commit("reset attempt");
      expect(() => checkRepositoryVersion(r.migration, head, r.cwd)).toThrow("increase the major");
    }));
  }

  test("deleting and restoring configuration cannot reuse a previous major", () => using((r) => {
    r.git("rm", "release.json");
    r.commit("delete config");
    expect(() => releaseVersion("HEAD", r.cwd)).toThrow("Missing release.json");
    r.config(6, 26);
    r.commit("restore config");
    expect(() => releaseVersion("HEAD", r.cwd)).toThrow("increase the major");
  }));

  test("migration rejects overlapping legacy versions", () => using((r) => {
    r.git("reset", "--hard", r.legacy);
    r.config(6, 25);
    const head = r.commit("bad migration");
    expect(() => checkRepositoryVersion(r.legacy, head, r.cwd)).toThrow("continue after");
    expect(() => releaseVersion(head, r.cwd)).toThrow("continue after");
  }));

  test("shallow clones fail rather than publishing a reused number", () => using((r) => {
    const shallow = join(r.cwd, "shallow");
    execFileSync("git", ["clone", "--depth=1", `file://${r.cwd}`, shallow], { stdio: "pipe" });
    expect(() => releaseVersion("HEAD", shallow)).toThrow("complete Git history");
  }));

  function vercelCheckout(r: ReturnType<typeof fixture>) {
    r.git("checkout", "-b", "preview-branch");
    const preview = r.commit("preview change");
    r.git("checkout", "main");
    const cwd = join(r.cwd, "vercel-checkout");
    execFileSync("git", ["clone", "--depth=1", "--branch", "preview-branch", `file://${r.cwd}`, cwd], { stdio: "pipe" });
    const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
    git("remote", "remove", "origin");
    const env = { VERCEL: "1", VERCEL_GIT_REPO_OWNER: "Renamed-Owner", VERCEL_GIT_REPO_SLUG: "renamed-mind" };
    // Route the renamed repository URL to this fixture without using the network.
    git("config", `url.file://${r.cwd}.insteadOf`, `https://github.com/${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}.git`);
    return { cwd, git, env, preview };
  }

  test("Vercel's shallow checkout fetches its source repository's history without origin", async () => {
    const r = fixture();
    try {
      const v = vercelCheckout(r);
      expect(() => releaseVersion("HEAD", v.cwd)).toThrow("complete Git history");
      await prepareBuildHistory(v.env, v.cwd);
      expect(v.git("rev-parse", "--is-shallow-repository")).toBe("false");
      expect(releaseVersion("HEAD", v.cwd)).toBe("6.27");
      expect(buildVersion({ VERCEL: "1", VERCEL_ENV: "preview" }, v.cwd)).toBe(`6.27-preview.${v.preview.slice(0, 7)}`);
    } finally { r.clean(); }
  });

  test("transient history-fetch failures retry with backoff and recover the exact version", async () => {
    const r = fixture();
    try {
      const v = vercelCheckout(r);
      const delays: number[] = [];
      let attempts = 0;
      await prepareBuildHistory(v.env, v.cwd, {
        run: (command: string, args: string[], options: any) => {
          expect(options.timeout).toBe(30_000);
          if (++attempts < 3) throw new Error("Temporary network failure");
          return execFileSync(command, args, options);
        },
        pause: async (ms: number) => { delays.push(ms); },
      });
      expect(attempts).toBe(3);
      expect(delays).toEqual([1000, 2000]);
      expect(releaseVersion("HEAD", v.cwd)).toBe("6.27");
    } finally { r.clean(); }
  });

  test("persistent fetch failures stop after three attempts and cannot produce a release number", async () => {
    const r = fixture();
    try {
      const v = vercelCheckout(r);
      let attempts = 0;
      const delays: number[] = [];
      await expect(prepareBuildHistory(v.env, v.cwd, {
        run: () => { attempts += 1; throw new Error("Network unavailable"); },
        pause: async (ms: number) => { delays.push(ms); },
      })).rejects.toThrow("after three attempts");
      expect(attempts).toBe(3);
      expect(delays).toEqual([1000, 2000]);
      expect(() => releaseVersion("HEAD", v.cwd)).toThrow("complete Git history");
    } finally { r.clean(); }
  });

  test("missing or invalid repository metadata cannot select a fallback remote", async () => {
    const r = fixture();
    try {
      const v = vercelCheckout(r);
      for (const env of [{ VERCEL: "1" }, { ...v.env, VERCEL_GIT_REPO_OWNER: "owner/other" }, { ...v.env, VERCEL_GIT_REPO_SLUG: ".." }]) {
        await expect(prepareBuildHistory(env, v.cwd)).rejects.toThrow("repository owner and slug");
      }
    } finally { r.clean(); }
  });

  test("production builds use the exact release number while previews and local builds are identified", () => using((r) => {
    const production = { VERCEL: "1", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main", VERCEL_GIT_COMMIT_SHA: r.migration };
    expect(buildVersion(production, r.cwd)).toBe("6.26");
    expect(buildVersion({ VERCEL: "1", VERCEL_ENV: "preview" }, r.cwd)).toBe(`6.26-preview.${r.migration.slice(0, 7)}`);
    expect(buildVersion({}, r.cwd)).toBe("6.26-local");
    expect(() => buildVersion({ ...production, VERCEL_GIT_COMMIT_REF: "feature" }, r.cwd)).toThrow("exact main commit");
    expect(() => buildVersion({ ...production, VERCEL_GIT_COMMIT_SHA: r.legacy }, r.cwd)).toThrow("does not match");
  }));

  for (const version of [undefined, 6.3, "6", "6.3.0", "v6.3", "06.3", "6.03", "6.-1", "6.3-beta", "6.3\n"]) {
    test(`rejects invalid version ${JSON.stringify(version)}`, () => {
      expect(() => parseVersion(version)).toThrow("two integers");
    });
  }
});
