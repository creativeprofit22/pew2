import type { Readable, Writable } from "node:stream";
import { once } from "node:events";
import {
  CONTROL_VERSION, ControlError, FrameDecoder, encodeResponse, encodeTerminal, parseRequest,
  type FailureCode, type Request, type Response,
} from "./protocol.js";

export interface ControlHandlers {
  handle(request: Request): Promise<Response> | Response;
  close(reason: "eof" | FailureCode): void;
}

/** One in-flight request; backpressure on both pipes, no unbounded work queue. */
export async function runTransport(input: Readable, output: Writable, handlers: ControlHandlers): Promise<void> {
  const decoder = new FrameDecoder();
  const ignoreOutputError = () => {}; // Write callbacks/drain handle failures; never crash on EPIPE.
  output.on("error", ignoreOutputError);
  // A timed-out terminal write may report EPIPE after runTransport returns.
  // Keep this listener until the owned stream closes, not just until cleanup starts.
  output.once("close", () => output.off("error", ignoreOutputError));
  let lastId = 0;
  let instance: string | undefined;
  let reason: "eof" | FailureCode = "eof";
  try {
    for await (const chunk of input) {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk as Buffer;
      // Node/Bun pipe reads are bounded; also bound synthetic/custom sources.
      if (bytes.length > 256 * 1024) throw new ControlError("invalid_frame");
      const frames = decoder.push(bytes);
      if (frames.length > 64) throw new ControlError("invalid_frame");
      for (const line of frames) {
        const request = parseRequest(line);
        const id = Number(request.id);
        if (!/^[1-9]\d{0,15}$/.test(request.id) || !Number.isSafeInteger(id) || id <= lastId) {
          throw new ControlError("invalid_frame");
        }
        if (instance === undefined) {
          if (request.command !== "hello") throw new ControlError("protocol_mismatch");
          instance = request.instance;
        } else if (instance !== request.instance || request.command === "hello") {
          throw new ControlError("protocol_mismatch");
        }
        lastId = id;
        const response = await handlers.handle(request);
        if (response.id !== request.id || response.instance !== instance || response.v !== CONTROL_VERSION) {
          throw new ControlError("invalid_frame");
        }
        if (!output.write(encodeResponse(response))) await once(output, "drain");
      }
    }
    decoder.end();
  } catch (error) {
    const code = error instanceof ControlError ? error.code : "channel_broken";
    reason = code;
    // Never echo the malformed frame or arbitrary exception text: either may
    // contain a credential. Only a fixed typed failure crosses the boundary.
    // Bound flushing even when the peer stopped draining; cleanup must still run.
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 100);
      const finish = () => { clearTimeout(timer); resolve(); };
      try { output.write(encodeTerminal(code), finish); }
      catch { finish(); }
    });
  } finally {
    handlers.close(reason);
  }
}

/** Reject interactive use and ambiguous launch modes before server import. */
export function validateDesktopMode(argv: readonly string[], inputIsTty: boolean, outputIsTty: boolean): void {
  if (argv.length !== 2 || argv[0] !== "serve" || argv[1] !== "--desktop-control" || inputIsTty || outputIsTty) {
    throw new ControlError("invalid_frame");
  }
}

/** Deliberately lossy: arbitrary provider logs cannot be reliably scrubbed by regex. */
export function installPrivateLogging(): () => void {
  const methods = ["log", "info", "warn", "error", "debug", "trace", "dir", "table"] as const;
  const originals = methods.map(method => console[method].bind(console));
  let count = 0;
  const sanitized = () => {
    // Fixed text only; neither formatted arguments, paths nor exception stacks
    // are forwarded. Native diagnostics use typed control failures instead.
    if (count++ < 128) process.stderr.write("[daemon] diagnostic detail withheld in desktop mode\n");
  };
  for (const method of methods) console[method] = sanitized;
  return () => {
    for (let i = 0; i < methods.length; i++) console[methods[i]!] = originals[i]!;
  };
}
