import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { homedir, userInfo } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function runtimeVersions(manifest) {
  const versions = manifest.dependencies;
  for (const name of ["bun", "pm2"]) {
    if (!/^\d+\.\d+\.\d+$/.test(versions?.[name] ?? "")) {
      throw new Error(`${name} must have an exact stable version in runtime/package.json`);
    }
  }
  return { bun: versions.bun, pm2: versions.pm2 };
}

function replaceSymlink(filename, target) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}`;
  fs.symlinkSync(target, temporary);
  try {
    fs.renameSync(temporary, filename);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export async function waitForBackend() {
  const deadline = Date.now() + 30_000;
  do {
    try {
      const response = await fetch("http://127.0.0.1:3000/api/sync/pull", {
        signal: AbortSignal.timeout(2_000),
      });
      await response.body?.cancel();
      if (response.status === 401) return;
    } catch {
      // Allow the process to bind its port after PM2 resurrects it.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  throw new Error("Backend did not return its expected unauthenticated 401 within 30 seconds");
}

// The injected runner and paths let recovery be tested without sudo or a live VPS.
export async function deployRuntime({
  repo = process.cwd(),
  home = homedir(),
  username = userInfo().username,
  systemdDirectory = "/etc/systemd/system",
  run = (command, args, options = {}) => execFileSync(command, args, { stdio: "inherit", ...options }),
  healthy = waitForBackend,
} = {}) {
  if (!/^[a-z_][a-z0-9_-]*$/.test(username) || !/^[\w/.-]+$/.test(home)) {
    throw new Error("Unsupported service user or home path");
  }
  const manifestBytes = fs.readFileSync(path.join(repo, "runtime/package.json"));
  const lockBytes = fs.readFileSync(path.join(repo, "runtime/bun.lock"));
  const versions = runtimeVersions(JSON.parse(manifestBytes));
  const digest = createHash("sha256").update(manifestBytes).update(lockBytes).digest("hex");
  const base = path.join(home, ".local/share/mind-runtime");
  const release = path.join(base, "releases", digest);
  const current = path.join(base, "current");
  const previous = path.join(base, "previous");
  const userBun = path.join(home, ".bun/bin/bun");
  const service = `pm2-${username}.service`;
  const override = path.join(systemdDirectory, `${service}.d/20-mind-runtime.conf`);
  const sudo = (...args) => run("sudo", ["-n", ...args]);

  // Fail before touching the running process if the host differs from the documented setup.
  sudo("systemctl", "is-active", "--quiet", service);
  const previousBun = fs.lstatSync(userBun).isSymbolicLink() ? fs.readlinkSync(userBun) : null;
  const previousCurrent = fs.existsSync(current) ? fs.readlinkSync(current) : null;
  const previousOverride = fs.existsSync(override) ? fs.readFileSync(override) : null;
  fs.mkdirSync(release, { recursive: true });
  if (!fs.existsSync(path.join(release, ".ready"))) {
    fs.writeFileSync(path.join(release, "package.json"), manifestBytes);
    fs.writeFileSync(path.join(release, "bun.lock"), lockBytes);
    // Bootstrap the proposed Bun via its exact npm version: an older installed
    // Bun may not understand the lockfile format produced by a newer release.
    run("npm", ["exec", "--yes", `--package=bun@${versions.bun}`, "--", "bun", "install", "--frozen-lockfile"], { cwd: release });
  }
  const bun = path.join(release, "node_modules/.bin/bun");
  const pm2 = path.join(release, "node_modules/.bin/pm2");
  const actualBun = String(run(bun, ["--version"], { stdio: "pipe" })).trim();
  const actualPm2 = JSON.parse(fs.readFileSync(path.join(release, "node_modules/pm2/package.json"))).version;
  if (actualBun !== versions.bun || actualPm2 !== versions.pm2) {
    throw new Error("Installed runtime versions do not match runtime/package.json");
  }
  fs.writeFileSync(path.join(release, ".ready"), digest);

  // Stage both the runtime and locked app dependencies before restarting anything.
  run(bun, ["install", "--frozen-lockfile"], { cwd: repo });
  run(previousCurrent ? path.join(previousCurrent, "node_modules/.bin/pm2") : "pm2", ["save", "--force"]);
  const dump = JSON.parse(fs.readFileSync(path.join(home, ".pm2/dump.pm2")));
  if (dump.length !== 1 || dump[0].name !== "mind-backend" || dump[0].pm_exec_path !== userBun) {
    throw new Error("Expected only mind-backend running through ~/.bun/bin/bun; no service was restarted");
  }
  const bootstrapBackup = path.join(base, "bootstrap-bun");
  if (previousBun === null) {
    fs.copyFileSync(userBun, bootstrapBackup);
    fs.chmodSync(bootstrapBackup, 0o755);
  }
  const overrideFile = path.join(release, "pm2-runtime.conf");
  const persistentPm2 = path.join(current, "node_modules/pm2/bin/pm2");
  fs.writeFileSync(overrideFile, `[Service]
