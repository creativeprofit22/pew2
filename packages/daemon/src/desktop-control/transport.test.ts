import { expect, test } from "bun:test";
import { PassThrough, Writable } from "node:stream";
import { runTransport } from "./transport.js";
import { createControlHandler } from "./runtime.js";
import { CONTROL_VERSION } from "./protocol.js";

const request = (id: string, command = "hello", instance = "test-instance") => `${JSON.stringify({ v: CONTROL_VERSION, id, command, instance })}\n`;

async function roundTrip(inputBytes: string) {
  const input = new PassThrough();
  const output = new PassThrough();
  let result = "";
  output.on("data", bytes => { result += bytes.toString(); });
  let closed = "";
  const running = runTransport(input, output, {
    handle: r => ({ v: CONTROL_VERSION, id: r.id, instance: r.instance, type: "hidden" }),
    close: reason => { closed = reason; },
  });
  input.end(inputBytes);
  await running;
  return { result, closed };
}

test("private transport requires handshake and monotonically increasing IDs", async () => {
  const good = await roundTrip(request("1") + request("2", "hide-pairing"));
  expect(good.result.trim().split("\n")).toHaveLength(2);
  expect(good.closed).toBe("eof");
  for (const invalid of [request("1", "status"), request("1") + request("1", "status"), request("1") + request("2", "status", "other"), request("1") + request("2")]) {
    expect((await roundTrip(invalid)).closed).not.toBe("eof");
  }
});

test("pairing generation and size failures are nonfatal command errors", async () => {
  for (const revealPairing of [
    async () => { throw new Error("synthetic-secret-do-not-disclose"); },
    async () => ({ link: "x".repeat(65536), modules: [[true]] }),
    async () => ({ link: `ws://192.168.1.2/?token=${"a".repeat(32)}#k=${"b".repeat(43)}`, modules: Array.from({ length: 181 }, () => Array<boolean>(181).fill(false)) }),
  ]) {
    const input = new PassThrough();
    const output = new PassThrough();
    let result = "";
    let stops = 0;
    let closed = "";
    output.on("data", bytes => { result += bytes.toString(); });
    const running = runTransport(input, output, {
      handle: createControlHandler({
        status: () => ({ lifecycle: "ready", bindAddress: "0.0.0.0", port: 8787, authenticatedConnections: 1, busy: "pending_approval" }),
        shutdown: () => { stops++; }, revealPairing,
      }),
      close: reason => { closed = reason; },
    });
    input.end(request("1") + request("2", "reveal-pairing") + request("3", "hide-pairing") + request("4", "status") + request("5", "stop-request"));
    await running;
    const frames = result.trim().split("\n").map(line => JSON.parse(line));
    expect(frames.map(frame => frame.type)).toEqual(["status", "command-error", "hidden", "status", "confirmation-required"]);
    expect(frames[1].code).toBe("pairing_unavailable");
    expect(frames[3].status.busy).toBe("pending_approval");
    expect(stops).toBe(0);
    expect(closed).toBe("eof");
    expect(result).not.toContain("synthetic-secret");
  }
});

test("terminal flushing is bounded even with a stalled or broken output pipe", async () => {
  for (const stalled of [false, true]) {
    const input = new PassThrough();
    const output = new Writable({ write(_chunk, _encoding, callback) {
      if (!stalled) callback(new Error("synthetic-private-error"));
    } });
    let closed = "";
    const started = performance.now();
    const running = runTransport(input, output, {
      handle: () => { throw new Error("must not reach handler"); },
      close: reason => { closed = reason; },
    });
    input.end(request("1", "status"));
    await running;
    expect(closed).toBe("protocol_mismatch");
    expect(performance.now() - started).toBeLessThan(1000);
    output.destroy(new Error("late-private-error"));
  }
});

test("malformed secret input never appears in output", async () => {
  const result = await roundTrip('{"secret":"do-not-log"}\n');
  expect(result.closed).toBe("protocol_mismatch");
  expect(JSON.parse(result.result)).toEqual({ v: CONTROL_VERSION, type: "terminal", code: "protocol_mismatch" });
});

test("incompatible initial version returns a fixed terminal reason over inherited pipes", async () => {
  const { fileURLToPath } = await import("node:url");
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./transport.fixture.ts", import.meta.url))], {
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  const watchdog = setTimeout(() => child.kill(), 3000);
  try {
    const stdout = new Response(child.stdout).text();
    const stderr = new Response(child.stderr).text();
    await child.stdin.write('{"v":0,"id":"secret-id","instance":"secret-instance","command":"hello"}\n');
    await child.stdin.end();
    expect(await child.exited).toBe(0);
    expect(JSON.parse((await stdout).trim())).toEqual({ v: CONTROL_VERSION, type: "terminal", code: "protocol_mismatch" });
    expect(await stderr).not.toContain("secret");
  } finally {
    if (child.exitCode === null) child.kill();
    await child.exited;
    clearTimeout(watchdog);
  }
});

test("real inherited pipes are drained and EOF invokes cleanup", async () => {
  // fileURLToPath is necessary for Windows drive letters and spaces.
  const { fileURLToPath } = await import("node:url");
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./transport.fixture.ts", import.meta.url))], {
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).text();
  await child.stdin.write(request("1") + request("2", "status"));
  await child.stdin.end();
  expect(await child.exited).toBe(0);
  const frames = (await stdout).trim().split("\n").map(line => JSON.parse(line));
  expect(frames).toHaveLength(2);
  expect(frames.every(frame => frame.type === "hidden")).toBe(true);
  expect(await stderr).toBe("[daemon] diagnostic detail withheld in desktop mode\neof\n");
});
