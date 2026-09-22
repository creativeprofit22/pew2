import { expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

let handlers;
let delayed = false;
let pending = false;
let recordings = [];
void mock.module("./speech", () => ({
  speechAvailable: () => true,
  startDictation: async (callbacks) => {
    handlers = callbacks;
    const recording = {
      callbacks,
      cancels: 0,
      stops: 0,
      stop: () => {
        recording.stops++;
        if (!delayed) {
          callbacks.onTranscript("", true);
          callbacks.onEnd();
        }
      },
      cancel: () => { recording.cancels++; },
    };
    recordings.push(recording);
    if (pending) return new Promise((resolve) => { recording.resolve = resolve; });
    return recording;
  },
}));
void mock.module("./haptics", () => ({
  haptics: { sent() {}, finished() {}, failed() {} },
}));
const { useDictation } = await import("./useDictation");

function harness() {
  delayed = true;
  pending = false;
  recordings = [];
  const view = { draft: "", messages: [] };
  function Harness() {
    view.dictation = useDictation({
      draft: () => view.draft,
      onDraftChange: (next) => { view.draft = next; },
      onMessage: (message) => { view.messages.push(message); },
    });
    return null;
  }
  renderToString(createElement(Harness));
  return view;
}

for (const action of ["cancel", "send", "session switch"]) {
  test(`a delayed final after stop and ${action} cannot overwrite the current draft`, async () => {
    const view = harness();
    view.dictation.toggle();
    await Promise.resolve();
    const old = recordings[0];
    old.callbacks.onTranscript("interim words", false);
    view.dictation.toggle();
    view.dictation.cancel(); // Send and session switching use this same public boundary.
    view.draft = action === "send" ? "" : "new draft";
    old.callbacks.onTranscript("late old words", true);
    expect(view.draft).toBe(action === "send" ? "" : "new draft");
    expect(old.cancels).toBe(1);
  });
}

test("a deliberate stop still accepts its delayed non-empty final", async () => {
  const view = harness();
  view.draft = "Please";
  view.dictation.toggle();
  await Promise.resolve();
  const old = recordings[0];
  old.callbacks.onTranscript("fix", false);
  view.dictation.toggle();
  old.callbacks.onTranscript("fix the bug", true);
  old.callbacks.onTranscript("  ", true);
  expect(view.draft).toBe("Please fix the bug");
  old.callbacks.onEnd();
  view.dictation.cancel();
  expect(old.stops).toBe(1);
  expect(old.cancels).toBe(0);
});

test("stale transcript, error and end cannot affect a newer recording", async () => {
  const view = harness();
  view.dictation.toggle();
  await Promise.resolve();
  const old = recordings[0];
  view.dictation.toggle();
  view.draft = "new";
  view.dictation.toggle();
  await Promise.resolve();
  const current = recordings[1];
  old.callbacks.onTranscript("old words", true);
  old.callbacks.onError("network");
  old.callbacks.onEnd();
  expect(view.draft).toBe("new");
  expect(view.messages).toEqual([]);
  current.callbacks.onTranscript("words", false);
  expect(view.draft).toBe("new words");
  view.dictation.toggle();
  expect(current.stops).toBe(1); // Old end must not clear the new listening intent/handle.
  view.dictation.cancel();
  expect(current.cancels).toBe(1);
  expect(old.cancels).toBe(1);
});

for (const resolves of [true, false]) {
  test(`an old permission resolution (${resolves}) cannot own a newer recording`, async () => {
    const view = harness();
    pending = true;
    view.dictation.toggle();
    const old = recordings[0];
    view.dictation.toggle();
    pending = false;
    view.dictation.toggle();
    await Promise.resolve();
    const current = recordings[1];
    old.resolve(resolves ? old : undefined);
    await Promise.resolve();
    await Promise.resolve();
    old.callbacks.onTranscript("stale", true);
    old.callbacks.onEnd();
    expect(view.draft).toBe("");
    view.dictation.toggle();
    expect(current.stops).toBe(1);
    expect(old.cancels).toBe(resolves ? 1 : 0);
    view.dictation.cancel();
  });
}

// Render the real hook with React; only native speech and haptics are stubbed.
// Server rendering is enough here: the callbacks use refs, not a rerender.
for (const base of ["", "Please"]) {
  test(`stopping dictation preserves spoken words with base ${JSON.stringify(base)}`, async () => {
    delayed = false;
    pending = false;
    let draft = base;
    let dictation;
    function Harness() {
      dictation = useDictation({
        draft: () => draft,
        onDraftChange: (next) => { draft = next; },
        onMessage: () => {},
      });
      return null;
    }
    renderToString(createElement(Harness));
    dictation.toggle();
    await Promise.resolve();
    handlers.onTranscript("fix the login", false);
    handlers.onTranscript("fix the login bug", false);
    const expected = base ? `${base} fix the login bug` : "fix the login bug";
    expect(draft).toBe(expected);
    handlers.onTranscript("   ", false);
    expect(draft).toBe(expected);
    dictation.toggle();
    expect(draft).toBe(expected);
  });
}
