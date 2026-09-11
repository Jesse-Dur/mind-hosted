import { afterAll, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import vm from "node:vm"
import { writeServiceWorker } from "../../pwa/build"
import { respondToBuildQuery } from "./buildIdentity"

const root = await mkdtemp(join(tmpdir(), "mind-pwa-test-"))
afterAll(() => rm(root, { recursive: true, force: true }))
const origin = "https://mind.test"
type Config = { cache: string; shell: string; precache: string[]; workspaces: Record<string, string[]> }

async function build(label: string) {
  const directory = join(root, label)
  await mkdir(join(directory, ".vite"), { recursive: true })
  await mkdir(join(directory, "assets"))
  const manifest = {
    "index.html": { file: `assets/entry-${label}.js` },
    "src/layout/mobile/MobileWorkspace.tsx": { file: `assets/mobile-${label}.js`, imports: ["index.html"] },
    "src/layout/desktop/DesktopWorkspace.tsx": { file: `assets/desktop-${label}.js`, imports: ["index.html"] },
  }
  await writeFile(join(directory, ".vite/manifest.json"), JSON.stringify(manifest))
  await writeFile(join(directory, "index.html"), `<script src="/assets/entry-${label}.js"></script>`)
  for (const chunk of Object.values(manifest)) await writeFile(join(directory, chunk.file), `/* ${label} */`)
  await writeServiceWorker(directory)
  return { directory, source: await readFile(join(directory, "sw.js"), "utf8") }
}

function harness({ locksAvailable = true } = {}) {
  const cachesByName = new Map<string, Map<string, Response>>()
  const key = (value: string | Request) => new URL(typeof value === "string" ? value : value.url, origin).href
  const caches = {
    keys: async () => [...cachesByName.keys()],
    delete: async (name: string) => cachesByName.delete(name),
    open: async (name: string) => {
      if (!cachesByName.has(name)) cachesByName.set(name, new Map())
      const entries = cachesByName.get(name)!
      return {
        match: async (request: string | Request) => entries.get(key(request))?.clone(),
        put: async (request: string | Request, response: Response) => { entries.set(key(request), response.clone()) },
      }
    },
    match: async (request: string | Request) => {
      for (const entries of cachesByName.values()) {
        const response = entries.get(key(request))
        if (response) return response.clone()
      }
    },
  }
  let online = true
  let blocked = ""
  let files = new Map<string, string>()
  const requests: string[] = []
  const heldRequests = new Map<string, Promise<void>>()
  const clients = new Map<string, { id: string; url: string; cache: string | null; responds: boolean; onQuery?: () => void }>()
  const registration: { installing: object | null; waiting: object | null } = { installing: null, waiting: null }
  let cacheWork: Promise<unknown> = Promise.resolve()
  const locks = {
    request: (_name: string, task: () => Promise<unknown>) => {
      const next = cacheWork.then(task)
      cacheWork = next.catch(() => {})
      return next
    },
  }
  async function fetchResource(input: string | Request) {
    const path = new URL(typeof input === "string" ? input : input.url, origin).pathname
    requests.push(path)
    await heldRequests.get(path)
    if (!online || path === blocked) throw new Error("Offline")
    if (!files.has(path)) return new Response("Missing", { status: 404 })
    return new Response(files.get(path), { headers: { "Content-Type": path.endsWith(".js") ? "application/javascript" : "text/html" } })
  }
  function worker(source: string) {
    const handlers = new Map<string, (event: any) => void>()
    let activated = false
    const context = vm.createContext({
      URL, Response, Request, crypto, caches, MessageChannel, setTimeout, clearTimeout, console, fetch: fetchResource,
      self: {
        location: { origin }, registration, navigator: { locks: locksAvailable ? locks : undefined },
        clients: {
          claim: async () => {},
          matchAll: async (options: { includeUncontrolled: boolean }) => {
            expect(options.includeUncontrolled).toBe(true)
            return [...clients.values()].map(client => ({
              id: client.id, url: client.url,
              postMessage: (data: unknown, ports: MessagePort[]) => {
                client.onQuery?.()
                if (client.responds) respondToBuildQuery({ data, ports }, client.cache)
                else ports[0]?.close()
              },
            }))
          },
        },
        skipWaiting: async () => { activated = true },
        addEventListener: (name: string, fn: (event: any) => void) => handlers.set(name, fn),
      },
    })
    vm.runInContext(source, context)
    const config = vm.runInContext("CONFIG", context) as Config
    async function dispatch(name: string, fields: object = {}) {
      const work: Promise<unknown>[] = []
      let response: Promise<Response> | undefined
      handlers.get(name)!({ ...fields, waitUntil: (promise: Promise<unknown>) => work.push(promise), respondWith: (promise: Promise<Response>) => { response = promise } })
      const result = await response
      await Promise.all(work)
      return result
    }
    return {
      config,
      install: async () => {
        registration.installing = config
        try {
          await dispatch("install")
          registration.waiting = config
        } finally {
          registration.installing = null
        }
      },
      activate: async () => {
        registration.waiting = null
        await dispatch("activate")
      },
      cleanup: () => dispatch("message", { data: { type: "CLEANUP_CACHES" } }),
      navigate: () => dispatch("fetch", { request: { method: "GET", mode: "navigate", url: origin + "/" } }),
      asset: (path: string) => dispatch("fetch", { request: new Request(origin + path) }),
      message: async (type: string, workspace: string, urls: string[] = []) => {
        let result: { ok: boolean } | undefined
        await dispatch("message", { data: { type, workspace, urls }, ports: [{ postMessage: (data: { ok: boolean }) => { result = data } }] })
        return result
      },
      activated: () => activated,
    }
  }
  return {
    worker, requests,
    cacheNames: () => caches.keys(),
    cache: caches.open,
    hold: (path: string) => {
      let release!: () => void
      heldRequests.set(path, new Promise<void>(resolve => { release = resolve }))
      return () => { heldRequests.delete(path); release() }
    },
    closeClient: (id: string) => clients.delete(id),
    openClient: (id: string, cache: string | null, options: { responds?: boolean; onQuery?: () => void } = {}) => {
      clients.set(id, { id, url: origin + "/", cache, responds: options.responds ?? true, onQuery: options.onQuery })
    },
    offline: () => { online = false },
    block: (path: string) => { blocked = path },
    replace: (path: string, content: string) => files.set(path, content),
    deploy: async (directory: string, config: Config) => {
      online = true
      blocked = ""
      files = new Map()
      for (const path of [...config.precache, ...Object.values(config.workspaces).flat()]) {
        files.set(path, await readFile(join(directory, path.slice(1)), "utf8").catch(() => "static asset"))
      }
      files.set("/", await readFile(join(directory, "index.html"), "utf8"))
    },
  }
}

const releaseA = await build("A")
const releaseB = await build("B")
const releaseC = await build("C")
const releaseD = await build("D")

async function activateRelease(browser: ReturnType<typeof harness>, release: typeof releaseA, layout = "mobile") {
  const worker = browser.worker(release.source)
  await browser.deploy(release.directory, worker.config)
  await worker.install()
  await worker.activate()
  expect((await worker.message("CACHE_URLS", layout))?.ok).toBe(true)
  return worker
}

async function buildCaches(browser: ReturnType<typeof harness>) {
  return (await browser.cacheNames()).filter(name => name.startsWith("mind-shell-"))
}

test.each(["mobile", "desktop"])("repeated %s updates keep the last two activated builds, independent of hash order", async (layout) => {
  const browser = harness()
  // Deliberately activate hashes in descending order; lexical sorting would keep the wrong predecessor.
  const releases = [releaseA, releaseB, releaseC, releaseD]
    .sort((left, right) => browser.worker(right.source).config.cache.localeCompare(browser.worker(left.source).config.cache))
  let previous: ReturnType<typeof browser.worker> | undefined
  for (const release of releases) {
    const current = await activateRelease(browser, release, layout)
    expect(new Set(await buildCaches(browser))).toEqual(new Set([current.config.cache, ...previous ? [previous.config.cache] : []]))
    browser.offline()
    expect(await (await current.navigate())!.text()).toContain(current.config.cache)
    expect((await current.asset(current.config.workspaces[layout]![0]!))?.status).toBe(200)
    if (previous) expect((await current.asset(previous.config.workspaces[layout]![0]!))?.status).toBe(200)
    previous = current
  }
})

test("tabs and an installed window can pin different older builds until their last window closes", async () => {
  const browser = harness()
  const a = await activateRelease(browser, releaseA)
  browser.openClient("tab-a", a.config.cache)
  browser.openClient("installed-window-a", a.config.cache)
  const b = await activateRelease(browser, releaseB, "desktop")
  browser.openClient("tab-b", b.config.cache)
  const c = await activateRelease(browser, releaseC)
  const d = await activateRelease(browser, releaseD)
  expect(await buildCaches(browser)).toHaveLength(4)
  browser.offline()
  expect(await (await d.asset("/assets/mobile-A.js"))!.text()).toContain("A")
  expect(await (await d.asset("/assets/desktop-B.js"))!.text()).toContain("B")
  browser.closeClient("tab-a")
  await d.cleanup()
  expect(await buildCaches(browser)).toContain(a.config.cache)
  browser.closeClient("installed-window-a")
  await d.cleanup()
  expect(new Set(await buildCaches(browser))).toEqual(new Set([b.config.cache, c.config.cache, d.config.cache]))
  browser.closeClient("tab-b")
  await d.cleanup()
  expect(new Set(await buildCaches(browser))).toEqual(new Set([c.config.cache, d.config.cache]))
})

test.each(["unresponsive", "legacy", "unknown-build"])("a %s tab defers cleanup until it closes", async (mode) => {
  const browser = harness()
  const a = await activateRelease(browser, releaseA)
  browser.openClient("old-tab", a.config.cache)
  await activateRelease(browser, releaseB)
  const c = await activateRelease(browser, releaseC)
  browser.openClient("old-tab", mode === "legacy" ? null : mode === "unknown-build" ? "mind-shell-unknown" : a.config.cache, { responds: mode !== "unresponsive" })
  await c.cleanup()
  expect(await buildCaches(browser)).toHaveLength(3)
  browser.closeClient("old-tab")
  await c.cleanup()
  expect(await buildCaches(browser)).not.toContain(a.config.cache)
})

test("a tab appearing during the client census defers deletion", async () => {
  const browser = harness()
  const a = await activateRelease(browser, releaseA)
  browser.openClient("old-tab", a.config.cache)
  await activateRelease(browser, releaseB)
  const c = await activateRelease(browser, releaseC)
  browser.closeClient("old-tab")
  browser.openClient("current-tab", c.config.cache, { onQuery: () => browser.openClient("new-old-tab", a.config.cache) })
  await c.cleanup()
  expect(await buildCaches(browser)).toContain(a.config.cache)
  browser.openClient("current-tab", c.config.cache)
  await c.cleanup()
  expect(await buildCaches(browser)).toContain(a.config.cache)
  browser.closeClient("new-old-tab")
  await c.cleanup()
  expect(await buildCaches(browser)).not.toContain(a.config.cache)
})

test("waiting and failed builds do not replace the previous successful activation", async () => {
  const browser = harness()
  const a = await activateRelease(browser, releaseA)
  const b = await activateRelease(browser, releaseB)
  const c = browser.worker(releaseC.source)
  await browser.deploy(releaseC.directory, c.config)
  browser.block("/assets/mobile-C.js")
  await expect(c.install()).rejects.toThrow("Offline")
  browser.offline()
  expect(await (await b.asset("/assets/mobile-B.js"))!.text()).toContain("B")
  expect(await (await b.asset("/assets/mobile-A.js"))!.text()).toContain("A")
  const d = browser.worker(releaseD.source)
  await browser.deploy(releaseD.directory, d.config)
  await d.install()
  await b.cleanup()
  expect(await buildCaches(browser)).toContain(d.config.cache)
  expect(await buildCaches(browser)).toContain(a.config.cache)
  browser.offline()
  await d.activate()
  expect(new Set(await buildCaches(browser))).toEqual(new Set([b.config.cache, d.config.cache]))
  expect(await (await d.asset("/assets/mobile-D.js"))!.text()).toContain("D")
})

test("cleanup is serialized with a rollback download and protects its waiting cache", async () => {
  const browser = harness()
  const a = await activateRelease(browser, releaseA)
  browser.openClient("old-tab", a.config.cache)
  await activateRelease(browser, releaseB)
  const c = await activateRelease(browser, releaseC)
  browser.closeClient("old-tab")
  // Roll back to A, downloading a layout it has not previously cached.
  await c.message("CACHE_URLS", "desktop")
  const rollback = browser.worker(releaseA.source)
  await browser.deploy(releaseA.directory, rollback.config)
  const release = browser.hold("/assets/desktop-A.js")
  const installing = rollback.install()
  while (!browser.requests.includes("/assets/desktop-A.js")) await new Promise(resolve => setTimeout(resolve, 0))
  let cleanupFinished = false
  const cleanup = c.cleanup().then(() => { cleanupFinished = true })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(cleanupFinished).toBe(false)
  release()
  await installing
  await cleanup
  await c.cleanup()
  expect(await buildCaches(browser)).toContain(a.config.cache)
  browser.offline()
  await rollback.activate()
  expect(new Set(await buildCaches(browser))).toEqual(new Set([a.config.cache, c.config.cache]))
  expect(await (await rollback.asset("/assets/desktop-A.js"))!.text()).toContain("A")
})

test("activation history survives worker restarts and an old worker cannot clean a newer build", async () => {
  const browser = harness()
  const a = await activateRelease(browser, releaseA)
  const b = await activateRelease(browser, releaseB)
  const c = await activateRelease(browser, releaseC)
  await a.cleanup()
  const restarted = browser.worker(releaseC.source)
  await restarted.cleanup()
  expect(new Set(await buildCaches(browser))).toEqual(new Set([b.config.cache, c.config.cache]))
})

test("a failed installation drains outstanding cache writes before releasing the maintenance lock", async () => {
  const browser = harness()
  const a = await activateRelease(browser, releaseA)
  const b = browser.worker(releaseB.source)
  await browser.deploy(releaseB.directory, b.config)
  const release = browser.hold("/assets/entry-B.js")
  browser.block("/favicon.svg")
  let failed = false
  const installing = b.install().catch(() => { failed = true })
  while (!browser.requests.includes("/assets/entry-B.js")) await new Promise(resolve => setTimeout(resolve, 0))
  let cleaned = false
  const cleanup = a.cleanup().then(() => { cleaned = true })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(failed).toBe(false)
  expect(cleaned).toBe(false)
  release()
  await installing
  await cleanup
  expect(failed).toBe(true)
  browser.offline()
  expect(await (await a.asset("/assets/mobile-A.js"))!.text()).toContain("A")
})

test("legacy caches survive the first tracked activation and are collected once a predecessor is known", async () => {
  const browser = harness()
  await (await browser.cache("mind-shell-legacy-build")).put("/legacy.js", new Response("legacy"))
  const a = await activateRelease(browser, releaseA)
  expect(await buildCaches(browser)).toContain("mind-shell-legacy-build")
  const b = await activateRelease(browser, releaseB)
  expect(new Set(await buildCaches(browser))).toEqual(new Set([a.config.cache, b.config.cache]))
})

test("cleanup leaves unrelated caches and another browser profile untouched", async () => {
  const browser = harness()
  const otherProfile = harness()
  const otherA = await activateRelease(otherProfile, releaseA)
  const unrelated = await browser.cache("other-app-data")
  await unrelated.put("/data", new Response("keep me"))
  const a = await activateRelease(browser, releaseA)
  await activateRelease(browser, releaseB)
  await activateRelease(browser, releaseC)
  expect(await buildCaches(browser)).not.toContain(a.config.cache)
  expect(await browser.cacheNames()).toContain("other-app-data")
  expect(await (await unrelated.match("/data"))!.text()).toBe("keep me")
  expect(await buildCaches(otherProfile)).toEqual([otherA.config.cache])
  otherProfile.offline()
  expect(await (await otherA.asset("/assets/mobile-A.js"))!.text()).toContain("A")
})

test("browsers without cross-worker locks retain caches and still open offline", async () => {
  const browser = harness({ locksAvailable: false })
  await activateRelease(browser, releaseA)
  await activateRelease(browser, releaseB)
  const c = await activateRelease(browser, releaseC)
  expect(await buildCaches(browser)).toHaveLength(3)
  browser.offline()
  expect(await (await c.asset("/assets/mobile-C.js"))!.text()).toContain("C")
})

test("the HTML reports its own build and regenerating the worker is deterministic", async () => {
  const release = await build("identity")
  const first = harness().worker(release.source)
  const html = await readFile(join(release.directory, "index.html"), "utf8")
  expect(html).toContain(`<meta name="mind-build-cache" content="${first.config.cache}">`)
  expect(await readFile(join(release.directory, first.config.shell.slice(1)), "utf8")).toBe(html)
  await writeServiceWorker(release.directory)
  expect(await readFile(join(release.directory, "sw.js"), "utf8")).toBe(release.source)
})

test.each(["mobile", "desktop"])("an interrupted update leaves the %s workspace usable offline", async (layout) => {
  const browser = harness()
  const a = browser.worker(releaseA.source)
  const b = browser.worker(releaseB.source)
  await browser.deploy(releaseA.directory, a.config)
  await a.install()
  await a.activate()
  expect(browser.requests.some((path) => /mobile-|desktop-/.test(path))).toBe(false)
  expect((await a.message("CACHE_URLS", layout))?.ok).toBe(true)

  await browser.deploy(releaseB.directory, b.config)
  expect(await (await a.navigate())!.text()).toContain("entry-A.js")
  browser.block(`/assets/${layout}-B.js`)
  await expect(b.install()).rejects.toThrow()
  browser.offline()
  expect(await (await a.navigate())!.text()).toContain("entry-A.js")
  expect(await (await a.asset(`/assets/${layout}-A.js`))!.text()).toContain("A")
  expect((await b.message("SKIP_WAITING", layout))?.ok).toBe(false)
  expect(b.activated()).toBe(false)
})

test.each(["mobile", "desktop"])("a complete %s update activates and starts offline", async (layout) => {
  const browser = harness()
  const a = browser.worker(releaseA.source)
  const b = browser.worker(releaseB.source)
  await browser.deploy(releaseA.directory, a.config)
  await a.install()
  await a.activate()
  await a.message("CACHE_URLS", layout)
  await browser.deploy(releaseB.directory, b.config)
  await b.install()
  browser.offline()
  expect((await b.message("PREPARE_UPDATE", layout))?.ok).toBe(true)
  expect((await b.message("SKIP_WAITING", layout))?.ok).toBe(true)
  expect(b.activated()).toBe(true)
  await b.activate()
  expect(await (await b.navigate())!.text()).toContain("entry-B.js")
  expect(await (await b.asset(`/assets/${layout}-B.js`))!.text()).toContain("B")
  // A second tab can still request A's hashed modules after B takes control.
  expect(await (await b.asset(`/assets/${layout}-A.js`))!.text()).toContain("A")
})

test("build cache identity changes for HTML-only changes without a version bump", async () => {
  const release = await build("html-only")
  const browser = harness()
  const before = browser.worker(release.source).config.cache
  await writeFile(join(release.directory, "index.html"), "updated HTML")
  await writeServiceWorker(release.directory)
  const after = browser.worker(await readFile(join(release.directory, "sw.js"), "utf8")).config.cache
  expect(after).not.toBe(before)
})

test("installation rejects fallback HTML from a different deployment", async () => {
  const browser = harness()
  const worker = browser.worker(releaseA.source)
  await browser.deploy(releaseA.directory, worker.config)
  browser.replace(worker.config.shell, '<script src="/assets/entry-B.js"></script>')
  await expect(worker.install()).rejects.toThrow("different build")
})
