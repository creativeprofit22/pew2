import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "./build-daemon.js";
import { packagingTarget } from "./package-paths.js";

const desktop = fileURLToPath(new URL("../", import.meta.url));
if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Windows x64 is the only supported packaging host.");
const cache = join(desktop, "artifacts", "cache");
const { env, nsisDirectory } = packagingTarget(desktop, process.env);
env.CARGO_HOME ??= join(cache, "cargo");
env.BUN_INSTALL_CACHE_DIR ??= join(cache, "bun");
env.TEMP = join(cache, "tmp");
env.TMP = env.TEMP;
await mkdir(env.TEMP, { recursive: true });
// Uses the workspace-pinned CLI. Its beforeBuildCommand compiles and verifies
// this checkout's sidecar; no global daemon or general shell command is used.
const build = Bun.spawn([process.execPath, "run", "tauri", "build", "--bundles", "nsis", "--target", "x86_64-pc-windows-msvc", "--no-sign", "--ci", "--", "--locked"], { cwd: desktop, env, stdout: "inherit", stderr: "inherit" });
if (await build.exited !== 0) throw new Error("Desktop packaging failed; no release claimed.");
const config = await Bun.file(join(desktop, "src-tauri", "tauri.conf.json")).json() as { productName: string; version: string };
const installer = join(nsisDirectory, `${config.productName}_${config.version}_x64-setup.exe`);
if (!await Bun.file(installer).exists()) throw new Error("Expected matching NSIS artifact is missing.");
const digest = await sha256(installer);
const report = { version: config.version, builtAt: new Date().toISOString(), installer, sha256: digest, signed: false, installed: false, windows11Accepted: false };
await Bun.write(join(desktop, "artifacts", "installer-build.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Unsigned per-user installer built: ${installer}\nSHA-256 ${digest}\nNot installed, Windows 11 acceptance unverified, not published.`);
