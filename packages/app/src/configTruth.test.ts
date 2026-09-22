import { expect, test } from "bun:test";
import { rememberConfigs, requestConfigChoice, visibleConfigs, withChoice } from "./configTruth";
import type { ConfigOption } from "./useDaemon";

// Keep the hook's write boundary covered too: pure truth rules cannot prevent
// an action from bypassing them and optimistically overwriting the cache.
test("selector requests never write the acknowledged provider cache", async () => {
  const source = await Bun.file(new URL("./useDaemon.ts", import.meta.url)).text();
  const action = source.slice(source.indexOf("setConfig: ("), source.indexOf("/** Reopen a past conversation"));
  expect(action).not.toContain("setKnownConfigs");
  expect(action).not.toContain("withChoice");
  expect(action).toContain("return requestConfigChoice(post,");
});

const model = (currentValue: string): ConfigOption[] => [
  {
    id: "__acp_model",
    name: "Model",
    type: "select",
    currentValue,
    options: [
      { value: "sonnet", name: "Sonnet" },
      { value: "opus", name: "Opus" },
    ],
  },
];

test("the open conversation's own selectors win over the provider's", () => {
  // While a conversation is running, its list is the only truth about it: the
  // provider record describes the *next* one.
  const shown = visibleConfigs({
    session: model("opus"),
    provider: model("sonnet"),
    inConversation: true,
  });

  expect(shown[0]?.currentValue).toBe("opus");
});

test("an open conversation that has not reported yet names nothing", () => {
  // A resumed conversation comes back at the selectors it was last used with,
  // which need not be the remembered ones — and they arrive a moment after the
  // session does. Showing the provider's in that window is how the pill claimed
  // one model while another was about to answer.
  expect(visibleConfigs({ session: [], provider: model("sonnet"), inConversation: true })).toEqual(
    [],
  );
});

test("with no conversation open, the provider's list is what the next prompt uses", () => {
  const shown = visibleConfigs({ session: [], provider: model("opus"), inConversation: false });

  expect(shown[0]?.currentValue).toBe("opus");
});

test("a provider with nothing known offers nothing rather than a guess", () => {
  expect(visibleConfigs({ session: [], provider: undefined, inConversation: false })).toEqual([]);
});

test("a choice is applied to the remembered list, and only to its own selector", () => {
  const known: ConfigOption[] = [
    ...model("sonnet"),
    { id: "effort", name: "Effort", type: "select", currentValue: "high" },
  ];

  const next = withChoice(known, "__acp_model", "opus");

  expect(next[0]?.currentValue).toBe("opus");
  expect(next[1]?.currentValue).toBe("high");
});

test("offline empty-state choices are refused, leaving the acknowledged model visible", () => {
  const known = { ggcoder: model("sonnet") };
  let attempts = 0;
  const post = (_message: unknown) => { attempts += 1; return false; };

  expect(requestConfigChoice(post, { providerId: "ggcoder" }, "__acp_model", "opus")).toBe(false);
  expect(attempts).toBe(1);
  expect(visibleConfigs({ session: [], provider: known.ggcoder, inConversation: false })[0]?.currentValue)
    .toBe("sonnet");
});

test("sending a live option is not acceptance and cannot change the next conversation", () => {
  const known = { ggcoder: model("sonnet") };
  const session = model("sonnet");
  const sent: unknown[] = [];
  const post = (message: unknown) => { sent.push(message); return true; };

  expect(requestConfigChoice(post, { sessionId: "live", providerId: "ggcoder" }, "__acp_model", "opus"))
    .toBe(true);
  expect(sent).toEqual([{ t: "session.config", sessionId: "live", configId: "__acp_model", value: "opus" }]);
  // A rejection supplies no authoritative config update. Neither view commits
  // the requested value, so there is no speculative state to roll back.
  expect(visibleConfigs({ session, provider: known.ggcoder, inConversation: true })[0]?.currentValue)
    .toBe("sonnet");
  expect(visibleConfigs({ session: [], provider: known.ggcoder, inConversation: false })[0]?.currentValue)
    .toBe("sonnet");
});

test("an accepted provider broadcast, not the outgoing request, commits the empty-state model", () => {
  let known = { ggcoder: model("sonnet") };
  const sent: unknown[] = [];
  expect(requestConfigChoice((message) => { sent.push(message); return true; },
    { providerId: "ggcoder" }, "__acp_model", "opus")).toBe(true);
  expect(sent).toEqual([{ t: "provider.config", providerId: "ggcoder", configId: "__acp_model", value: "opus" }]);
  expect(known.ggcoder[0]?.currentValue).toBe("sonnet");

  known = rememberConfigs(known, "ggcoder", model("opus")) as typeof known;
  expect(visibleConfigs({ session: [], provider: known.ggcoder, inConversation: false })[0]?.currentValue)
    .toBe("opus");
});

test.each(["sonnet", "opus"])("reconnect uses the daemon's %s selection after a lost acknowledgement", (acknowledgedModel) => {
  let known = { ggcoder: model("sonnet") };
  const sent: unknown[] = [];
  let connected = true;
  const post = (message: unknown) => {
    if (!connected) return false;
    sent.push(message);
    return true;
  };
  requestConfigChoice(post, { providerId: "ggcoder" }, "__acp_model", "opus");
  connected = false;
  expect(requestConfigChoice(post, { providerId: "ggcoder" }, "__acp_model", "opus")).toBe(false);
  expect(known.ggcoder[0]?.currentValue).toBe("sonnet");

  // The first write may or may not have reached the daemon. Reconnection's
  // capabilities decide; the app must neither guess nor retry a stale choice.
  connected = true;
  known = rememberConfigs(known, "ggcoder", model(acknowledgedModel)) as typeof known;
  post({ t: "session.start", providerId: "ggcoder", requestId: "first" });
  expect(sent).toHaveLength(2);
  expect(sent[1]).toEqual({ t: "session.start", providerId: "ggcoder", requestId: "first" });
  expect(visibleConfigs({ session: [], provider: known.ggcoder, inConversation: false })[0]?.currentValue)
    .toBe(acknowledgedModel);
});

test("config requests preserve boolean values and require a target", () => {
  const sent: unknown[] = [];
  const post = (message: unknown) => { sent.push(message); return true; };
  expect(requestConfigChoice(post, {}, "fast", true)).toBe(false);
  expect(requestConfigChoice(post, { providerId: "ggcoder" }, "fast", true)).toBe(true);
  expect(sent).toEqual([{ t: "provider.config", providerId: "ggcoder", configId: "fast", value: true }]);
});

test("an empty announcement never erases what is known", () => {
  // Session stubs and older daemons both send empty lists; taking them would
  // blank the picker on an empty screen.
  const known = { "claude-code": model("opus") };

  expect(rememberConfigs(known, "claude-code", [])).toBe(known);
  expect(rememberConfigs(known, undefined, model("sonnet"))).toBe(known);
});
