/**
 * Prove a pairing works before the app commits to it.
 *
 * A scanned link only ever had its *shape* checked: the right host, a token of
 * the right length, a key that decodes. None of that says the credential is
 * live. A retired token parses exactly as well as a current one, so the app
 * stored it, moved to the main screen, and sat on "Connecting to your
 * machine..." forever — the one state that looks like a slow network and is
 * actually permanent.
 *
 * The transport cannot tell the user this on its own. Both refusals happen
 * before a WebSocket exists: the daemon answers 401 on the LAN, and the relay
 * answers 409 for a room with no daemon in it, which is precisely the room a
 * rotated token names. There is no open socket to carry an explanation down, so
 * the app has to find out by trying.
 *
 * So: connect, prove, and require a sealed answer. A frame this device can
 * decrypt is the only evidence that means anything — it says the machine is
 * reachable, that it accepted this device, and that both ends hold the same
 * key. Anything less is a guess.
 */
import { SecureChannel, e2e, wire } from "@pew2/protocol";
import type { Pairing } from "./pairingLink";
import { pairingFailure, pairingRefusalForDevice, type PairingFailure } from "./pairingFailure";

/**
 * How long to wait for a sealed reply.
 *
 * Long enough for a phone on mobile data to reach a relay and wake a sleeping
 * Durable Object, short enough that a dead code is not mistaken for a slow one.
 * The user is watching a spinner for this whole time, so it cannot grow much.
 */
export const VERIFY_TIMEOUT_MS = 8000;

export type VerifyResult = { ok: true } | { ok: false; failure: PairingFailure };


/**
 * Try one full handshake against a pairing.
 *
 * `createSocket` is injectable so this can be tested without a network; the
 * default is the platform WebSocket.
 */
export function verifyPairing(
  pairing: Pairing,
  options: {
    timeoutMs?: number;
    createSocket?: (url: string) => WebSocket;
  } = {},
): Promise<VerifyResult> {
  const timeoutMs = options.timeoutMs ?? VERIFY_TIMEOUT_MS;
  const create = options.createSocket ?? ((url: string) => new WebSocket(url));

  return new Promise<VerifyResult>((resolve) => {
    let socket: WebSocket;
    try {
      socket = create(pairing.url);
    } catch {
      // A URL the platform will not even open. Already validated by
      // `parsePairing`, so this is a runtime refusal rather than a typo.
      resolve({ ok: false, failure: pairingFailure.socket("create-failed") });
      return;
    }

    const channel = new SecureChannel(e2e.fromHex(pairing.key), "app");
    let settled = false;

    const finish = (result: VerifyResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Detached before closing: this probe is not the app's connection, and a
      // close handler firing afterwards must not resolve a second time.
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close();
      } catch {
        // Already gone. Nothing to release.
      }
      resolve(result);
    };

    const timer = setTimeout(
      () => finish({ ok: false, failure: pairingFailure.socket("timed-out") }),
      timeoutMs,
    );

    socket.onopen = () => {
      try {
        socket.send(
          JSON.stringify({
            t: "hello",
            wire: wire.WIRE_VERSION,
            role: "app",
            deviceId: pairing.deviceId,
            proof: channel.proof(pairing.deviceId),
          }),
        );
      } catch {
        finish({ ok: false, failure: pairingFailure.handshake("send-failed") });
      }
    };

    socket.onmessage = (event: { data: unknown }) => {
      let frame: unknown;
      try {
        frame = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const kind = (frame as { t?: unknown } | null)?.t;

      // The relay's own greeting, sent to anyone it lets into a room. It proves
      // nothing about the machine, so it is not an answer.
      if (kind === "ready") return;

      // Only allowlisted codes are trusted. Relay-broadcastable refusals must
      // name this device; legacy `unpaired` remains valid for the LAN socket.
      if (kind === "error") {
        const failure = pairingRefusalForDevice(
          frame as { code?: unknown; deviceId?: unknown; update?: unknown },
          pairing.deviceId,
        );
        if (failure) finish({ ok: false, failure });
        return;
      }

      if (kind !== "e") return;

      // The only real evidence. Undecryptable traffic means the far end holds a
      // different key — a token and key from different pairings, or a link
      // assembled by hand — so it is a failure, not something to wait past.
      if (channel.open(frame) === undefined) {
        finish({ ok: false, failure: pairingFailure.handshake("key-mismatch") });
        return;
      }
      finish({ ok: true });
    };

    // Both fire for a refusal that happened before the socket existed, which is
    // every wrong-credential case. There is nothing to read from them: the
    // close code is 1006 with no reason on most platforms, so the honest
    // message is the one that does not pretend to know which cause it was.
    socket.onerror = () =>
      finish({ ok: false, failure: pairingFailure.socket("transport-error") });
    socket.onclose = () =>
      finish({ ok: false, failure: pairingFailure.socket("closed-before-proof") });
  });
}
