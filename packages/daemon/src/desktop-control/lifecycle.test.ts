import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePairing, rotatePairing, setRelay } from "../pairing.js";
import { CONTROL_VERSION, type Response as ControlResponse } from "./protocol.js";
import { AppClient } from "../testing/app-client.js";
import { CLI_DEVICE_PREFIX } from "../device-claim.js";
import { statusLabel } from "../../../desktop/src/state.js";

async function launch(options: { port?: number; missing?: boolean; echo?: boolean; tokenLength?: number; relay?: string; claimedBy?: string } = {}) {
  const home = await mkdtemp(join(tmpdir(), "desktop lifecycle "));
  const pairing = {
    ...generatePairing(), createdAt: new Date(0).toISOString(),
    ...(options.relay ? { relay: options.relay } : {}),
    ...(options.claimedBy ? { claimedBy: options.claimedBy } : {}),
  };
  if (options.tokenLength) pairing.token = "a".repeat(options.tokenLength);
  if (!options.missing) await writeFile(join(home, "pairing.json"), JSON.stringify(pairing));
  if (options.echo) {
    await mkdir(join(home, "providers"));
    await writeFile(join(home, "providers", "echo.json"), JSON.stringify({
      id: "echo", name: "Offline echo acceptance", version: "0.1.0", description: "Isolated offline acceptance fixture",
      distribution: { type: "command", command: process.execPath, args: [fileURLToPath(new URL("../testing/echo-agent.ts", import.meta.url))] },
      pew: { transport: "acp", requiresWorkspace: false },
    }));
  }
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("../cli/index.ts", import.meta.url)), "serve", "--desktop-control"], {
    env: { ...process.env, HOME: home, USERPROFILE: home, PEW2_HOME: home, PEW2_WORKSPACE: home, PEW2_PORT: String(options.port ?? 0), PEW2_TOKEN: undefined, PEW2_RELAY: undefined, PEW2_EXPERIMENTAL: "1" },
    cwd: home, stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  const timeout = setTimeout(() => child.kill(), 15_000);
  const stderr = new Response(child.stderr).text();
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let id = 0;
  async function request(command: string): Promise<Exclude<ControlResponse, { type: "pairing" }> | { type: "pairing"; pairing: { link: string; modules: string[] } }> {
    await child.stdin.write(`${JSON.stringify({ v: CONTROL_VERSION, id: String(++id), command, instance: "owned-test" })}\n`);
    while (!buffer.includes("\n")) {
      const next = await reader.read();
      if (next.done) throw new Error("control pipe closed before response");
      buffer += decoder.decode(next.value, { stream: true });
      if (buffer.length > 65537) throw new Error("response too large");
    }
    const end = buffer.indexOf("\n");
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    return JSON.parse(line);
  }
  async function dispose() {
    if (child.exitCode === null) child.kill();
    await child.exited;
    clearTimeout(timeout);
    reader.releaseLock();
  }
  return { child, request, home, pairing, stderr, dispose };
}

test("real desktop daemon binds, reveals only on request, stops and preserves pairing", async () => {
  const run = await launch();
  try {
    const hello = await run.request("hello");
    expect(hello.type).toBe("status");
    if (hello.type !== "status") throw new Error("not ready");
    expect(hello.status.authenticatedConnections).toBe(0);
    expect(hello.status.port).toBeGreaterThan(0);
    expect(JSON.stringify(hello)).not.toContain(run.pairing.token);
    expect(JSON.stringify(hello)).not.toContain(run.pairing.key);
    const reveal = await run.request("reveal-pairing");
    expect(reveal.type).toBe("pairing");
    if (reveal.type === "pairing") expect(reveal.pairing.modules.length).toBeGreaterThanOrEqual(21);
    expect((await run.request("hide-pairing")).type).toBe("hidden");
    const stopped = await run.request("stop-request");
    expect(stopped.type).toBe("status");
    if (stopped.type === "status") expect(stopped.status.lifecycle).toBe("stopping");
    expect(await run.child.exited).toBe(0);
    const logs = await run.stderr;
    expect(logs).not.toContain(run.pairing.token);
    expect(logs).not.toContain(run.pairing.key);
    expect(JSON.parse(await readFile(join(run.home, "pairing.json"), "utf8"))).toEqual(run.pairing);
  } finally { await run.dispose(); }
}, 20_000);

