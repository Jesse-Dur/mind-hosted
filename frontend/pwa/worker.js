/* CONFIG is generated from the completed production build. */
const { cache: CACHE, shell: SHELL, precache: PRECACHE, workspaces: WORKSPACES } = CONFIG;
const WORKSPACE_MARKER = "/__mind-workspace/";
const assets = new Set([...PRECACHE, ...Object.values(WORKSPACES).flat()]);
const isClerkAsset = url => url.protocol === "https:" && url.pathname.startsWith("/npm/@clerk/clerk-js@") && url.pathname.endsWith(".js");

async function cacheRequired(cache, urls) {
  await Promise.all(urls.map(async url => {
    if (await cache.match(url)) return;
    const response = await fetch(url, { cache: "reload" });
    if (!response.ok || (url.endsWith(".js") && !/javascript/.test(response.headers.get("Content-Type") || ""))) {
      throw new Error(`Could not cache ${url}`);
    }
    if (url === SHELL) {
      const digest = await crypto.subtle.digest("SHA-256", await response.clone().arrayBuffer());
      const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      if (hex !== CONFIG.shellDigest) throw new Error("App shell belongs to a different build");
    }
    await cache.put(url, response);
  }));
}

async function prepareWorkspace(cache, workspace) {
  if (!Object.hasOwn(WORKSPACES, workspace)) throw new Error("Unknown workspace");
  await cacheRequired(cache, WORKSPACES[workspace]);
  await cache.put(WORKSPACE_MARKER + workspace, new Response("ready"));
}

self.addEventListener("install", event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await cacheRequired(cache, PRECACHE);
  // A waiting worker can activate after the last tab closes. Prepare layouts
  // used by the previous build during installation as well as on Update.
  const layouts = new Set();
  for (const name of await caches.keys()) {
    if (!name.startsWith("mind-shell-") || name === CACHE) continue;
    const previous = await caches.open(name);
    for (const layout of Object.keys(WORKSPACES)) {
      if (await previous.match(WORKSPACE_MARKER + layout)) layouts.add(layout);
    }
  }
  await Promise.all([...layouts].map(layout => prepareWorkspace(cache, layout)));
})()));

self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
// Retain prior build caches: another tab can still be running its old scripts
// when this worker takes control. Each worker reads its own shell explicitly.

self.addEventListener("message", event => {
  const data = event.data;
  if (!data || !["CACHE_URLS", "PREPARE_UPDATE", "SKIP_WAITING"].includes(data.type)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    if (data.workspace) await prepareWorkspace(cache, data.workspace);
    const urls = (Array.isArray(data.urls) ? data.urls : []).filter(value => {
      if (typeof value !== "string") return false;
      const url = new URL(value, self.location.origin);
      return url.origin === self.location.origin && assets.has(url.pathname) && url.pathname !== SHELL || isClerkAsset(url);
    });
    // Clerk is loaded outside the local module graph. Copy its already cached
    // script into the new build so accepting an update also works offline.
    await Promise.all(urls.map(async url => {
      if (await cache.match(url)) return;
      const previous = await caches.match(url);
      if (previous) await cache.put(url, previous);
      else await cacheRequired(cache, [url]);
    }));
    if (data.type === "SKIP_WAITING") await self.skipWaiting();
    event.ports[0]?.postMessage({ ok: true });
  })().catch(error => {
    event.ports[0]?.postMessage({ ok: false, error: String(error) });
  }));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const clerkAsset = request.destination === "script" && isClerkAsset(url);
  if (url.origin !== self.location.origin && !clerkAsset || url.origin === self.location.origin && url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(SHELL)).then(cached => cached || fetch(request)));
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    // Hashed scripts requested by a tab from the previous build remain usable.
    const previous = await caches.match(request);
    if (previous) return previous;
    const response = await fetch(request);
    if ((assets.has(url.pathname) || clerkAsset) && (response.ok || response.type === "opaque")) {
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
