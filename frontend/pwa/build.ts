import { createHash } from "node:crypto"
import { readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

type Chunk = { file: string; imports?: string[]; css?: string[]; assets?: string[] }

export async function writeServiceWorker(directory: string) {
  const manifest = JSON.parse(await readFile(join(directory, ".vite/manifest.json"), "utf8")) as Record<string, Chunk>
  const worker = await readFile(new URL("./worker.js", import.meta.url), "utf8")
  const hash = createHash("sha256").update(worker).update(await readFile(new URL(import.meta.url)))
  async function fingerprint(path: string) {
    for (const entry of (await readdir(join(directory, path), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(path, entry.name)
      if (entry.isDirectory()) await fingerprint(file)
      else if (file !== "sw.js" && !file.startsWith("assets/shell-")) hash.update(file).update(await readFile(join(directory, file)))
    }
  }
  await fingerprint("")
  const build = hash.digest("hex").slice(0, 20)
  const shell = `/assets/shell-${build}.html`
  const html = await readFile(join(directory, "index.html"))
  const shellDigest = createHash("sha256").update(html).digest("hex")
  await writeFile(join(directory, shell.slice(1)), html)

  function dependencies(key: string, visited = new Set<string>()): string[] {
    if (visited.has(key)) return []
    visited.add(key)
    const chunk = manifest[key]
    if (!chunk) throw new Error(`Missing PWA chunk: ${key}`)
    return [chunk.file, ...chunk.css ?? [], ...chunk.assets ?? [], ...(chunk.imports ?? []).flatMap((dependency) => dependencies(dependency, visited))]
      .map((file) => file.startsWith("/") ? file : `/${file}`)
  }
  const workspaces = Object.fromEntries(["mobile", "desktop"].map((layout) => {
    const key = Object.keys(manifest).find((key) => key.includes(`/${layout}/`) && key.endsWith("Workspace.tsx"))
    if (!key) throw new Error(`Missing ${layout} PWA workspace`)
    return [layout, [...new Set(dependencies(key))]]
  }))
  const precache = [shell, "/manifest.webmanifest", "/favicon.svg", "/favicon.png", "/pwa-192.png", "/pwa-512.png", "/pwa-maskable-192.png", "/pwa-maskable-512.png", ...dependencies("index.html")]
  await writeFile(join(directory, "sw.js"), `const CONFIG = ${JSON.stringify({ cache: `mind-shell-${build}`, shell, shellDigest, precache, workspaces })};\n${worker}`)
}
