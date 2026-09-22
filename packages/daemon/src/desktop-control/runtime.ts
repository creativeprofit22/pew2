import { CONTROL_VERSION, ControlError, encodeResponse, validatePairing, type Busy, type PairingView, type Request, type Response, type Status } from "./protocol.js";
import { installPrivateLogging, runTransport, validateDesktopMode } from "./transport.js";

export interface DesktopServices {
  status(): Status;
  /** Synchronous gate: refuse new work and begin shared shutdown in one turn. */
  shutdown(): void;
  revealPairing(): Promise<PairingView>;
}

let enabled = false;
let attach: ((services: DesktopServices) => void) | undefined;
export function desktopMode(): boolean { return enabled; }

export function coarseBusy(reason: string | undefined): Busy {
  if (!reason) return null;
  if (reason.includes("approval")) return "pending_approval";
  if (reason.includes("opening")) return "opening_session";
  return "active_turn";
}

/** Serial transport calls this; busy is read at the action, never from UI state. */
export function createControlHandler(services: DesktopServices): (request: Request) => Promise<Response> {
  let confirmationInstance: string | undefined;
  return async request => {
    const base = { v: CONTROL_VERSION, id: request.id, instance: request.instance };
    switch (request.command) {
      case "hello":
      case "status":
        return { ...base, type: "status", status: services.status() };
      case "hide-pairing":
        return { ...base, type: "hidden" };
      case "reveal-pairing": {
        try {
          const response: Response = { ...base, type: "pairing", pairing: validatePairing(await services.revealPairing()) };
          // Preflight serialization inside the command boundary, not transport
          // cleanup: a local QR/size failure must never close active sessions.
          encodeResponse(response);
          return response;
        } catch {
          return { ...base, type: "command-error", code: "pairing_unavailable" };
        }
      }
      case "stop-request": {
        const current = services.status();
        if (current.busy) {
          confirmationInstance = request.instance;
          return { ...base, type: "confirmation-required", busy: current.busy };
        }
        confirmationInstance = undefined;
        services.shutdown();
        return { ...base, type: "status", status: { ...current, lifecycle: "stopping" } };
      }
      case "confirm-stop": {
        // A new child/instance cannot consume approval given for an old one.
        if (confirmationInstance !== request.instance) throw new ControlError("invalid_frame");
        confirmationInstance = undefined;
        const current = services.status();
        services.shutdown();
        return { ...base, type: "status", status: { ...current, lifecycle: "stopping" } };
      }
    }
  };
}

/** Called only after bind and shared cleanup registration have both succeeded. */
export function attachDesktopServices(services: DesktopServices): void {
  if (enabled) attach?.(services);
}

/** Invoked by explicit CLI mode, before dynamically importing the server. */
export async function serveDesktop(
  argv: readonly string[],
  loadServer: () => Promise<unknown> = () => import("../server.js"),
): Promise<never> {
  validateDesktopMode(argv, Boolean(process.stdin.isTTY), Boolean(process.stdout.isTTY));
  installPrivateLogging();
  enabled = true;
  let services: DesktopServices | undefined;
  let failed: ControlError | undefined;
  let release: () => void = () => {};
  const ready = new Promise<void>(resolve => { release = resolve; });
  attach = value => { services = value; release(); };
  const shutdown = () => {
    if (services) services.shutdown();
    else process.exit(1);
  };
  // Native owns the hello deadline, including time before this module loads.
  // On timeout it records startup_timeout and closes stdin to request cleanup.
  // No competing daemon timer may turn that result into a generic EOF.
  let handle: ReturnType<typeof createControlHandler> | undefined;
  // This independent EOF listener also fires while a response awaits startup.
  process.stdin.once("end", shutdown);
  process.stdin.once("error", shutdown);
  void runTransport(process.stdin, process.stdout, {
    handle: async request => {
      await ready;
      if (failed) {
        const response: Response = { v: CONTROL_VERSION, id: request.id, instance: request.instance, type: "failure", code: failed.code };
        setTimeout(() => process.exit(1), 100);
        return response;
      }
      if (!services) throw new ControlError("startup_failed");
      handle ??= createControlHandler(services);
      const response = await handle(request);
      return response;
    },
    close: reason => {
      if (reason !== "eof") process.stderr.write(`${reason}\n`);
      shutdown();
    },
  });
  try {
    await loadServer();
  } catch (error) {
    failed = error instanceof ControlError ? error : new ControlError(
      error && typeof error === "object" && "code" in error && error.code === "EADDRINUSE"
        ? "port_unavailable" : "startup_failed",
    );
    release();
  }
  return await new Promise<never>(() => {});
}