test("desktop phone status excludes CLI watchers and pre-hello bearer sockets", async () => {
  const run = await launch();
  let watcher: AppClient | undefined;
  let phone: AppClient | undefined;
  let bearer: WebSocket | undefined;
  async function checkPhoneCount(count: number) {
    const response = await run.request("status");
    if (response.type !== "status") throw new Error("missing status");
    expect(response.status.authenticatedConnections).toBe(count);
    expect(statusLabel({
      lifecycle: "ready", instance: "owned-test", home: null, status: response.status,
      failure: null, confirmation: null, forceConfirmation: false, networkExposure: "unverified",
    })).toBe(count ? "Phone connected" : "Ready for your phone");
  }
  try {
    const hello = await run.request("hello");
    if (hello.type !== "status") throw new Error("not ready");
    await checkPhoneCount(0);
    const target = {
      port: hello.status.port, token: run.pairing.token, key: run.pairing.key!,
      output: () => "Private desktop output withheld",
      died: () => run.child.exitCode === null ? undefined : "Test daemon exited", stop: run.dispose,
    };
    watcher = await AppClient.connect(target, { deviceId: `${CLI_DEVICE_PREFIX}desktop-status-test` });
    // Receiving encrypted inventory proves legitimate watcher access still works.
    expect(watcher.frames.some(frame => frame.t === "providers")).toBe(true);
    await checkPhoneCount(0);
    expect(JSON.parse(await readFile(join(run.home, "pairing.json"), "utf8")).claimedBy).toBeUndefined();

    bearer = new WebSocket(`ws://127.0.0.1:${target.port}/?token=${encodeURIComponent(target.token)}`);
    await new Promise<void>((resolve, reject) => {
      bearer!.onmessage = event => {
        if (JSON.parse(String(event.data)).t === "ready") resolve();
      };
      bearer!.onerror = () => reject(new Error("test bearer socket failed"));
    });
    await checkPhoneCount(0);

    phone = await AppClient.connect(target, { deviceId: "desktop-status-phone" });
    await checkPhoneCount(1);
    await watcher.waitFor(frame => frame.t === "device.joined" && frame.deviceId === "desktop-status-phone");
    phone.close();
    // Wait for the server's close callback, not just the local close request.
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await run.request("status");
      if (response.type === "status" && response.status.authenticatedConnections === 0) break;
      await Bun.sleep(10);
    }
    await checkPhoneCount(0); // Watcher and bearer are still connected.
    expect((await run.request("stop-request")).type).toBe("status");
    expect(await run.child.exited).toBe(0);
    const logs = await run.stderr;
    expect(logs).not.toContain(run.pairing.token);
    expect(logs).not.toContain(run.pairing.key);
  } finally { phone?.close(); watcher?.close(); bearer?.close(); await run.dispose(); }
}, 20_000);

