import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function gitAt(cwd) {
  return (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function parseVersion(version) {
  if (typeof version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Invalid app version ${JSON.stringify(version)}; use two integers, for example 6.3.`);
  }
  return version.split(".").map(BigInt);
}

function validateConfig(config) {
  if (!Number.isSafeInteger(config?.major) || config.major < 1 ||
      !Number.isSafeInteger(config?.initialMinor) || config.initialMinor < 0) {
    throw new Error("release.json requires a positive integer major and a non-negative integer initialMinor.");
  }
  return config;
}

function readConfig(git, revision) {
  if (!git("ls-tree", "--name-only", revision, "release.json")) return null;
  return validateConfig(JSON.parse(git("show", `${revision}:release.json`)));
}

export function validateTransition(previous, next) {
  validateConfig(next);
  if (next.major <= previous.major || next.initialMinor !== 0) {
    throw new Error("Changes to release.json must increase the major version and reset initialMinor to zero.");
  }
}

function validateMigration(legacyVersion, config) {
  const [major, minor] = parseVersion(legacyVersion);
  if (!(BigInt(config.major) === major && BigInt(config.initialMinor) === minor + 1n) &&
      !(BigInt(config.major) > major && config.initialMinor === 0)) {
    throw new Error("Calculated numbering must continue after the last package version, or start a new major at zero.");
  }
}

export function releaseVersion(revision = "HEAD", cwd = repositoryRoot) {
  const git = gitAt(cwd);
  if (git("rev-parse", "--is-shallow-repository") === "true") {
    throw new Error("Calculated release numbering requires complete Git history.");
  }
  const sha = git("rev-parse", "--verify", `${revision}^{commit}`);
  const config = readConfig(git, sha);
  if (!config) throw new Error("Missing release.json at the requested revision.");
  const epochs = git("log", "--first-parent", "--format=%H", sha, "--", "release.json").split("\n");
  let previous;
  for (const epoch of [...epochs].reverse()) {
    const current = readConfig(git, epoch);
    if (!current) continue; // Restoring a deleted file must still advance its previous major.
    if (previous) validateTransition(previous, current);
    else {
      const parents = git("rev-list", "--parents", "-n", "1", epoch).split(" ");
      if (parents[1]) {
        const legacy = JSON.parse(git("show", `${parents[1]}:frontend/package.json`));
        validateMigration(legacy.version, current);
      }
    }
    previous = current;
  }
  const count = BigInt(git("rev-list", "--first-parent", "--count", `${epochs[0]}..${sha}`));
  return `${config.major}.${BigInt(config.initialMinor) + count}`;
}

export function checkRepositoryVersion(baseRef, headRef, cwd = repositoryRoot) {
  const git = gitAt(cwd);
  const base = readConfig(git, baseRef);
  const head = readConfig(git, headRef);
  if (!head) throw new Error("Missing release.json at the PR head.");
  if (!base) {
    validateMigration(JSON.parse(git("show", `${baseRef}:frontend/package.json`)).version, head);
  } else if (JSON.stringify(base) !== JSON.stringify(head)) {
    validateTransition(base, head);
  }
  return releaseVersion(headRef, cwd);
}

export function buildVersion(env = process.env, cwd = repositoryRoot) {
  const git = gitAt(cwd);
  if (env.VERCEL_ENV === "production") {
    if (env.VERCEL_GIT_COMMIT_REF !== "main" || !/^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? "")) {
      throw new Error("Production builds require the exact main commit SHA.");
    }
    if (git("rev-parse", "HEAD") !== env.VERCEL_GIT_COMMIT_SHA) throw new Error("Checkout does not match the production commit.");
    return releaseVersion(env.VERCEL_GIT_COMMIT_SHA, cwd);
  }
  let version;
  if (!readConfig(git, "HEAD") && !env.CI && !env.VERCEL) {
    // Allow local work on the migration before its first commit.
    const config = validateConfig(JSON.parse(readFileSync(resolve(cwd, "release.json"), "utf8")));
    validateMigration(JSON.parse(git("show", "HEAD:frontend/package.json")).version, config);
    version = `${config.major}.${config.initialMinor}`;
  } else version = releaseVersion("HEAD", cwd);
  return `${version}-${env.VERCEL ? `preview.${git("rev-parse", "--short=7", "HEAD")}` : "local"}`;
}

export async function prepareBuildHistory(env = process.env, cwd = repositoryRoot, {
  run = execFileSync,
  pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  const git = gitAt(cwd);
  if (!env.VERCEL || git("rev-parse", "--is-shallow-repository") !== "true") return;
  // Vercel removes remotes after cloning. Its repository metadata identifies
  // the source even when a project is renamed, transferred, or forked.
  let remote = "origin";
  if (!git("remote").split("\n").includes(remote)) {
    const owner = env.VERCEL_GIT_REPO_OWNER;
    const slug = env.VERCEL_GIT_REPO_SLUG;
    if (!/^[a-zA-Z0-9-]+$/.test(owner ?? "") ||
        !/^[a-zA-Z0-9_.-]+$/.test(slug ?? "") || [".", ".."].includes(slug)) {
      throw new Error("Vercel repository owner and slug are required to fetch build history without origin.");
    }
    remote = `https://github.com/${owner}/${slug}.git`;
  }
  const sha = git("rev-parse", "HEAD");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      run("git", ["fetch", "--unshallow", remote, sha], { cwd, stdio: "inherit", timeout: 30_000 });
      return;
    } catch (error) {
      if (attempt === 2) throw new Error("Could not fetch complete build history after three attempts.", { cause: error });
      await pause(1_000 * 2 ** attempt);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === "--prepare-build") {
      await prepareBuildHistory();
      console.log(`App version: ${buildVersion()}`);
    } else console.log(releaseVersion(process.argv[2]));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
