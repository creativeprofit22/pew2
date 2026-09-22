import { expect, test } from "bun:test";
import type { Snapshot } from "./bridge.js";
import { displayHome, failureText, initialState, resolveActionFailure, statusLabel, transition } from "./state.js";

const stopped: Snapshot = { lifecycle: "stopped", instance: null, home: "E:\\pew2 data", status: null, failure: null, confirmation: null, forceConfirmation: false, networkExposure: "unverified" };

test("double-click start is not queued and late results cannot overwrite a new action", () => {
  const starting = transition(initialState, { type: "begin", action: "Starting", epoch: 1 });
  expect(transition(starting, { type: "begin", action: "Starting", epoch: 2 })).toBe(starting);
  expect(transition(starting, { type: "snapshot", snapshot: stopped, epoch: 0 })).toBe(starting);
  const ready = transition(starting, { type: "snapshot", snapshot: { ...stopped, instance: "new-run", lifecycle: "ready" }, epoch: 1 });
  const settled = transition(ready, { type: "end", epoch: 1 });
  const next = transition(settled, { type: "begin", action: "Stopping", epoch: 2 });
  expect(transition(next, { type: "snapshot", snapshot: { ...stopped, lifecycle: "failed", failure: "unexpected_exit" }, epoch: 1 })).toBe(next);
});

test("diagnostics are bounded and never display raw error contents", () => {
  let state = initialState;
  for (let i = 0; i < 100; i++) state = transition(state, { type: "error", error: `secret-${i}`, epoch: 0 });
  expect(state.diagnostics).toHaveLength(20);
  expect(JSON.stringify(state)).not.toContain("secret-");
  expect(failureText("__proto__")).toBe(failureText("unknown"));
  expect(failureText({ token: "secret" })).not.toContain("secret");
});

test("pairing errors report a failed action without changing daemon state", () => {
  const snapshot: Snapshot = { ...stopped, lifecycle: "ready", instance: "owned", confirmation: "pending_approval" };
  const state = transition(initialState, { type: "snapshot", snapshot, epoch: 0 });
  const failed = transition(state, { type: "error", error: "pairing_unavailable", epoch: 0 });
  expect(failed.snapshot).toBe(snapshot);
  expect(failed.snapshot?.forceConfirmation).toBe(false);
  expect(failed.error).toContain("active work are still running");
});

test.each([
  ["missing_profile", "relay_configured"],
  ["port_unavailable", "missing_binary"],
  ["port_unavailable", "workspace_missing"],
])("current action error overrides stale %s with %s", (previous, current) => {
  for (const error of [current, new Error(current)]) {
    const snapshot: Snapshot = { ...stopped, failure: previous };
    let state = transition(initialState, { type: "snapshot", snapshot, epoch: 0 });
    state = transition(state, { type: "begin", action: "Trying again", epoch: 1 });
    state = transition(state, { type: "snapshot", snapshot, epoch: 1 });
    state = transition(state, { type: "error", error: resolveActionFailure(error, snapshot.failure), epoch: 1 });
    state = transition(state, { type: "end", epoch: 1 });
    // Later polling must not replace the current action's remediation either.
    state = transition(state, { type: "snapshot", snapshot, epoch: 1 });
    expect(state.error).toBe(failureText(current));
    expect(state.error).not.toBe(failureText(previous));
    expect(state.snapshot).toBe(snapshot);
    expect(state.pending).toBeNull();
  }
});

test("only the generic daemon wrapper uses the refreshed lifecycle failure", () => {
  for (const error of ["daemon_failed", new Error("daemon_failed")]) {
    expect(failureText(resolveActionFailure(error, "port_unavailable"))).toBe(failureText("port_unavailable"));
    expect(failureText(resolveActionFailure(error, null))).toBe(failureText("unknown"));
    expect(failureText(resolveActionFailure(error))).toBe(failureText("unknown"));
    expect(failureText(resolveActionFailure(error, "secret-native-details"))).toBe(failureText("unknown"));
  }
  expect(failureText(resolveActionFailure("missing_binary"))).toBe(failureText("missing_binary"));
});

test("unknown action errors remain sanitized rather than inheriting stale remediation", () => {
  for (const error of ["secret-native-details", new Error("secret-native-details"), { message: "daemon_failed" }, "__proto__"]) {
    const state = transition(initialState, {
      type: "error", error: resolveActionFailure(error, "missing_profile"), epoch: 0,
    });
    expect(state.error).toBe(failureText("unknown"));
    expect(JSON.stringify(state)).not.toContain("secret-native-details");
  }
});

test("native extended paths are shortened only for display", () => {
  expect(displayHome(String.raw`\\?\E:\pew2 data`)).toBe(String.raw`E:\pew2 data`);
  expect(displayHome(String.raw`\\?\UNC\server\share`)).toBe(String.raw`\\server\share`);
});

test("phone connectivity comes only from the private phone-only authenticated count", () => {
  expect(statusLabel(stopped)).toBe("Phone access is stopped");
  const ready: Snapshot = { ...stopped, lifecycle: "ready", instance: "a", status: { lifecycle: "ready", bindAddress: "0.0.0.0", port: 8787, busy: null, authenticatedConnections: 0 } };
  expect(statusLabel(ready)).toBe("Ready for your phone");
  const connected = { ...ready, status: { ...ready.status!, authenticatedConnections: 1 } };
  expect(statusLabel(connected)).toBe("Phone connected");
  expect(statusLabel({ ...connected, status: { ...connected.status, authenticatedConnections: 0 } })).toBe("Ready for your phone");
});