test("desktop rotation revokes live access even after a relay is configured", async () => {
  let relayAttempts = 0;
  const relay = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    fetch: () => { relayAttempts++; return new Response("offline relay trap", { status: 503 }); },
  });
  const run = await launch({ claimedBy: "rotation-old-phone" });
  let oldPhone: AppClient | undefined;
  let newWatcher: AppClient | undefined;
  try {
    const hello = await run.request("hello");
    if (hello.type !== "status") throw new Error("not ready");
    const target = {
      port: hello.status.port, token: run.pairing.token, key: run.pairing.key,
      output: () => "Private desktop output withheld",
      died: () => run.child.exitCode === null ? undefined : "Test daemon exited", stop: run.dispose,
    };
    oldPhone = await AppClient.connect(target, { deviceId: "rotation-old-phone" });
    const connected = await run.request("status");
    if (connected.type !== "status") throw new Error("missing status");
    expect(connected.status.authenticatedConnections).toBe(1);

    const env = { PEW2_HOME: run.home };
    const relayUrl = `http://127.0.0.1:${relay.port}`;
    await setRelay(relayUrl, env);
    const rotated = await rotatePairing(env);
    const path = join(run.home, "pairing.json");
    const bytes = await readFile(path, "utf8");
    expect(rotated.relay).toBe(relayUrl);
    expect(rotated.claimedBy).toBeUndefined();
    // This must be the server's rotation close, not a local client shutdown.
    await expect(oldPhone.waitFor(() => false, "rotation disconnect", 4_000))
      .rejects.toThrow("socket closed (1012 pairing rotated)");
    const revoked = await fetch(`http://127.0.0.1:${target.port}/?token=${target.token}`, {
      headers: { Upgrade: "websocket", Connection: "Upgrade", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version": "13" },
    });
    expect(revoked.status).toBe(401);
    const disconnected = await run.request("status");
    if (disconnected.type !== "status") throw new Error("missing status");
    expect(disconnected.status.authenticatedConnections).toBe(0);
    // A watcher authenticates with the new key without writing a phone claim.
    newWatcher = await AppClient.connect({ ...target, token: rotated.token, key: rotated.key! }, {
      deviceId: `${CLI_DEVICE_PREFIX}rotation-new-key`,
    });
    expect(newWatcher.frames.some(frame => frame.t === "providers")).toBe(true);
    expect(await readFile(path, "utf8")).toBe(bytes);
    expect((await run.request("stop-request")).type).toBe("status");
    expect(await run.child.exited).toBe(0);
    expect(relayAttempts).toBe(0);
    expect(await readFile(path, "utf8")).toBe(bytes);
  } finally {
    oldPhone?.close(); newWatcher?.close(); await run.dispose(); await relay.stop(true);
  }
}, 20_000);

test("desktop startup still refuses a relay profile without changing it or dialing relay", async () => {
  let relayAttempts = 0;
  const relay = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    fetch: () => { relayAttempts++; return new Response("offline relay trap", { status: 503 }); },
  });
  const run = await launch({ relay: `http://127.0.0.1:${relay.port}` });
  try {
    const path = join(run.home, "pairing.json");
    const bytes = await readFile(path, "utf8");
    const response = await run.request("hello");
    expect(response.type).toBe("failure");
    if (response.type === "failure") expect(response.code).toBe("relay_configured");
    expect(await run.child.exited).toBe(1);
    expect(await readFile(path, "utf8")).toBe(bytes);
    expect(relayAttempts).toBe(0);
  } finally { await run.dispose(); await relay.stop(true); }
}, 20_000);

test("parent pipe EOF shuts down an idle real daemon", async () => {
  const run = await launch();
  try {
    expect((await run.request("hello")).type).toBe("status");
    await run.child.stdin.end();
    expect(await run.child.exited).toBe(0);
  } finally { await run.dispose(); }
}, 20_000);

test("missing profile fails without silently creating identity", async () => {
  const run = await launch({ missing: true });
  try {
    const response = await run.request("hello");
    expect(response.type).toBe("failure");
    if (response.type === "failure") expect(response.code).toBe("missing_profile");
    expect(await run.child.exited).toBe(1);
    expect(await Bun.file(join(run.home, "pairing.json")).exists()).toBe(false);
  } finally { await run.dispose(); }
}, 20_000);

