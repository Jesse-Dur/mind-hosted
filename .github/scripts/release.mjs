import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { GitHubApi } from "./dependency-gate.mjs";
import { parseVersion } from "./version-policy.mjs";

async function optionalRequest(api, path) {
  try {
    return await api.request(path);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

export async function publishRelease(api, { version, sha }) {
  parseVersion(version);
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("A full release commit SHA is required.");
  const tag = `v${version}`;
  const existingRef = await optionalRequest(api, `/git/ref/tags/${tag}`);
  if (existingRef) {
    let object = existingRef.object;
    while (object.type === "tag") {
      object = (await api.request(`/git/tags/${object.sha}`)).object;
    }
    if (object.type !== "commit" || object.sha !== sha) {
      throw new Error(`Tag ${tag} already identifies another commit; release tags cannot be moved.`);
    }
  } else {
    const annotation = await api.request("/git/tags", {
      method: "POST",
      body: { tag, message: `Mind ${tag}`, object: sha, type: "commit" },
    });
    await api.request("/git/refs", {
      method: "POST",
      body: { ref: `refs/tags/${tag}`, sha: annotation.sha },
    });
  }

  const existingRelease = await optionalRequest(api, `/releases/tags/${tag}`);
  if (existingRelease) {
    if (existingRelease.draft) throw new Error(`Release ${tag} already exists as a draft; publish it explicitly.`);
    return existingRelease;
  }

  const notes = await api.request("/releases/generate-notes", {
    method: "POST", body: { tag_name: tag, target_commitish: sha },
  });
  return api.request("/releases", {
    method: "POST",
    body: { tag_name: tag, target_commitish: sha, name: tag, body: notes.body, draft: false, prerelease: false },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { GITHUB_REPOSITORY: repository, GITHUB_TOKEN: token, GITHUB_SHA: sha } = process.env;
    if (!repository || !token || !sha) throw new Error("GITHUB_REPOSITORY, GITHUB_TOKEN, and GITHUB_SHA are required.");
    const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    if (head !== sha) throw new Error("Checkout does not match the deployed commit.");
    const { version } = JSON.parse(readFileSync("frontend/package.json", "utf8"));
    const release = await publishRelease(new GitHubApi(repository, token), { version, sha });
    console.log(`Release published: ${release.html_url}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
