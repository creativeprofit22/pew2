import { expect, test } from "bun:test";
import { createControlHandler, coarseBusy } from "./runtime.js";
import { CONTROL_VERSION, type Status } from "./protocol.js";

const request = (command: "stop-request" | "confirm-stop" | "status", instance = "one") => ({ v: CONTROL_VERSION, id: "1", command, instance });

test("stop rechecks busy at the action instead of relying on previous status", async () => {
  const status: Status = { lifecycle: "ready", bindAddress: "0.0.0.0", port: 8787, authenticatedConnections: 0, busy: null };
  let stops = 0;
  const handler = createControlHandler({ status: () => ({ ...status }), shutdown: () => { stops++; }, revealPairing: () => Promise.reject(new Error("unused")) });
  expect((await handler(request("status"))).type).toBe("status");
  status.busy = "pending_approval";
  expect((await handler(request("stop-request"))).type).toBe("confirmation-required");
  expect(stops).toBe(0);
  await expect(handler(request("confirm-stop", "old-instance"))).rejects.toThrow("invalid_frame");
  expect(stops).toBe(0);
  expect((await handler(request("confirm-stop"))).type).toBe("status");
  expect(stops).toBe(1);
  await expect(handler(request("confirm-stop"))).rejects.toThrow("invalid_frame");
});

test("idle stop is immediate and doesn't create an approval", async () => {
  let stopped = false;
  const handler = createControlHandler({
    status: () => ({ lifecycle: "ready", bindAddress: "0.0.0.0", port: 8787, authenticatedConnections: 0, busy: null }),
    shutdown: () => { stopped = true; }, revealPairing: () => Promise.reject(new Error("unused")),
  });
  expect((await handler(request("stop-request"))).type).toBe("status");
  expect(stopped).toBe(true);
  await expect(handler(request("confirm-stop"))).rejects.toThrow();
});

test("busy reasons never disclose session IDs", () => {
  expect(coarseBusy(undefined)).toBeNull();
  expect(coarseBusy("session secret-id is mid-turn")).toBe("active_turn");
  expect(coarseBusy("session secret-id is waiting on an approval")).toBe("pending_approval");
  expect(coarseBusy("session secret-id is still opening")).toBe("opening_session");
});