test("authenticated offline echo approval requires confirmation and cancelling leaves work alive", async () => {
  const run = await launch({ echo: true, tokenLength: 1024 });
  let app: AppClient | undefined;
  try {
    const hello = await run.request("hello");
    if (hello.type !== "status") throw new Error("not ready");
    app = await AppClient.connect({
      port: hello.status.port, token: run.pairing.token, key: run.pairing.key,
      output: () => "Private desktop output withheld", died: () => run.child.exitCode === null ? undefined : "Test daemon exited", stop: run.dispose,
    }, { deviceId: "desktop-offline-test" });
    const inventory = await app.waitFor(frame => frame.t === "providers", "offline provider inventory");
    expect(inventory.providers.some((provider: { id: string; name: string }) => provider.id === "echo" && provider.name === "Offline echo acceptance")).toBe(true);
    const connected = await run.request("status");
    if (connected.type !== "status") throw new Error("missing status");
    expect(connected.status.authenticatedConnections).toBe(1);
    app.send({ t: "session.start", requestId: "offline-session", providerId: "echo" });
    const started = await app.waitFor(frame => frame.t === "session.started", "offline session");
    app.send({ t: "session.prompt", sessionId: started.sessionId as string, text: "permission" });
    await app.waitFor(frame => frame.t === "session.event" && frame.payload?.kind === "permission_request", "offline approval");
    const beforeReveal = await run.request("status");
    if (beforeReveal.type !== "status") throw new Error("missing status before reveal");
    expect(beforeReveal.status.busy).not.toBeNull();
    for (let attempt = 0; attempt < 2; attempt++) {
      const reveal = await run.request("reveal-pairing");
      expect(reveal.type).toBe("pairing");
      expect((await run.request("hide-pairing")).type).toBe("hidden");
      const alive = await run.request("status");
      if (alive.type !== "status") throw new Error("missing status after reveal");
      expect(alive.status.lifecycle).toBe("ready");
      expect(alive.status.busy).toBe(beforeReveal.status.busy);
      expect(alive.status.authenticatedConnections).toBe(1);
      expect(run.child.exitCode).toBeNull();
    }
    // A fresh authenticated catch-up proves the same session still owns its
    // unanswered permission, rather than relying only on the coarse busy label.
    app.close();
    app = await AppClient.connect({
      port: hello.status.port, token: run.pairing.token, key: run.pairing.key,
      output: () => "Private desktop output withheld", died: () => run.child.exitCode === null ? undefined : "Test daemon exited", stop: run.dispose,
    }, { deviceId: "desktop-offline-test", cursors: { [started.sessionId]: 0 } });
    const replay = await app.waitFor(frame => frame.t === "session.replay" && frame.sessionId === started.sessionId, "same session approval after reveal");
    expect(replay.working).toBe(true);
    expect(replay.permissions).toHaveLength(1);
    expect((await run.request("stop-request")).type).toBe("confirmation-required");
    // Cancel means no confirmation is sent. Status must remain ready and busy.
    const cancelled = await run.request("status");
    if (cancelled.type !== "status") throw new Error("missing running status");
    expect(cancelled.status.lifecycle).toBe("ready");
    expect(cancelled.status.busy).not.toBeNull();
    expect(run.child.exitCode).toBeNull();
    expect((await run.request("confirm-stop")).type).toBe("status");
    expect(await run.child.exited).toBe(0);
  } finally { app?.close(); await run.dispose(); }
}, 20_000);

test("port collision refuses ownership and leaves the independent listener alive", async () => {
  const listener = Bun.serve({ port: 0, hostname: "0.0.0.0", fetch: () => new Response("independent") });
  const run = await launch({ port: listener.port! });
  try {
    const response = await run.request("hello");
    expect(response.type).toBe("failure");
    if (response.type === "failure") expect(response.code).toBe("port_unavailable");
    expect(await run.child.exited).toBe(1);
    expect(await (await fetch(`http://127.0.0.1:${listener.port}/`)).text()).toBe("independent");
  } finally { await run.dispose(); await listener.stop(true); }
}, 20_000);
