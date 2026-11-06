import { describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { deployRuntime, runtimeVersions } from "./deploy-runtime.mjs"

const repo = path.resolve(import.meta.dir, "../..")
const manifest = JSON.parse(fs.readFileSync(path.join(repo, "runtime/package.json"), "utf8"))
const versions = runtimeVersions(manifest)

describe("managed runtime deployment", () => {
  function fixture({ migrated = false, failInstall = false, failAppInstall = false, badVersion = false, failedHealth = false, failRestart = false } = {}) {
    const root = fs.mkdtempSync(path.join(tmpdir(), "mind-runtime-deployment-"))
    const home = path.join(root, "home")
    const checkout = path.join(root, "repo")
    const units = path.join(root, "units")
    const userBun = path.join(home, ".bun/bin/bun")
    const base = path.join(home, ".local/share/mind-runtime")
    const oldRelease = path.join(base, "releases", "a".repeat(64))
    const override = path.join(units, "pm2-opc.service.d/20-mind-runtime.conf")
    fs.mkdirSync(path.join(checkout, "runtime"), { recursive: true })
    fs.copyFileSync(path.join(repo, "runtime/package.json"), path.join(checkout, "runtime/package.json"))
    fs.copyFileSync(path.join(repo, "runtime/bun.lock"), path.join(checkout, "runtime/bun.lock"))
    fs.mkdirSync(path.dirname(userBun), { recursive: true })
    if (migrated) {
      fs.mkdirSync(oldRelease, { recursive: true })
      fs.symlinkSync(oldRelease, path.join(base, "current"))
      fs.symlinkSync(path.join(base, "current/node_modules/.bin/bun"), userBun)
      fs.mkdirSync(path.dirname(override), { recursive: true })
      fs.writeFileSync(override, "previous service override")
    } else fs.writeFileSync(userBun, "original bootstrap Bun")
    fs.mkdirSync(path.join(home, ".pm2"), { recursive: true })
    fs.writeFileSync(path.join(home, ".pm2/dump.pm2"), JSON.stringify([{ name: "mind-backend", pm_exec_path: userBun }]))
    const calls: Array<{ command: string; args: string[]; cwd?: string }> = []
    let restarts = 0
    let healthChecks = 0
    const options = {
      repo: checkout, home, username: "opc", systemdDirectory: units,
      run(command: string, args: string[], options: { cwd?: string } = {}) {
        calls.push({ command, args, cwd: options.cwd })
        if (args.includes("install") && options.cwd?.includes("/releases/")) {
          if (failInstall) throw new Error("package download failed")
          fs.mkdirSync(path.join(options.cwd, "node_modules/pm2"), { recursive: true })
          fs.writeFileSync(path.join(options.cwd, "node_modules/pm2/package.json"), JSON.stringify({ version: versions.pm2 }))
        }
        if (args[0] === "--version") return `${badVersion ? "0.0.0" : versions.bun}\n`
        if (failAppInstall && options.cwd === checkout && args[0] === "install") throw new Error("app dependencies failed to install")
        if (command === "sudo" && args[1] === "install") {
          fs.mkdirSync(path.dirname(args.at(-1)!), { recursive: true })
          fs.copyFileSync(args.at(-2)!, args.at(-1)!)
        }
        if (command === "sudo" && args[1] === "rm") fs.rmSync(args.at(-1)!, { force: true })
        if (command === "sudo" && args[2] === "restart") {
          restarts += 1
          if (failRestart && restarts === 1) throw new Error("new manager did not start")
        }
        return ""
      },
      async healthy() {
        healthChecks += 1
        if (failedHealth && healthChecks === 1) throw new Error("backend unhealthy")
      },
    }
    return { root, home, userBun, base, oldRelease, override, calls, options }
  }

  test("accepts exact versions and rejects ranges, tags, and command text", () => {
    expect(versions).toEqual(manifest.dependencies)
    for (const version of ["latest", "^1.4.4", "1.4.4; echo bad", "1.4.4-canary"]) {
      expect(() => runtimeVersions({ dependencies: { ...versions, bun: version } })).toThrow()
    }
  })

  test("stages and verifies packages before changing the service, with reboot persistence", async () => {
    const f = fixture()
    try {
      const result = await deployRuntime(f.options)
      expect(fs.readlinkSync(path.join(f.base, "current"))).toBe(result.release)
      expect(fs.readlinkSync(f.userBun)).toBe(path.join(f.base, "current/node_modules/.bin/bun"))
      expect(fs.readFileSync(f.override, "utf8")).toContain(`${f.base}/current/node_modules/pm2/bin/pm2 resurrect`)
      const install = f.calls.findIndex((c) => c.args.includes("install") && c.cwd?.includes("/releases/"))
      const restart = f.calls.findIndex((c) => c.command === "sudo" && c.args[2] === "restart")
      expect(install).toBeLessThan(restart)
      expect(f.calls[install]!.command).toBe("npm")
      expect(f.calls[install]!.args).toEqual(["exec", "--yes", `--package=bun@${versions.bun}`, "--", "bun", "install", "--frozen-lockfile"])
    } finally { fs.rmSync(f.root, { recursive: true, force: true }) }
  })

  for (const options of [{ failInstall: true }, { badVersion: true }, { failAppInstall: true }]) {
    test(`an invalid stage leaves the existing binary and service alone: ${JSON.stringify(options)}`, async () => {
      const f = fixture(options)
      try {
        await expect(deployRuntime(f.options)).rejects.toThrow()
        expect(fs.readFileSync(f.userBun, "utf8")).toBe("original bootstrap Bun")
        expect(fs.existsSync(path.join(f.base, "current"))).toBe(false)
        expect(f.calls.some((c) => c.command === "sudo" && c.args[2] === "restart")).toBe(false)
      } finally { fs.rmSync(f.root, { recursive: true, force: true }) }
    })
  }

  for (const migrated of [false, true]) {
    for (const failure of [{ failedHealth: true }, { failRestart: true }]) {
      test(`restores the previous runtime and boot configuration after failure: ${JSON.stringify({ migrated, ...failure })}`, async () => {
        const f = fixture({ migrated, ...failure })
        try {
          await expect(deployRuntime(f.options)).rejects.toThrow("previous runtime restored")
          if (migrated) {
            expect(fs.readlinkSync(path.join(f.base, "current"))).toBe(f.oldRelease)
            expect(fs.readFileSync(f.override, "utf8")).toBe("previous service override")
          } else {
            expect(fs.readFileSync(f.userBun, "utf8")).toBe("original bootstrap Bun")
            expect(fs.existsSync(path.join(f.base, "current"))).toBe(false)
            expect(fs.existsSync(f.override)).toBe(false)
          }
          expect(f.calls.filter((c) => c.command === "sudo" && c.args[2] === "restart")).toHaveLength(2)
        } finally { fs.rmSync(f.root, { recursive: true, force: true }) }
      })
    }
  }

  test("uses the previous managed PM2 rather than the global bootstrap for subsequent deployments", async () => {
    const f = fixture({ migrated: true })
    try {
      await deployRuntime(f.options)
      expect(f.calls.some((c) => c.command === path.join(f.oldRelease, "node_modules/.bin/pm2") && c.args[0] === "save")).toBe(true)
    } finally { fs.rmSync(f.root, { recursive: true, force: true }) }
  })

  test("retains the previous runtime on repeat application deploys and removes older cached releases", async () => {
    const f = fixture({ migrated: true })
    try {
      const obsolete = path.join(f.base, "releases", "b".repeat(64))
      fs.mkdirSync(obsolete, { recursive: true })
      await deployRuntime(f.options)
      expect(fs.existsSync(obsolete)).toBe(false)
      expect(fs.readlinkSync(path.join(f.base, "previous"))).toBe(f.oldRelease)
      const initialInstalls = f.calls.filter((c) => c.command === "npm").length
      await deployRuntime(f.options)
      expect(fs.existsSync(f.oldRelease)).toBe(true)
      expect(f.calls.filter((c) => c.command === "npm")).toHaveLength(initialInstalls)
    } finally { fs.rmSync(f.root, { recursive: true, force: true }) }
  })
})

test("the locked PM2 starts and resurrects a process using the locked Bun binary", async () => {
  // macOS's long per-user temp path can exceed Unix-domain socket limits.
  const temporary = fs.mkdtempSync(path.join(process.platform === "darwin" ? "/private/tmp" : tmpdir(), "mind-pm2-"))
  const portFile = path.join(temporary, "port")
  const bun = path.join(repo, "runtime/node_modules/.bin/bun")
  const pm2 = path.join(repo, "runtime/node_modules/.bin/pm2")
  const environment = { ...process.env, PM2_HOME: path.join(temporary, "pm2") }
  function command(args: string[]) {
    const result = Bun.spawnSync([pm2, ...args], { env: environment, stdout: "pipe", stderr: "pipe", timeout: 10_000 })
    if (result.exitCode !== 0) throw new Error(`PM2 exited ${result.exitCode}: ${result.stdout.toString()} ${result.stderr.toString()}`)
  }
  async function verify() {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      if (fs.existsSync(portFile)) {
        const port = fs.readFileSync(portFile, "utf8").trim()
        try {
          const result = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1_000) })
          expect(await result.json()).toEqual({ bun: versions.bun })
          return
        } catch (error) { if (Date.now() >= deadline - 100) throw error }
      }
      await Bun.sleep(50)
    }
    throw new Error("Managed PM2 did not start the Bun fixture")
  }
  try {
    command(["start", bun, "--name", "mind-runtime-smoke", "--interpreter", "none", "--", "run", path.join(import.meta.dir, "runtime-fixture.ts"), portFile])
    await verify()
    command(["save", "--force"])
    command(["kill"])
    fs.rmSync(portFile, { force: true })
    command(["resurrect"])
    await verify()
  } finally {
    try { command(["kill"]) } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
  }
}, 30_000)
