/** Private inherited-pipe contract. Never export through the phone protocol. */
export const CONTROL_VERSION = 3 as const;
export const MAX_FRAME_BYTES = 64 * 1024;
export const MAX_REQUEST_ID = 64;
export const FAILURE_CODES = [
  "protocol_mismatch", "invalid_frame", "missing_profile", "relay_configured",
  "port_unavailable", "startup_failed", "channel_broken", "startup_timeout",
] as const;
export type FailureCode = typeof FAILURE_CODES[number];
export type Busy = "active_turn" | "pending_approval" | "opening_session" | null;
export type Command = "hello" | "status" | "stop-request" | "confirm-stop" | "reveal-pairing" | "hide-pairing";
export interface Request {
  v: typeof CONTROL_VERSION;
  id: string;
  command: Command;
  instance: string;
}
export interface Status {
  lifecycle: "ready" | "stopping";
  bindAddress: "0.0.0.0";
  port: number;
  /** Live LAN phone sockets with a completed hello proof and non-CLI device ID; not total clients. */
  authenticatedConnections: number;
  busy: Busy;
}
export interface PairingView {
  link: string;
  modules: boolean[][];
}
export type Response = { v: typeof CONTROL_VERSION; id: string; instance: string } & (
  | { type: "status"; status: Status }
  | { type: "confirmation-required"; busy: Exclude<Busy, null> }
  | { type: "pairing"; pairing: PairingView }
  | { type: "hidden" }
  | { type: "command-error"; code: "pairing_unavailable" }
  | { type: "failure"; code: FailureCode }
);

/** Uncorrelated terminal frame: never includes bytes from a rejected request. */
export function encodeTerminal(code: FailureCode): string {
  return `${JSON.stringify({ v: CONTROL_VERSION, type: "terminal", code })}\n`;
}

export class ControlError extends Error {
  constructor(readonly code: FailureCode) { super(code); }
}
const commands = new Set<Command>(["hello", "status", "stop-request", "confirm-stop", "reveal-pairing", "hide-pairing"]);
const identifier = /^[a-zA-Z0-9_-]{1,64}$/;

export function parseRequest(line: string): Request {
  if (Buffer.byteLength(line) > MAX_FRAME_BYTES) throw new ControlError("invalid_frame");
  let value: unknown;
  try { value = JSON.parse(line); } catch { throw new ControlError("invalid_frame"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ControlError("invalid_frame");
  const frame = value as Record<string, unknown>;
  if (frame.v !== CONTROL_VERSION) throw new ControlError("protocol_mismatch");
  if (Object.keys(frame).length !== 4 ||
      typeof frame.id !== "string" || !identifier.test(frame.id) ||
      typeof frame.instance !== "string" || !identifier.test(frame.instance) ||
      typeof frame.command !== "string" || !commands.has(frame.command as Command)) {
    throw new ControlError("invalid_frame");
  }
  return frame as unknown as Request;
}

/** Validate the secret view before it can cross the native/UI boundary. */
export function validatePairing(view: PairingView): PairingView {
  if (typeof view.link !== "string" || view.link.length > 4096 || /[\r\n\u0000]/.test(view.link)) {
    throw new ControlError("invalid_frame");
  }
  let url: URL;
  try { url = new URL(view.link); } catch { throw new ControlError("invalid_frame"); }
  if (url.protocol !== "ws:" || !/^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname) ||
      url.pathname !== "/" || url.username || url.password ||
      !url.searchParams.has("token") || !/^#k=[a-zA-Z0-9_-]{43}$/.test(url.hash)) {
    throw new ControlError("invalid_frame");
  }
  const size = view.modules.length;
  if (size < 21 || size > 177 || (size - 21) % 4 !== 0 ||
      !view.modules.every(row => Array.isArray(row) && row.length === size && row.every(v => typeof v === "boolean"))) {
    throw new ControlError("invalid_frame");
  }
  return view;
}

export function encodeResponse(response: Response): string {
  // Boolean JSON can exceed 64 KiB well below QR version 40. Row strings
  // bound every supported QR to 177 * 177 cells plus small JSON overhead.
  const wire = response.type === "pairing" ? {
    ...response,
    pairing: {
      link: validatePairing(response.pairing).link,
      modules: response.pairing.modules.map(row => row.map(cell => cell ? "1" : "0").join("")),
    },
  } : response;
  const frame = JSON.stringify(wire);
  if (Buffer.byteLength(frame) > MAX_FRAME_BYTES) throw new ControlError("invalid_frame");
  return `${frame}\n`;
}

/** Incremental bytes, fatal UTF-8, and a fixed bound even without a newline. */
export class FrameDecoder {
  private pending = Buffer.alloc(0);
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  push(chunk: Uint8Array): string[] {
    const frames: string[] = [];
    let start = 0;
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] !== 10) continue;
      const bytes = chunk.subarray(start, i);
      if (this.pending.length + bytes.length > MAX_FRAME_BYTES) throw new ControlError("invalid_frame");
      try { frames.push(this.decoder.decode(Buffer.concat([this.pending, bytes]))); }
      catch { throw new ControlError("invalid_frame"); }
      this.pending = Buffer.alloc(0);
      start = i + 1;
    }
    const remainder = chunk.subarray(start);
    if (this.pending.length + remainder.length > MAX_FRAME_BYTES) throw new ControlError("invalid_frame");
    this.pending = Buffer.concat([this.pending, remainder]);
    return frames;
  }
  end() {
    if (this.pending.length !== 0) throw new ControlError("invalid_frame");
  }
}
