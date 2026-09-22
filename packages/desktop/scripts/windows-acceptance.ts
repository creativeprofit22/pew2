/** Local native acceptance using only isolated profiles and the offline echo agent. */
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { generatePairing } from "../../daemon/src/pairing.js";
import { AppClient } from "../../daemon/src/testing/app-client.js";
import { nativePage, type NativePage } from "./native-cdp.js";
import { sha256 } from "./build-daemon.js";

if (process.platform !== "win32") throw new Error("Native Windows acceptance only.");
const desktop = fileURLToPath(new URL("../", import.meta.url));
const report = await Bun.file(join(desktop, "artifacts", "installer-build.json")).json() as { installer: string };
const builtBinary = resolve(dirname(report.installer), "../..", "pew2-desktop.exe");
const binary = process.env.PEW2_DESKTOP_ACCEPTANCE_BINARY ? resolve(process.env.PEW2_DESKTOP_ACCEPTANCE_BINARY) : builtBinary;
if (!await Bun.file(binary).exists()) throw new Error("Build the installer first.");
if (await sha256(binary) !== await sha256(builtBinary)) {
  // Tauri 2.11.5 patches UNK -> NSS only inside the installer payload, then
  // restores the build output. tauri-utils 2.9.3/src/platform.rs defines these
  // exact markers. Require every other byte to match; do not waive integrity.
  const [installed, built] = await Promise.all([readFile(binary), readFile(builtBinary)]);
  const marker = "__TAURI_BUNDLE_TYPE_VAR_UNK";
  const offset = built.indexOf(marker);
  if (offset < 0 || built.indexOf(marker, offset + 1) !== -1) throw new Error("Unexpected Tauri bundle marker layout.");
  const expected = Buffer.from(built);
  expected.write("__TAURI_BUNDLE_TYPE_VAR_NSS", offset, "ascii");
  if (!installed.equals(expected)) throw new Error("Installed executable differs beyond Tauri's verified NSIS marker.");
}
if (await sha256(join(dirname(binary), "pew2-daemon.exe")) !== await sha256(join(dirname(builtBinary), "pew2-daemon.exe"))) throw new Error("Installed sidecar does not match this build.");
const home = await mkdtemp(join(desktop, "artifacts", "native acceptance "));
const pairing = { ...generatePairing(), createdAt: new Date(0).toISOString() };
await writeFile(join(home, "pairing.json"), JSON.stringify(pairing));
await mkdir(join(home, "providers"));
await writeFile(join(home, "providers", "echo.json"), JSON.stringify({
  id: "echo", name: "Offline echo acceptance", version: "0.1.0", description: "Isolated offline acceptance fixture",
  distribution: { type: "command", command: process.execPath, args: [fileURLToPath(new URL("../../daemon/src/testing/echo-agent.ts", import.meta.url))] },
  pew: { transport: "acp", requiresWorkspace: false },
}));
const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null, { status: 404 }) });
const debugPort = reservation.port!;
await reservation.stop(true);
const env = { ...process.env, HOME: home, PEW2_HOME: home, PEW2_WORKSPACE: home, PEW2_PORT: "0", PEW2_EXPERIMENTAL: "1", PEW2_TOKEN: undefined, PEW2_RELAY: undefined,
  WEBVIEW2_USER_DATA_FOLDER: join(home, "webview-test-data"),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${debugPort}`,
};
interface UiState { stopped: boolean; ready: boolean; connected: boolean; confirmation: boolean; canStart: boolean; port: number; foreground: boolean; minimized: boolean }
function ui(pid: number, action = "inspect"): UiState {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-File", join(desktop, "scripts", "native-ui.ps1"), "-ProcessId", String(pid), "-Action", action], { encoding: "utf8", shell: false, windowsHide: true, timeout: 15_000, maxBuffer: 64 * 1024 });
  if (result.status !== 0 || result.error) throw new Error(`UI Automation ${action} did not complete.`);
  return JSON.parse(result.stdout.trim()) as UiState;
}
async function waitUi(pid: number, accepts: (state: UiState) => boolean): Promise<UiState> {
  const until = Date.now() + 20_000;
  let last: UiState | undefined;
  while (Date.now() < until) {
    if (child?.pid === pid && child.exitCode !== null) throw new Error(`Native launcher exited before UI acceptance: ${child.exitCode}`);
    try { last = ui(pid); if (accepts(last)) return last; } catch { /* bounded UI initialization/repaint wait */ }
    await delay(100);
  }
  throw new Error(`Native UI did not reach the expected state. Fixed-label snapshot: ${JSON.stringify(last)}`);
}
interface ProcessRow { id: number; parent: number; name: string; memory: number; cpu: number }
function processes(): ProcessRow[] {
  const script = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; @(Get-CimInstance Win32_Process | ForEach-Object { @{id=[int]$_.ProcessId;parent=[int]$_.ParentProcessId;name=$_.Name;memory=[long]$_.WorkingSetSize;cpu=([long]$_.KernelModeTime+[long]$_.UserModeTime)} }) | ConvertTo-Json -Compress';
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8", windowsHide: true, timeout: 15_000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error("Native process measurement failed.");
  return JSON.parse(result.stdout) as ProcessRow[];
}
function descendants(rows: ProcessRow[], root: number): ProcessRow[] {
  const ids = new Set([root]);
  for (let i = 0; i < rows.length; i++) for (const row of rows) if (ids.has(row.parent)) ids.add(row.id);
  return rows.filter(row => ids.has(row.id));
}
async function keyboardPage(pid: number): Promise<NativePage> {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", `@(Get-NetTCPConnection -LocalPort ${debugPort} -State Listen -ErrorAction Stop | ForEach-Object { @{address=$_.LocalAddress;owner=[int]$_.OwningProcess} }) | ConvertTo-Json -Compress`], { encoding: "utf8", windowsHide: true, timeout: 15_000 });
  if (result.status !== 0) throw new Error("Test debugger listener was not found.");
  const parsed: unknown = JSON.parse(result.stdout);
  const listeners = (Array.isArray(parsed) ? parsed : [parsed]) as { address: string; owner: number }[];
  const owned = new Set(descendants(processes(), pid).map(row => row.id));
  check(listeners.length > 0 && listeners.every(row => ["127.0.0.1", "::1"].includes(row.address) && owned.has(row.owner)), "Refusing a debugger that is not loopback-only and owned by the test launcher.");
  return nativePage(debugPort);
}
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const measurements: Record<string, unknown> = {};
const listener = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("independent") });
let app: AppClient | undefined;
let keyboard: NativePage | undefined;
let child: ReturnType<typeof Bun.spawn> | undefined;
try {
  const openedAt = performance.now();
  child = Bun.spawn([binary], { env, cwd: home, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  await waitUi(child.pid, state => state.stopped && state.canStart);
  measurements.stoppedWindowObservedMs = Math.round(performance.now() - openedAt);
  check(!descendants(processes(), child.pid).some(row => row.name === "pew2-daemon.exe"), "Opening the launcher started a daemon.");
  ui(child.pid, "minimize");
  const second = Bun.spawn([binary], { env, cwd: home, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  const secondDeadline = setTimeout(() => { second.kill(); }, 5000);
  try { check(await second.exited === 0, "Second launcher did not exit through single-instance handling."); }
  finally { clearTimeout(secondDeadline); }
  await waitUi(child.pid, state => state.foreground && !state.minimized && state.stopped);
  measurements.singleInstanceSecondExit = 0;
  measurements.singleInstanceRestoresAndFocuses = true;
  keyboard = await keyboardPage(child.pid);
  const cycleCounts: number[] = [];
  for (let cycle = 0; cycle < 3; cycle++) {
    const startedAt = performance.now();
    if (cycle === 0) await keyboard.enterOnButton("Start phone access"); else ui(child.pid, "start");
    await waitUi(child.pid, state => state.ready);
    if (cycle === 0) measurements.readyObservedMs = Math.round(performance.now() - startedAt);
    if (cycle === 0) await keyboard.enterOnButton("Stop phone access"); else ui(child.pid, "stop");
    await waitUi(child.pid, state => state.stopped);
    const tree = descendants(processes(), child.pid);
    check(!tree.some(row => row.name === "pew2-daemon.exe"), "Stopped daemon still exists.");
    cycleCounts.push(tree.length);
  }
  measurements.stoppedTreeProcessCounts = cycleCounts;
  ui(child.pid, "start");
  await waitUi(child.pid, state => state.ready);
  ui(child.pid, "details");
  const active = await waitUi(child.pid, state => state.ready && state.port > 0);
  const beforeIdle = descendants(processes(), child.pid);
  const idleStarted = performance.now();
  // A finite sample window, not a readiness assumption.
  await delay(3000);
  const afterIdle = descendants(processes(), child.pid);
  measurements.readyTreeWorkingSetBytes = afterIdle.reduce((sum, row) => sum + row.memory, 0);
  measurements.readyTreeCpuSeconds = (afterIdle.reduce((sum, row) => sum + row.cpu, 0) - beforeIdle.reduce((sum, row) => sum + row.cpu, 0)) / 10_000_000;
  measurements.idleSampleWallSeconds = (performance.now() - idleStarted) / 1000;
  app = await AppClient.connect({ port: active.port, token: pairing.token, key: pairing.key, output: () => "Native private output withheld", died: () => undefined, stop: async () => {} }, { deviceId: "native-offline-test" });
  await waitUi(child.pid, state => state.connected);
  const inventory = await app.waitFor(frame => frame.t === "providers", "native provider inventory");
  check(inventory.providers.some((provider: { id: string; name: string }) => provider.id === "echo" && provider.name === "Offline echo acceptance"), "Native fixture manifest did not override the bundled echo provider.");
  app.send({ t: "session.start", requestId: "native-echo", providerId: "echo" });
  const started = await app.waitFor(frame => frame.t === "session.started" || frame.t === "error", "native offline session");
  if (started.t === "error") {
    const message = String(started.message ?? "unknown offline error").replaceAll(pairing.token, "[redacted]").replaceAll(pairing.key, "[redacted]");
    throw new Error(`Offline fixture session refused: ${message.slice(0, 1000)}`);
  }
  app.send({ t: "session.prompt", sessionId: started.sessionId as string, text: "permission" });
  await app.waitFor(frame => frame.t === "session.event" && frame.payload?.kind === "permission_request", "native offline approval");
  ui(child.pid, "close");
  await waitUi(child.pid, state => state.confirmation);
  await keyboard.enterOnButton("Keep running");
  await waitUi(child.pid, state => state.connected && !state.confirmation);
  check(child.exitCode === null, "Cancel close terminated the launcher.");
  const owned = descendants(processes(), child.pid).filter(row => row.name === "pew2-daemon.exe" || row.name.toLowerCase() === "bun.exe");
  check(owned.some(row => row.name === "pew2-daemon.exe") && owned.some(row => row.name.toLowerCase() === "bun.exe"), "Offline agent descendant was not observed.");
  keyboard.close();
  keyboard = undefined;
  // Deliberate crash of our isolated launcher, never a PID obtained from the UI.
  const crashed = spawnSync("powershell.exe", ["-NoProfile", "-Command", `Stop-Process -Id ${child.pid} -ErrorAction Stop`], { windowsHide: true, timeout: 10_000 });
  check(crashed.status === 0, "Could not terminate the isolated launcher for the crash test.");
  await child.exited;
  const remaining = new Set(processes().map(row => row.id));
  check(owned.every(row => !remaining.has(row.id)), "Job close left an owned daemon/agent alive.");
  check(await (await fetch(`http://127.0.0.1:${listener.port}/`)).text() === "independent", "Independent listener was affected.");
  measurements.crashOwnedProcessesReaped = owned.length;
  measurements.busyCloseCancelled = true;
  app.close();
  child = Bun.spawn([binary], { env, cwd: home, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  await waitUi(child.pid, state => state.stopped);
  keyboard = await keyboardPage(child.pid);
  ui(child.pid, "start");
  await waitUi(child.pid, state => state.ready);
  ui(child.pid, "details");
  const restarted = await waitUi(child.pid, state => state.ready && state.port > 0);
  app = await AppClient.connect({ port: restarted.port, token: pairing.token, key: pairing.key, output: () => "Native private output withheld", died: () => undefined, stop: async () => {} }, { deviceId: "native-offline-test" });
  app.send({ t: "session.start", requestId: "native-echo-restarted", providerId: "echo" });
  const resumed = await app.waitFor(frame => frame.t === "session.started", "restarted offline session");
  app.send({ t: "session.prompt", sessionId: resumed.sessionId as string, text: "permission" });
  await app.waitFor(frame => frame.t === "session.event" && frame.payload?.kind === "permission_request", "restarted offline approval");
  ui(child.pid, "close");
  await waitUi(child.pid, state => state.confirmation);
  await keyboard.enterOnButton("Stop work and close");
  keyboard.close();
  keyboard = undefined;
  const closing = child;
  const closeDeadline = setTimeout(() => { closing.kill(); }, 10_000);
  try { check(await child.exited === 0, "Confirmed busy close did not exit gracefully."); }
  finally { clearTimeout(closeDeadline); }
  measurements.busyCloseConfirmed = true;
  measurements.webViewKeyboardActivatedStartStopCancelConfirm = true;
  measurements.testOnlyLoopbackDebugger = true;
  measurements.physicalKeyboardTabFlowUnverified = true;
  const saved = JSON.parse(await readFile(join(home, "pairing.json"), "utf8")) as { token: string; key: string };
  check(saved.token === pairing.token && saved.key === pairing.key, "Pairing identity changed.");
  measurements.isolatedPairingPreserved = true;
  measurements.noModelCalls = true;
  await Bun.write(join(desktop, "artifacts", "native-acceptance.json"), `${JSON.stringify(measurements, null, 2)}\n`);
  console.log(JSON.stringify(measurements, null, 2));
} finally {
  // Never capture a live launcher on failure. An incomplete accessibility tree
  // or a concurrent reveal cannot establish that its pixels are credential-free.
  keyboard?.close();
  app?.close();
  if (child && child.exitCode === null) { child.kill(); await child.exited; }
  await listener.stop(true);
  // Keep this isolated test home for diagnostic reproducibility; it is ignored.
}
