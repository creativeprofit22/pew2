import type { SecureChannel } from "@pew2/protocol";
import { pairingRefusalForDevice, type PairingFailure } from "./pairingFailure";

/** Bounds transport setup AND the wait for the first authenticated daemon frame. */
export const CONNECT_TIMEOUT = 10_000;

/**
 * The normal saved-pairing socket's health boundary. No native imports: tests
 * drive these same handlers with real SecureChannel frames, not a second probe.
 * Provider-dependent delivery stays with the hook's message handler.
 */
export function attachDaemonConnection(
  ws: Pick<WebSocket, "onopen" | "onmessage" | "onclose" | "onerror" | "close">,
  options: {
    secure: SecureChannel;
    deviceId: string;
    isCurrent: () => boolean;
    onOpen: () => void;
    onOnline: () => void;
    onMessage: (message: unknown) => void;
    onRefusal: (failure: PairingFailure) => void;
    onDisconnect: () => void;
    timeoutMs?: number;
  },
): () => void {
  let stopped = false;
  let proven = false;
  const current = () => !stopped && options.isCurrent();
  const detach = () => {
    stopped = true;
    clearTimeout(deadline);
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
  };
  const disconnect = () => {
    const notify = current();
    detach();
    // Do not depend on a native close event arriving promptly after close().
    try {
      ws.close();
    } finally {
      if (notify) options.onDisconnect();
    }
  };
  const deadline = setTimeout(() => {
    if (!current()) return;
    disconnect();
  }, options.timeoutMs ?? CONNECT_TIMEOUT);

  ws.onopen = () => {
    if (!current()) return;
    // Opening is not proof; keep the deadline and reconnect attempt count.
    try {
      options.onOpen();
    } catch {
      disconnect();
    }
  };
  ws.onmessage = (event) => {
    if (!current()) return;
    let frame: unknown;
    try {
      frame = JSON.parse(event.data as string);
    } catch {
      return;
    }
    const kind = (frame as { t?: unknown } | null)?.t;
    if (kind === "error") {
      const failure = pairingRefusalForDevice(
        frame as { code?: unknown; deviceId?: unknown; update?: unknown },
        options.deviceId,
      );
      if (failure) {
        detach();
        options.onRefusal(failure);
        ws.close();
      }
      return;
    }
    // Cleartext ready proves only that a transport is open.
    if (kind !== "e") return;
    const message = options.secure.open(frame);
    // Includes wrong-key frames and replays. None can cancel the deadline.
    if (message === undefined) return;
    if (!proven) {
      proven = true;
      clearTimeout(deadline);
      options.onOnline();
    }
    options.onMessage(message);
  };
  ws.onclose = () => {
    const notify = current();
    detach();
    if (notify) options.onDisconnect();
  };
  ws.onerror = () => {
    if (current()) disconnect();
  };
  return detach;
}
