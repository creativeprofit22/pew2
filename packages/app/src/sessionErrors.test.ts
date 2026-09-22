import { expect, test } from "bun:test";
import { foldSessionError } from "./sessionErrors";
import { beginActivity } from "./activity";
import type { Session } from "./useDaemon";

function state() {
  const sessions: Session[] = ["A", "B"].map((id) => ({
    id, providerId: "gg", title: id, startedAt: 1, configOptions: [], busy: true,
    turns: [{ id: `${id}:1`, role: "user", text: `Prompt ${id}` }],
  }));
  return {
    sessionId: "B", sessions, turns: sessions[1]!.turns,
    busy: true, loadingSession: true, loadingProject: "gg:repo" as string | undefined,
    activity: beginActivity(10), receipt: undefined,
  };
}

const failure = { code: "prompt_failed", message: "Provider rejected the prompt", sessionId: "A" };

test("A rejects while B runs: only A history and status change", () => {
  const before = state();
  const after = foldSessionError(before, failure, 20);
  expect(after.turns).toBe(before.turns);
  expect(after.busy).toBe(true);
  expect(after.loadingSession).toBe(true);
  expect(after.activity).toBe(before.activity);
  expect(after.receipt).toBe(before.receipt);
  expect(after.sessions[1]).toBe(before.sessions[1]);
  expect(after.sessions[0]?.busy).toBe(false);
  expect(after.sessions[0]?.unread).toBe(true);
  expect(after.sessions[0]?.turns.at(-1)?.text).toBe(failure.message);
});

test("dedup searches A, not identical text in B, and keeps the history copy", () => {
  const before = state();
  for (const row of before.sessions) {
    row.turns.push({ id: `${row.id}:2`, role: "agent", text: failure.message });
  }
  const after = foldSessionError(before, failure, 20);
  expect(after.sessions[0]?.turns).toHaveLength(2);
  expect(after.sessions[0]?.turns[1]?.role).toBe("system");
  expect(after.turns[1]?.role).toBe("agent");
  const repeated = foldSessionError(after, failure, 21);
  expect(repeated.sessions[0]?.turns).toHaveLength(2);
});

test("visible prompt failure is mirrored into history and clears its loading state", () => {
  const before = state();
  const after = foldSessionError(before, { ...failure, sessionId: "B" }, 20);
  expect(after.busy).toBe(false);
  expect(after.loadingSession).toBe(false);
  expect(after.turns).toBe(after.sessions[1]!.turns);
  expect(after.sessions[1]?.busy).toBe(false);
  expect(after.sessions[0]).toBe(before.sessions[0]);
});

test("config rejection during a turn never stops its work or creates a receipt", () => {
  for (const sessionId of ["A", "B", undefined]) {
    const before = state();
    const after = foldSessionError(before, { ...failure, code: "config_failed", sessionId }, 20);
    expect(after.busy).toBe(true);
    expect(after.loadingSession).toBe(true);
    expect(after.activity).toBe(before.activity);
    expect(after.receipt).toBeUndefined();
    expect(after.sessions.every((row) => row.busy)).toBe(true);
    expect((sessionId === "A" ? after.sessions[0]!.turns : after.turns).at(-1)?.role).toBe("system");
  }
});

test("other scoped command failures do not imply prompt completion", () => {
  const before = state();
  const after = foldSessionError(before, { ...failure, code: "command_failed", sessionId: "B" }, 20);
  expect(after.busy).toBe(true);
  expect(after.sessions[1]?.busy).toBe(true);
});

test("unknown session errors never fall through into the current conversation", () => {
  const before = state();
  expect(foldSessionError(before, { ...failure, sessionId: "removed" }, 20)).toBe(before);
});

test("legacy unscoped failures retain current-thread handling and dedup", () => {
  const before = state();
  const after = foldSessionError(before, { code: "command_failed", message: failure.message }, 20);
  expect(after.busy).toBe(false);
  expect(after.loadingSession).toBe(false);
  expect(after.turns.at(-1)?.text).toBe(failure.message);
  expect(after.sessions[0]).toBe(before.sessions[0]);
  expect(foldSessionError(after, { code: "command_failed", message: failure.message }, 21).turns).toHaveLength(2);
});

test("legacy unsupported requests only dismiss the project skeleton", () => {
  const before = state();
  const after = foldSessionError(before, { code: "unknown_message", message: "old daemon" }, 20);
  expect(after).toEqual({ ...before, loadingProject: undefined });
});

test("resume rejection is scoped and visible dedup is mirrored into history", () => {
  const before = state();
  before.turns.push({ id: "B:2", role: "agent", text: failure.message });
  const after = foldSessionError(before, { ...failure, code: "resume_failed", sessionId: "B" }, 20);
  expect(after.loadingSession).toBe(false);
  expect(after.turns).toHaveLength(2);
  expect(after.turns[1]?.role).toBe("system");
  expect(after.sessions[1]?.turns).toBe(after.turns);
});
