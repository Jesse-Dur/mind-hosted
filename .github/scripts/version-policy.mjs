import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function parseVersion(version) {
  if (typeof version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Invalid app version ${JSON.stringify(version)}; use two integers, for example 6.3.`);
  }
  return version.split(".").map(BigInt);
}

export function validateVersion({ version, baseVersion, tags = [], previousVersions = [] }) {
  parseVersion(version);
  const [major, release] = parseVersion(baseVersion);
  const next = `${major}.${release + 1n}`;
  const milestone = `${major + 1n}.0`;
  if (version !== next && version !== milestone) {
    throw new Error(`App version must change from ${baseVersion} to ${next}, or ${milestone} for an intentional milestone or incompatibility; received ${version}.`);
  }
  if (tags.includes(`v${version}`) || previousVersions.includes(version)) {
    throw new Error(`App version ${version} has already been used. Published versions and tags cannot be reused.`);
  }
  return version;
}

export function checkRepositoryVersion(baseRef, headRef, cwd = process.cwd()) {
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const readVersion = (ref) => JSON.parse(git("show", `${ref}:frontend/package.json`)).version;
  const revisions = git("log", "--first-parent", "--format=%H", baseRef, "--", "frontend/package.json");
  return validateVersion({
    version: readVersion(headRef),
    baseVersion: readVersion(baseRef),
    tags: git("tag", "--list").split("\n"),
    previousVersions: revisions.split("\n").filter(Boolean).map(readVersion),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [baseRef, headRef] = process.argv.slice(2);
    if (!baseRef || !headRef) throw new Error("Usage: node version-policy.mjs <current-main-ref> <pr-head-ref>");
    console.log(`Version policy passed: ${checkRepositoryVersion(baseRef, headRef)}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
