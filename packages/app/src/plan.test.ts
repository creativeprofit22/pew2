import { expect, test } from "bun:test";
import { planComplete, readPlan } from "./plan";

test("a valid plan payload folds into typed steps", () => {
  expect(
    readPlan({
      update: {
        sessionUpdate: "plan",
        entries: [
          { content: "Read the config file", priority: "medium", status: "completed" },
          { content: "Patch the parser", priority: "medium", status: "in_progress" },
          { content: "Run the test suite", priority: "medium", status: "pending" },
        ],
      },
    }),
  ).toEqual([
    { content: "Read the config file", status: "completed" },
    { content: "Patch the parser", status: "in_progress" },
    { content: "Run the test suite", status: "pending" },
  ]);
});

test("a reading is only taken from a plan update", () => {
  expect(readPlan({ update: { sessionUpdate: "agent_message_chunk" } })).toBeUndefined();
  expect(readPlan(undefined)).toBeUndefined();
});

test("missing or non-array entries are rejected", () => {
  expect(readPlan({ update: { sessionUpdate: "plan" } })).toBeUndefined();
  expect(readPlan({ update: { sessionUpdate: "plan", entries: "nope" } })).toBeUndefined();
});

test("blank or non-string content entries are dropped", () => {
  expect(
    readPlan({
      update: {
        sessionUpdate: "plan",
        entries: [
          { content: "  ", status: "pending" },
          { content: 42, status: "pending" },
          { content: "Keep this one", status: "pending" },
        ],
      },
    }),
  ).toEqual([{ content: "Keep this one", status: "pending" }]);
});

test("an unknown status defaults to pending", () => {
  expect(
    readPlan({
      update: { sessionUpdate: "plan", entries: [{ content: "Step", status: "weird" }] },
    }),
  ).toEqual([{ content: "Step", status: "pending" }]);
});

test("an empty entries array is a valid result — the plan is cleared", () => {
  expect(readPlan({ update: { sessionUpdate: "plan", entries: [] } })).toEqual([]);
});

test("planComplete is true only when every step is completed", () => {
  expect(planComplete(undefined)).toBe(false);
  expect(planComplete([])).toBe(false);
  expect(
    planComplete([
      { content: "a", status: "completed" },
      { content: "b", status: "completed" },
    ]),
  ).toBe(true);
  expect(
    planComplete([
      { content: "a", status: "completed" },
      { content: "b", status: "pending" },
    ]),
  ).toBe(false);
});