ExecStart=
ExecStart=${persistentPm2} resurrect
ExecReload=
ExecReload=${persistentPm2} reload all
ExecStop=
ExecStop=${persistentPm2} kill
Environment="PATH=${home}/.bun/bin:/usr/local/bin:/usr/bin:/bin"
`);

  let overrideAttempted = false;
  let restartAttempted = false;
  try {
    replaceSymlink(current, release);
    replaceSymlink(userBun, path.join(current, "node_modules/.bin/bun"));
    overrideAttempted = true;
    sudo("install", "-D", "-o", "root", "-g", "root", "-m", "0644", overrideFile, override);
    sudo("systemctl", "daemon-reload");
    restartAttempted = true;
    sudo("systemctl", "restart", service);
    await healthy();
    run(pm2, ["save", "--force"]);
  } catch (error) {
    try {
      if (previousCurrent) replaceSymlink(current, previousCurrent);
      else fs.rmSync(current, { force: true });
      if (previousBun !== null) replaceSymlink(userBun, previousBun);
      else {
        const restored = `${userBun}.${randomUUID()}`;
        fs.copyFileSync(bootstrapBackup, restored);
        fs.chmodSync(restored, 0o755);
        fs.renameSync(restored, userBun);
      }
      if (overrideAttempted) {
        if (previousOverride !== null) {
          const restored = path.join(release, "previous-pm2-runtime.conf");
          fs.writeFileSync(restored, previousOverride);
          sudo("install", "-D", "-o", "root", "-g", "root", "-m", "0644", restored, override);
        } else sudo("rm", "-f", override);
        sudo("systemctl", "daemon-reload");
      }
      if (restartAttempted) {
        sudo("systemctl", "restart", service);
        await healthy();
      }
    } catch (recoveryError) {
      throw new AggregateError([error, recoveryError], "Runtime deployment and recovery both failed");
    }
    throw new Error("Runtime deployment failed; previous runtime restored", { cause: error });
  }

  // Retain the previous runtime for recovery without accumulating a year's downloads.
  if (previousCurrent && previousCurrent !== release) replaceSymlink(previous, previousCurrent);
  const retainedPrevious = fs.existsSync(previous) ? fs.readlinkSync(previous) : null;
  for (const entry of fs.readdirSync(path.join(base, "releases"))) {
    if (!/^[a-f0-9]{64}$/.test(entry)) continue;
    const candidate = path.join(base, "releases", entry);
    if (candidate !== release && candidate !== retainedPrevious) fs.rmSync(candidate, { recursive: true, force: true });
  }
  console.log(`Deployed Bun ${versions.bun} and PM2 ${versions.pm2}; backend health check passed.`);
  return { release, versions };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  deployRuntime().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
