import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLED_MANIFESTS } from "../../daemon/src/providers/bundled.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const desktop = join(root, "packages", "desktop");
const binaryDirectory = join(desktop, "src-tauri", "binaries");
const artifacts = join(desktop, "artifacts");
export const sidecarPath = join(binaryDirectory, "pew2-daemon-x86_64-pc-windows-msvc.exe");

export async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function output(executable: string, args: string[], env: NodeJS.ProcessEnv, cwd: string): string {
  const result = spawnSync(executable, args, { env, cwd, shell: false, encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error("Compiled daemon metadata check failed; raw output withheld.");
  return result.stdout.trim();
}

export async function buildDaemon(): Promise<void> {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Desktop packaging is supported only on Windows x64.");
  const daemonPackage = await Bun.file(join(root, "packages", "daemon", "package.json")).json() as { version: string };
  const desktopPackage = await Bun.file(join(desktop, "package.json")).json() as { version: string };
  const config = await Bun.file(join(desktop, "src-tauri", "tauri.conf.json")).json() as { version: string };
  const cargo = Bun.TOML.parse(await Bun.file(join(desktop, "src-tauri", "Cargo.toml")).text()) as { package: { version: string } };
  const version = daemonPackage.version;
  if (!/^\d+\.\d+\.\d+$/.test(version) || desktopPackage.version !== version || config.version !== version || cargo.package.version !== version) {
    throw new Error("Daemon, desktop package, Cargo and Tauri versions must match before packaging.");
  }
  await mkdir(binaryDirectory, { recursive: true });
  await mkdir(artifacts, { recursive: true });
  const checkHome = await mkdtemp(join(artifacts, "build-check-"));
  const staging = join(binaryDirectory, `pew2-daemon-stage-${process.pid}.exe`);
  try {
    const build = Bun.spawn([process.execPath, "build", "--compile", "--minify", join(root, "packages", "daemon", "src", "cli", "index.ts"), "--outfile", staging], { cwd: root, stdout: "inherit", stderr: "inherit" });
    if (await build.exited !== 0) throw new Error("Daemon compilation failed.");
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("PEW2_")));
    env.PEW2_HOME = checkHome;
    env.PEW2_EXPERIMENTAL = "1";
    if (output(staging, ["--version"], env, checkHome) !== version) throw new Error("Compiled daemon version does not match the checkout.");
    const raw: unknown = JSON.parse(output(staging, ["providers", "list", "--json"], env, checkHome));
    if (!Array.isArray(raw) || !raw.every((row: unknown) => row && typeof row === "object" && "id" in row && typeof row.id === "string")) throw new Error("Invalid bundled provider inventory.");
    const actual = (raw as { id: string }[]).map(row => row.id).sort();
    const expected = BUNDLED_MANIFESTS.map(manifest => manifest.id).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Compiled daemon is missing or adding bundled providers.");
    const digest = await sha256(staging);
    await rename(staging, sidecarPath);
    await Bun.write(join(artifacts, "daemon-build.json"), `${JSON.stringify({ version, builtAt: new Date().toISOString(), bun: Bun.version, providers: actual, sha256: digest }, null, 2)}\n`);
    console.log(`Bundled daemon ${version}: ${actual.length} provider manifests verified; SHA-256 ${digest}`);
  } finally {
    // Only this invocation's disposable build paths; never a user-selected home.
    await rm(staging, { force: true });
    await rm(checkHome, { recursive: true, force: true });
  }
}

if (import.meta.main) await buildDaemon();
