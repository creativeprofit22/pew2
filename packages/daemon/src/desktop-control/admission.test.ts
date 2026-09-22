import { expect, spyOn, test } from "bun:test";
import * as childProcess from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ProviderManifest } from "@pew2/protocol";
import { Daemon } from "../index.js";
import { handleMessage } from "../handler.js";
import { createControlHandler, coarseBusy } from "./runtime.js";
import { CONTROL_VERSION } from "./protocol.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "pew2-admission-"));
  const daemon = new Daemon({ id: "admission-test", name: "test" }, true, { ...process.env, PEW2_HOME: home });
  const args = [fileURLToPath(new URL("../testing/echo-agent.ts", import.meta.url))];
  Object.assign(daemon, { providers: [{
    manifest: ProviderManifest.parse({ id: "echo", name: "Echo", version: "0.1.0", description: "Offline fixture", distribution: { type: "command", command: process.execPath, args }, pew: { transport: "acp", requiresWorkspace: false } }),
    source: "test", command: process.execPath, args, missingEnv: [], commandMissing: false,
  }] });
  return { daemon, home };
}

for (const operation of ["start", "probe"] as const) {
  test(`shutdown terminates an owned ${operation} child still connecting`, async () => {
    const { daemon, home } = await fixture();
    const created = deferred<childProcess.ChildProcess>();
    const original = childProcess.spawn;
    const spawn = spyOn(childProcess, "spawn").mockImplementation(((...args: Parameters<typeof original>) => {
      const child = original(...args);
      created.resolve(child);
      return child;
    }) as typeof original);
    const pending = (operation === "start" ? daemon.startSession("echo", home) : daemon.probeProvider("echo", { refresh: true })).catch(() => undefined);
    try {
      const child = await created.promise;
      const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
      daemon.shutdown();
      await exited;
      await pending;
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(daemon.spareDirs("echo")).toEqual([]);
      expect(daemon.busyReason()).toBeUndefined();
    } finally { daemon.shutdown(); spawn.mockRestore(); }
  });
}

test("shutdown during discovery's disk lookup cannot boot a warm agent", async () => {
  const { daemon } = await fixture();
  const spawn = spyOn(childProcess, "spawn");
  try {
    const pending = daemon.probeProvider("echo");
    daemon.shutdown();
    await pending;
    await daemon.probeProvider("echo", { refresh: true });
    expect(spawn).not.toHaveBeenCalled();
    expect(daemon.spareDirs("echo")).toEqual([]);
  } finally { daemon.shutdown(); spawn.mockRestore(); }
});

for (const operation of ["start", "resume"] as const) {
  test(`shutdown cancels ${operation} waiting for a warm agent`, async () => {
    const { daemon, home } = await fixture();
    const entered = deferred<void>();
    const waiting = deferred<void>();
    Object.assign(daemon, { awaitSpare: () => { entered.resolve(); return waiting.promise; } });
    const spawn = spyOn(childProcess, "spawn");
    const pending = operation === "start" ? daemon.startSession("echo", home) : daemon.resumeSession("echo", "old", home);
    const outcome = pending.catch(error => error);
    try {
      await entered.promise;
      daemon.shutdown();
      waiting.resolve();
      expect(await outcome).toBeInstanceOf(Error);
      expect((await outcome).message).toContain("shutting down");
      expect(spawn).not.toHaveBeenCalled();
      expect(daemon.busyReason()).toBeUndefined();
    } finally { waiting.resolve(); daemon.shutdown(); spawn.mockRestore(); }
  });
  test(`Stop revokes ${operation} held in workspace/history lookup`, async () => {
    const { daemon, home } = await fixture();
    const entered = deferred<void>();
    const lookup = deferred<string>();
    const resolveLookup = () => { entered.resolve(); return lookup.promise; };
    if (operation === "start") daemon.knownProject = resolveLookup;
    else daemon.agentSessionCwd = resolveLookup;
    const frames: any[] = [];
    const control = createControlHandler({
      status: () => ({ lifecycle: "ready", bindAddress: "0.0.0.0", port: 1, authenticatedConnections: 1, busy: coarseBusy(daemon.busyReason()) }),
      shutdown: () => daemon.shutdown(),
      revealPairing: async () => { throw new Error("unused"); },
    });
    const spawn = spyOn(childProcess, "spawn");
    const pending = handleMessage(JSON.stringify({ t: `session.${operation}`, providerId: "echo", cwd: home, ...(operation === "resume" ? { agentSessionId: "old-echo" } : {}) }), {
      daemon, deviceId: "authenticated-test", cwd: home, reply: frame => frames.push(frame), broadcast: frame => frames.push(frame),
    });
    try {
      await entered.promise;
      expect((await control({ v: CONTROL_VERSION, id: "stop", instance: "test", command: "stop-request" })).type).toBe("status");
      lookup.resolve(home);
      await pending;
      expect(frames.some(frame => frame.t === "session.started")).toBe(false);
      expect(frames.some(frame => frame.t === "error" && frame.message.includes("shutting down"))).toBe(true);
      expect(daemon.busyReason()).toBeUndefined();
      expect(daemon.spareDirs("echo")).toEqual([]);
      // No owned child can leak when the actual spawn boundary was never crossed.
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      lookup.resolve(home);
      await pending;
      daemon.shutdown();
      spawn.mockRestore();
    }
  });
}
