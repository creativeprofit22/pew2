import { expect, test } from "bun:test";
import { SecureChannel } from "@pew2/protocol";
import { attachDaemonConnection, CONNECT_TIMEOUT } from "./daemonConnection";

const key = new Uint8Array(32).fill(7);
const deviceId = "phone-test";

class FakeSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closes = 0;
  close() {
    this.closes++;
    // Deliberately no close event: a stalled native socket must still retry.
  }
  reply(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

function connection(timeoutMs = 20) {
  const socket = new FakeSocket();
  const daemon = new SecureChannel(key, "daemon");
  const secure = new SecureChannel(key, "app");
  const state = {
    status: "connecting",
    fatal: false,
    current: true,
    opens: 0,
    online: 0,
    disconnects: 0,
    messages: [] as unknown[],
  };
  const detach = attachDaemonConnection(socket as unknown as WebSocket, {
    secure,
    deviceId,
    timeoutMs,
    isCurrent: () => state.current,
    onOpen: () => { state.opens++; },
    onOnline: () => { state.status = "online"; state.online++; },
    onMessage: (message) => { state.messages.push(message); },
    onRefusal: () => { state.status = "offline"; state.fatal = true; },
    // In useDaemon this is scheduleReconnect, retaining its existing backoff.
    onDisconnect: () => { state.status = "offline"; state.disconnects++; },
  });
  return { socket, daemon, state, detach };
}

const pastDeadline = () => new Promise((resolve) => setTimeout(resolve, 45));

test("opened transport without sealed traffic stays connecting, then closes and retries once", async () => {
  expect(CONNECT_TIMEOUT).toBe(10_000);
  const { socket, state } = connection();
  socket.onopen!();
  const lateClose = socket.onclose!;
  expect(state.status).toBe("connecting");
  await pastDeadline();
  expect(state.status).toBe("offline");
  expect(state.online).toBe(0);
  expect(socket.closes).toBe(1);
  expect(state.disconnects).toBe(1);
  lateClose();
  expect(state.disconnects).toBe(1);
});

test("cleartext ready and malformed, wrong-key or invalid sealed frames cannot prove health", async () => {
  const { socket, state } = connection();
  socket.onopen!();
  socket.reply({ t: "ready", wire: 1, now: Date.now() });
  expect(state.status).toBe("connecting");
  socket.onmessage!({ data: "not JSON" });
  socket.reply(null);
  socket.reply({ t: "e" });
  socket.reply(new SecureChannel(new Uint8Array(32).fill(8), "daemon").seal({ t: "device.joined" }));
  expect(state.status).toBe("connecting");
  expect(state.messages).toEqual([]);
  await pastDeadline();
  expect(state.online).toBe(0);
  expect(state.disconnects).toBe(1);
});

for (const message of [
  { t: "device.joined", deviceId, at: 1 },
  { t: "session.replay", sessionId: "chat", catchUp: true, events: [] },
]) {
  test(`${message.t} proves health before providers and cancels the deadline`, async () => {
    const { socket, daemon, state, detach } = connection();
    socket.onopen!();
    const sealed = daemon.seal(message);
    socket.reply(sealed);
    expect(state.status).toBe("online");
    expect(state.messages).toEqual([message]);
    socket.reply(sealed); // replay must not be dispatched twice
    socket.reply(daemon.seal({ t: "providers", providers: [] }));
    expect(state.online).toBe(1);
    expect(state.messages).toHaveLength(2);
    await pastDeadline();
    expect(socket.closes).toBe(0);
    expect(state.disconnects).toBe(0);
    detach();
  });
}

test("addressed refusal is fatal, cancels the deadline and never retries or becomes online", async () => {
  const { socket, daemon, state } = connection();
  socket.onopen!();
  const lateMessage = socket.onmessage!;
  const lateClose = socket.onclose!;
  socket.reply({ t: "error", code: "device-refused", deviceId });
  expect(state.status).toBe("offline");
  expect(state.fatal).toBe(true);
  lateMessage({ data: JSON.stringify(daemon.seal({ t: "device.joined" })) });
  lateClose();
  await pastDeadline();
  expect(state.online).toBe(0);
  expect(state.disconnects).toBe(0);
  expect(socket.closes).toBe(1);
});

test("foreign broadcast refusals do not stop the current handshake", () => {
  const { socket, daemon, state, detach } = connection();
  socket.onopen!();
  socket.reply({ t: "error", code: "device-refused", deviceId: "other-phone" });
  socket.reply({ t: "error", code: "wire-version" });
  expect(state.status).toBe("connecting");
  socket.reply(daemon.seal({ t: "device.joined" }));
  expect(state.status).toBe("online");
  expect(state.fatal).toBe(false);
  detach();
});

test("stale socket handlers and deadline cannot affect a new pairing", async () => {
  const old = connection();
  old.state.current = false;
  const next = connection();
  old.socket.onopen!();
  old.socket.reply(old.daemon.seal({ t: "device.joined" }));
  old.socket.reply({ t: "error", code: "unpaired" });
  old.socket.onerror!();
  next.socket.onopen!();
  next.socket.reply(next.daemon.seal({ t: "device.joined" }));
  await pastDeadline();
  expect(old.state.opens).toBe(0);
  expect(old.state.online).toBe(0);
  expect(old.state.fatal).toBe(false);
  expect(old.state.disconnects).toBe(0);
  expect(old.socket.closes).toBe(0);
  old.socket.onclose!();
  expect(old.state.disconnects).toBe(0);
  expect(next.state.status).toBe("online");
  expect(next.state.disconnects).toBe(0);
  next.detach();
});

test("teardown cancels the timer and makes already queued callbacks inert", async () => {
  const { socket, daemon, state, detach } = connection();
  const open = socket.onopen!;
  const message = socket.onmessage!;
  const close = socket.onclose!;
  detach();
  open();
  message({ data: JSON.stringify(daemon.seal({ t: "device.joined" })) });
  close();
  await pastDeadline();
  expect(state.opens).toBe(0);
  expect(state.online).toBe(0);
  expect(state.disconnects).toBe(0);
  expect(socket.closes).toBe(0);
  expect(socket.onmessage).toBeNull();
});

test("transport close and error cancel the handshake and retry only once", async () => {
  for (const event of ["onclose", "onerror"] as const) {
    const { socket, state } = connection();
    socket[event]!();
    await pastDeadline();
    expect(state.status).toBe("offline");
    expect(state.online).toBe(0);
    expect(state.disconnects).toBe(1);
  }
});

// Source guards supplement the executable seam tests: no native hook renderer
// is installed. Keep the hook wired to the tested seam and preserve queue/UI policy.
test("normal hook uses authenticated health without moving provider-dependent outbox flushing", async () => {
  const source = await Bun.file(new URL("./useDaemon.ts", import.meta.url)).text();
  expect(source).toContain("attachDaemonConnection(ws, {");
  expect(source).not.toContain("ws.onopen = () =>");
  const open = source.slice(source.indexOf("const onOpen ="), source.indexOf("const onMessage ="));
  expect(open).not.toContain('status: "online"');
  expect(open).not.toContain("attempts.current = 0");
  const binding = source.slice(source.indexOf("attachDaemonConnection(ws, {"), source.indexOf("    connect();"));
  expect(binding).toContain('status: "online"');
  expect(binding).toContain("onOnline: () =>");
  expect(binding).toContain("onDisconnect: scheduleReconnect");
  expect(binding).not.toContain("flushOutbox()");
  expect(source).toContain("Math.min(1000 * 2 ** attempts.current, 10_000)");
  const providers = source.slice(source.indexOf('if (message.t === "providers")'), source.indexOf('if (message.t === "provider.capabilities")'));
  expect(providers).toContain("flushOutbox();");
  expect(providers.indexOf("liveSessions.current = new Set")).toBeLessThan(providers.indexOf("flushOutbox();"));
  expect(source).toContain("detachConnection?.();");
  const app = await Bun.file(new URL("../App.tsx", import.meta.url)).text();
  expect(app).toContain("editable={!daemon.fatal}");
});
