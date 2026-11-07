import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkRepositoryVersion, parseVersion, validateVersion } from "./version-policy.mjs";

describe("two-part app version policy", () => {
  test("increments the release counter without treating it as a decimal", () => {
    expect(validateVersion({ baseVersion: "6.9", version: "6.10" })).toBe("6.10");
    expect(validateVersion({ baseVersion: "6.99", version: "6.100" })).toBe("6.100");
  });

  test("allows an intentional milestone or incompatibility to reset the counter", () => {
    expect(validateVersion({ baseVersion: "6.12", version: "7.0" })).toBe("7.0");
  });

  for (const version of ["6.2", "6.1", "6.4", "7.1", "8.0"]) {
    test(`rejects an unchanged, backwards, or skipped version: ${version}`, () => {
      expect(() => validateVersion({ baseVersion: "6.2", version })).toThrow("must change");
    });
  }

  for (const version of [undefined, 6.3, "6", "6.3.0", "v6.3", "06.3", "6.03", "6.-1", "6.3-beta", "6.3\n"]) {
    test(`rejects invalid version ${JSON.stringify(version)}`, () => {
      expect(() => parseVersion(version)).toThrow("two integers");
    });
  }

  test("rejects a duplicate tag even if it is not on main", () => {
    expect(() => validateVersion({ baseVersion: "6.2", version: "6.3", tags: ["v6.3"] })).toThrow("already been used");
  });

  test("rejects a version previously used on main even without a tag", () => {
    expect(() => validateVersion({ baseVersion: "6.2", version: "6.3", previousVersions: ["6.3", "6.2"] })).toThrow("already been used");
  });
});

test("checks the PR head against current main, rejecting a second PR after the same version merges", () => {
  const root = mkdtempSync(join(tmpdir(), "mind-version-policy-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const commitVersion = (version: string) => {
    writeFileSync(join(root, "frontend/package.json"), JSON.stringify({ version }));
    git("add", ".");
    git("-c", "user.name=Version test", "-c", "user.email=version@example.invalid", "commit", "-m", version);
    return git("rev-parse", "HEAD");
  };
  try {
    git("init", "-b", "main");
    mkdirSync(join(root, "frontend"));
    commitVersion("6.2");
    git("checkout", "-b", "first-pr");
    const first = commitVersion("6.3");
    expect(checkRepositoryVersion("main", first, root)).toBe("6.3");
    git("checkout", "main");
    git("checkout", "-b", "second-pr");
    writeFileSync(join(root, "another-change.txt"), "A distinct PR with the same proposed version\n");
    const second = commitVersion("6.3");
    expect(second).not.toBe(first);
    expect(checkRepositoryVersion("main", second, root)).toBe("6.3");
    git("checkout", "main");
    git("merge", "--ff-only", first);
    expect(() => checkRepositoryVersion("main", second, root)).toThrow("must change from 6.3 to 6.4");
    git("checkout", "second-pr");
    const bumped = commitVersion("6.4");
    expect(checkRepositoryVersion("main", bumped, root)).toBe("6.4");
    git("tag", "v6.4", first);
    expect(() => checkRepositoryVersion("main", bumped, root)).toThrow("already been used");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
