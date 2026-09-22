import { expect, test } from "bun:test";
import { createCommandLane } from "./commandLane.js";

test("a user stop waits for a poll instead of colliding with the native lock", async () => {
  const lane = createCommandLane();
  let finishPoll: () => void = () => {};
  const gate = new Promise<void>(resolve => { finishPoll = resolve; });
  const order: string[] = [];
  const poll = lane(async () => { order.push("poll"); await gate; order.push("polled"); });
  const stop = lane(() => { order.push("stop"); return Promise.resolve(); });
  await Promise.resolve();
  expect(order).toEqual(["poll"]);
  finishPoll();
  await Promise.all([poll, stop]);
  expect(order).toEqual(["poll", "polled", "stop"]);
});

test("the command lane is bounded and recovers after a failure", async () => {
  const lane = createCommandLane(1);
  const failed = lane(() => Promise.reject(new Error("native failure")));
  await expect(lane(() => Promise.resolve())).rejects.toThrow("operation_in_progress");
  await expect(failed).rejects.toThrow("native failure");
  expect(await lane(() => Promise.resolve("retry"))).toBe("retry");
});
