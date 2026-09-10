import { afterAll, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import vm from "node:vm"
import { writeServiceWorker } from "../../pwa/build"

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

function harness() {
  const cachesByName = new Map<string, Map<string, Response>>()
  const key = (value: string | Request) => new URL(typeof value === "string" ? value : value.url, origin).href
  const caches = {
    keys: async () => [...cachesByName.keys()],
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
  async function fetchResource(input: string | Request) {
    const path = new URL(typeof input === "string" ? input : input.url, origin).pathname
    requests.push(path)
    if (!online || path === blocked) throw new Error("Offline")
    if (!files.has(path)) return new Response("Missing", { status: 404 })
    return new Response(files.get(path), { headers: { "Content-Type": path.endsWith(".js") ? "application/javascript" : "text/html" } })
  }
  function worker(source: string) {
    const handlers = new Map<string, (event: any) => void>()
    let activated = false
    const context = vm.createContext({
      URL, Response, Request, crypto, caches, fetch: fetchResource,
      self: { location: { origin }, clients: { claim: async () => {} }, skipWaiting: async () => { activated = true }, addEventListener: (name: string, fn: (event: any) => void) => handlers.set(name, fn) },
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
      install: () => dispatch("install"),
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

test.each(["mobile", "desktop"])("an interrupted update leaves the %s workspace usable offline", async (layout) => {
  const browser = harness()
  const a = browser.worker(releaseA.source)
  const b = browser.worker(releaseB.source)
  await browser.deploy(releaseA.directory, a.config)
  await a.install()
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
  await a.message("CACHE_URLS", layout)
  await browser.deploy(releaseB.directory, b.config)
  await b.install()
  browser.offline()
  expect((await b.message("PREPARE_UPDATE", layout))?.ok).toBe(true)
  expect((await b.message("SKIP_WAITING", layout))?.ok).toBe(true)
  expect(b.activated()).toBe(true)
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
