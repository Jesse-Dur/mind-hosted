/* CONFIG is generated from the completed production build. */
const { cache: CACHE, shell: SHELL, precache: PRECACHE, workspaces: WORKSPACES } = CONFIG;
const WORKSPACE_MARKER = "/__mind-workspace/";
const META_CACHE = "mind-pwa-metadata-v1";
const ACTIVATION_KEY = "/__mind-activation";
const isBuildCache = name => typeof name === "string" && name.startsWith("mind-shell-");
const assets = new Set([...PRECACHE, ...Object.values(WORKSPACES).flat()]);
const isClerkAsset = url => url.protocol === "https:" && url.pathname.startsWith("/npm/@clerk/clerk-js@") && url.pathname.endsWith(".js");

function withCacheLock(task) {
  return self.navigator.locks ? self.navigator.locks.request("mind-pwa-cache-maintenance", task) : task();
}

async function activationState() {
  const cache = await caches.open(META_CACHE);
  const response = await cache.match(ACTIVATION_KEY);
  const state = await response?.json().catch(() => null);
  return isBuildCache(state?.current) && (state.previous === null || isBuildCache(state.previous)) ? state : null;
}

function clientBuild(client) {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const finish = cache => {
      clearTimeout(timeout);
      channel.port1.close();
      resolve(isBuildCache(cache) ? cache : null);
    };
    const timeout = setTimeout(() => finish(null), 1500);
    channel.port1.onmessage = event => finish(event.data?.cache);
    try {
      client.postMessage({ type: "MIND_BUILD_QUERY" }, [channel.port2]);
    } catch {
      channel.port2.close();
      finish(null);
    }
  });
}

async function cleanupCaches() {
  // Installation and cleanup must not race, including when a deployment rolls back.
  if (!self.navigator.locks || self.registration.installing || self.registration.waiting) return;
  const state = await activationState();
  // Older releases did not record activation order. Keep them until we have a known predecessor.
  if (state?.current !== CACHE || !state.previous) return;
  const names = await caches.keys();
  const keep = new Set([CACHE, state.previous]);
  if (!names.some(name => isBuildCache(name) && !keep.has(name))) return;
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const builds = await Promise.all(clients.map(clientBuild));
  // A sleeping, old, or unknown client is not evidence that its files are unused.
  if (builds.some(build => !build || !names.includes(build))) return;
  for (const build of builds) keep.add(build);
  const knownClients = new Map(clients.map(client => [client.id, client.url]));
  const currentClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  if (currentClients.some(client => knownClients.get(client.id) !== client.url)) return;
  for (const name of names) {
    if (isBuildCache(name) && !keep.has(name)) await caches.delete(name);
  }
}

async function cacheRequired(cache, urls) {
  await completeAll(urls.map(async url => {
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

async function completeAll(work) {
  const results = await Promise.allSettled(work);
  const failed = results.find(result => result.status === "rejected");
  if (failed) throw failed.reason;
}

async function prepareWorkspace(cache, workspace) {
  if (!Object.hasOwn(WORKSPACES, workspace)) throw new Error("Unknown workspace");
  await cacheRequired(cache, WORKSPACES[workspace]);
  await cache.put(WORKSPACE_MARKER + workspace, new Response("ready"));
}

self.addEventListener("install", event => event.waitUntil(withCacheLock(async () => {
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
  await completeAll([...layouts].map(layout => prepareWorkspace(cache, layout)));
})));

self.addEventListener("activate", event => event.waitUntil(withCacheLock(async () => {
  await self.clients.claim();
  const state = await activationState();
  if (state?.current !== CACHE) {
    const metadata = await caches.open(META_CACHE);
    await metadata.put(ACTIVATION_KEY, Response.json({ current: CACHE, previous: state?.current ?? null }));
  }
  await cleanupCaches().catch(console.error);
})));

self.addEventListener("message", event => {
  const data = event.data;
  if (data?.type === "CLEANUP_CACHES") {
    event.waitUntil(withCacheLock(cleanupCaches));
    return;
  }
  if (!data || !["CACHE_URLS", "PREPARE_UPDATE", "SKIP_WAITING"].includes(data.type)) return;
  event.waitUntil(withCacheLock(async () => {
    const cache = await caches.open(CACHE);
    if (data.workspace) await prepareWorkspace(cache, data.workspace);
    const urls = (Array.isArray(data.urls) ? data.urls : []).filter(value => {
      if (typeof value !== "string") return false;
      const url = new URL(value, self.location.origin);
      return url.origin === self.location.origin && assets.has(url.pathname) && url.pathname !== SHELL || isClerkAsset(url);
    });
    // Clerk is loaded outside the local module graph. Copy its already cached
    // script into the new build so accepting an update also works offline.
    await completeAll(urls.map(async url => {
      if (await cache.match(url)) return;
      const previous = await caches.match(url);
      if (previous) await cache.put(url, previous);
      else await cacheRequired(cache, [url]);
    }));
    if (data.type === "SKIP_WAITING") await self.skipWaiting();
    event.ports[0]?.postMessage({ ok: true });
    if (data.type === "CACHE_URLS") await cleanupCaches();
  }).catch(error => {
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
