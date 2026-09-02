/**
 * Pairing-link validation.
 *
 * Every case here is a real way a link arrives wrong — truncated by a scanner,
 * pasted without the query string, copied from the wrong line of terminal
 * output. Each must fail at parse time with a message that says what to do,
 * because the alternative is a socket that never connects and a blank screen.
 */
import { test, expect } from "bun:test";
import { parsePairing } from "./pairingLink";

const TOKEN = "a".repeat(48);
/** 32 bytes of key, base64url, as the daemon puts it in the fragment. */
const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQ";
const FRAGMENT = `#k=${KEY}`;

test("accepts the URL the daemon prints", () => {
  const result = parsePairing(`ws://192.168.0.102:8787/?token=${TOKEN}${FRAGMENT}`);

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.pairing.url).toBe(`ws://192.168.0.102:8787/?token=${TOKEN}`);
  // The label is what appears in settings, so it must never carry the secret.
  expect(result.pairing.label).toBe("192.168.0.102:8787");
  expect(result.pairing.label).not.toContain(TOKEN);
});

test("tolerates surrounding whitespace from a paste", () => {
  const result = parsePairing(`  ws://192.168.0.102:8787/?token=${TOKEN}\n${FRAGMENT}`);
  expect(result.ok).toBe(true);
});

test("accepts a relay link, and marks it as working from anywhere", () => {
  const result = parsePairing(`wss://relay.example.com/connect?pairing=${TOKEN}&role=app${FRAGMENT}`);

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  // This is the flag the UI uses to say "works from anywhere" rather than
  // "same network only", so it must follow the link shape, not a guess.
  expect(result.pairing.remote).toBe(true);
  expect(result.pairing.label).toBe("relay.example.com");
});

test("rejects a long non-hex relay token before opening a socket", () => {
  const result = parsePairing(
    `wss://relay.example.com/connect?pairing=${"g".repeat(32)}${FRAGMENT}`,
  );

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.failure.reason).toBe("invalid-token");
});

test("accepts mixed-case hexadecimal relay tokens", () => {
  const mixedCaseHex = "aAbBcCdDeEfF00112233445566778899";
  expect(parsePairing(`wss://relay.example.com/connect?pairing=${mixedCaseHex}${FRAGMENT}`).ok).toBe(
    true,
  );
});

test("keeps direct tokens length-only", () => {
  expect(parsePairing(`ws://192.168.0.102:8787/?token=${"z".repeat(32)}${FRAGMENT}`).ok).toBe(
    true,
  );
});

test("validates the relay token when a link contains both token shapes", () => {
  const result = parsePairing(
    `wss://relay.example.com/connect?token=${"z".repeat(32)}&pairing=${"g".repeat(32)}${FRAGMENT}`,
  );

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.failure.reason).toBe("invalid-token");
});

test("a direct link is not remote", () => {
  const result = parsePairing(`ws://192.168.0.102:8787/?token=${TOKEN}${FRAGMENT}`);

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.pairing.remote).toBe(false);
});

test("adds the device id the relay requires", () => {
  // Without it the relay answers 400 and the socket simply never opens, with
  // nothing on screen to explain why.
  const result = parsePairing(
    `wss://relay.example.com/connect?pairing=${TOKEN}&role=app${FRAGMENT}`,
    "phone-abc123",
  );

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(new URL(result.pairing.url).searchParams.get("deviceId")).toBe("phone-abc123");
});

test("replaces the device id carried by the link with this install's own", () => {
  // `pew2 pair` prints `deviceId=phone` so the URL is valid standalone. Keeping
  // it would give every phone that scanned a QR the same identity — and the
  // daemon admits one device per pairing by exactly this id, so a shared
  // placeholder would let a leaked link impersonate the phone that claimed it.
  const result = parsePairing(
    `wss://relay.example.com/connect?pairing=${TOKEN}&role=app&deviceId=phone${FRAGMENT}`,
    "phone-abc123",
  );

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(new URL(result.pairing.url).searchParams.get("deviceId")).toBe("phone-abc123");
  expect(result.pairing.deviceId).toBe("phone-abc123");
});

test("corrects a relay link pasted with the daemon role", () => {
  // Copying the wrong line of terminal output would otherwise put the phone on
  // the daemon side of the relay, where it silently sees no traffic at all.
  const result = parsePairing(`wss://relay.example.com/connect?pairing=${TOKEN}&role=daemon${FRAGMENT}`);

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(new URL(result.pairing.url).searchParams.get("role")).toBe("app");
});

test("maps every link validation branch to an exact allowlisted failure", () => {
  const cases = [
    ["", "empty"],
    ["   ", "empty"],
    ["hello", "invalid-url"],
    ["ws://", "invalid-url"],
    [`http://192.168.0.102:8787/?token=${TOKEN}${FRAGMENT}`, "unsupported-protocol"],
    [`ws://192.168.0.102:8787/${FRAGMENT}`, "missing-token"],
    [`ws://192.168.0.102:8787/?token=${"a".repeat(8)}`, "short-token"],
    [`wss://relay.example.com/connect?pairing=${"g".repeat(32)}${FRAGMENT}`, "invalid-token"],
    [`wss://relay.example.com/connect?pairing=${TOKEN}&role=app`, "missing-key"],
    [`wss://relay.example.com/connect?pairing=${TOKEN}&role=app#nothing=here`, "missing-key"],
    [`wss://relay.example.com/connect?pairing=${TOKEN}&role=app#k=!!!!`, "invalid-key"],
    [`wss://relay.example.com/connect?pairing=${TOKEN}&role=app#k=AAAA`, "invalid-key"],
  ] as const;

  for (const [input, reason] of cases) {
    const result = parsePairing(input);
    expect(result.ok).toBe(false);
    if (result.ok) continue;
    expect(result.failure.stage).toBe("link");
    expect(result.failure.reason).toBe(reason);
  }
});

test("localhost is allowed, because the simulator shares the host network", () => {
  // A real device cannot reach it, but rejecting it would break the development
  // path the daemon itself prints when off a network.
  const result = parsePairing(`ws://localhost:8787/?token=${TOKEN}${FRAGMENT}`);
  expect(result.ok).toBe(true);
});

test("the key is taken from the fragment and kept off the wire", () => {
  // The property the whole design rests on: a URL fragment is never transmitted
  // to a server, so the relay routes this connection without ever receiving what
  // decrypts it.
  const result = parsePairing(
    `wss://relay.example.com/connect?pairing=${TOKEN}&role=app${FRAGMENT}`,
    "phone-1",
  );

  expect(result.ok).toBe(true);
  if (!result.ok) return;

  expect(result.pairing.key).toMatch(/^[0-9a-f]{64}$/);
  // Cleared from the URL that gets opened, so it cannot leak into a log or a
  // settings screen even locally.
  expect(result.pairing.url).not.toContain("#");
  expect(result.pairing.url).not.toContain(KEY);
  expect(result.pairing.label).not.toContain(KEY);
});