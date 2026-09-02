const messages = {
  link: {
    empty: "Enter a link.",
    "invalid-url": "Not a valid link. Should start with ws://",
    "unsupported-protocol": "Need a ws:// or wss:// link.",
    "missing-token": "No token in that link. Run `pew2 pair` again.",
    "short-token": "Token too short. The link looks cut off.",
    "missing-key": "That link has no encryption key. Update pew2 and run `pew2 pair`.",
    "invalid-key": "The encryption key in that link is damaged. Scan it again.",
  },
  socket: {
    "create-failed":
      "That code did not connect. Check the machine is awake and running pew2 — and if the code is old, run `pew2 pair` there to get the current one.",
    "timed-out":
      "That code did not connect. Check the machine is awake and running pew2 — and if the code is old, run `pew2 pair` there to get the current one.",
    "transport-error":
      "That code did not connect. Check the machine is awake and running pew2 — and if the code is old, run `pew2 pair` there to get the current one.",
    "closed-before-proof":
      "That code did not connect. Check the machine is awake and running pew2 — and if the code is old, run `pew2 pair` there to get the current one.",
    "reconnect-stalled": "Can't reach your machine.",
  },
  handshake: {
    "send-failed":
      "That code did not connect. Check the machine is awake and running pew2 — and if the code is old, run `pew2 pair` there to get the current one.",
    "device-refused": "This pairing is already in use. Run `pew2 pair --rotate` on the machine.",
    unpaired: "This device is no longer paired. Run `pew2 pair` on the machine.",
    "wire-version": "This app and the machine use different protocol versions. Update pew2 on the machine.",
    "key-mismatch":
      "That code did not work: the machine answered with a key this device cannot read. Run `pew2 pair` on the machine and scan the new code.",
  },
} as const;

export type PairingFailureStage = keyof typeof messages;
type LinkReason = keyof typeof messages.link;
type SocketReason = keyof typeof messages.socket;
type HandshakeReason = keyof typeof messages.handshake;

export type PairingFailureReason =
  | { stage: "link"; reason: LinkReason }
  | { stage: "socket"; reason: SocketReason }
  | { stage: "handshake"; reason: HandshakeReason };

declare const pairingFailureBrand: unique symbol;

type PairingFailureData =
  | { readonly stage: "link"; readonly reason: LinkReason; readonly message: string }
  | { readonly stage: "socket"; readonly reason: SocketReason; readonly message: string }
  | { readonly stage: "handshake"; readonly reason: HandshakeReason; readonly message: string };

export type PairingFailure = PairingFailureData & { readonly [pairingFailureBrand]: true };

export const pairingFailure = {
  link: (reason: LinkReason): PairingFailure =>
    ({ stage: "link", reason, message: messages.link[reason] }) as PairingFailure,
  socket: (reason: SocketReason): PairingFailure =>
    ({ stage: "socket", reason, message: messages.socket[reason] }) as PairingFailure,
  handshake: (reason: HandshakeReason): PairingFailure =>
    ({ stage: "handshake", reason, message: messages.handshake[reason] }) as PairingFailure,
};

export function pairingRefusalFailure(code: unknown): PairingFailure | undefined {
  if (code === "device-refused") return pairingFailure.handshake("device-refused");
  if (code === "unpaired") return pairingFailure.handshake("unpaired");
  if (code === "wire-version") return pairingFailure.handshake("wire-version");
  return undefined;
}

/** Target broadcast refusals; preserve legacy `unpaired` from the one-socket LAN path. */
export function pairingRefusalForDevice(
  frame: { code?: unknown; deviceId?: unknown },
  currentDeviceId: string,
): PairingFailure | undefined {
  if (frame.code === "unpaired") return pairingRefusalFailure(frame.code);
  if (frame.deviceId !== currentDeviceId) return undefined;
  return pairingRefusalFailure(frame.code);
}

export function formatPairingFailure(failure: PairingFailure): string {
  return `${failure.message}\nDiagnostic: ${failure.stage}/${failure.reason}`;
}

export function recordPairingFailure(failure: PairingFailure): void {
  console.warn(failure.stage, failure.reason);
}
