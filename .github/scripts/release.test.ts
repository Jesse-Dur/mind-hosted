import { describe, expect, test } from "bun:test";
import { publishRelease } from "./release.mjs";

const sha = "a".repeat(40);
const annotationSha = "b".repeat(40);
const otherSha = "c".repeat(40);
const release = { html_url: "https://github.com/example/mind/releases/tag/v6.3", draft: false };

function fixture({ tagged = false, released = false, target = sha, lightweight = false, lookupError = 404 } = {}) {
  const calls: Array<{ path: string; options?: any }> = [];
  let hasTag = tagged;
  let hasRelease = released;
  const api = {
    async request(path: string, options?: any): Promise<any> {
      calls.push({ path, options });
      const missing = () => { throw Object.assign(new Error("lookup failed"), { status: lookupError }); };
      if (path === "/git/ref/tags/v6.3") {
        if (!hasTag) return missing();
        return { object: lightweight ? { type: "commit", sha: target } : { type: "tag", sha: annotationSha } };
      }
      if (path === `/git/tags/${annotationSha}`) return { object: { type: "commit", sha: target } };
      if (path === "/git/tags") return { sha: annotationSha };
      if (path === "/git/refs") { hasTag = true; return {}; }
      if (path === "/releases/tags/v6.3") {
        if (!hasRelease) return missing();
        return release;
      }
      if (path === "/releases/generate-notes") return { body: "Changes from merged pull requests" };
      if (path === "/releases") { hasRelease = true; return release; }
      throw new Error(`Unexpected API call: ${path}`);
    },
  };
  return { api, calls };
}

describe("release publication", () => {
  test("creates an annotated tag for the exact deployed commit, then publishes generated notes", async () => {
    const { api, calls } = fixture();
    expect(await publishRelease(api, { version: "6.3", sha })).toEqual(release);
    expect(calls.find(({ path }) => path === "/git/tags")?.options.body).toEqual({ tag: "v6.3", message: "Mind v6.3", object: sha, type: "commit" });
    expect(calls.find(({ path }) => path === "/git/refs")?.options.body).toEqual({ ref: "refs/tags/v6.3", sha: annotationSha });
    expect(calls.at(-1)).toEqual({ path: "/releases", options: { method: "POST", body: {
      tag_name: "v6.3", target_commitish: sha, name: "v6.3", body: "Changes from merged pull requests", draft: false, prerelease: false,
    } } });
  });

  test("rerunning a completed publication makes no writes", async () => {
    const { api, calls } = fixture({ tagged: true, released: true });
    expect(await publishRelease(api, { version: "6.3", sha })).toEqual(release);
    expect(calls.every(({ options }) => !options?.method)).toBe(true);
  });

  test("recovers when publication stopped after creating its tag", async () => {
    const { api, calls } = fixture({ tagged: true });
    await publishRelease(api, { version: "6.3", sha });
    expect(calls.filter(({ options }) => options?.method === "POST").map(({ path }) => path)).toEqual(["/releases/generate-notes", "/releases"]);
  });

  test("a second complete run does not create a duplicate release", async () => {
    const { api, calls } = fixture();
    await publishRelease(api, { version: "6.3", sha });
    calls.length = 0;
    await publishRelease(api, { version: "6.3", sha });
    expect(calls.every(({ options }) => !options?.method)).toBe(true);
  });

  for (const lightweight of [true, false]) {
    test(`refuses an existing ${lightweight ? "lightweight" : "annotated"} tag on another commit`, async () => {
      const { api, calls } = fixture({ tagged: true, target: otherSha, lightweight });
      await expect(publishRelease(api, { version: "6.3", sha })).rejects.toThrow("cannot be moved");
      expect(calls.every(({ options }) => !options?.method)).toBe(true);
    });
  }

  test("authentication and API failures do not look like missing tags", async () => {
    const { api, calls } = fixture({ lookupError: 403 });
    await expect(publishRelease(api, { version: "6.3", sha })).rejects.toThrow("lookup failed");
    expect(calls).toHaveLength(1);
  });

  test("invalid versions or commit IDs cannot create tags", async () => {
    const { api, calls } = fixture();
    await expect(publishRelease(api, { version: "6.3.0", sha })).rejects.toThrow("two integers");
    await expect(publishRelease(api, { version: "6.3", sha: "main" })).rejects.toThrow("full release commit SHA");
    expect(calls).toHaveLength(0);
  });
});
