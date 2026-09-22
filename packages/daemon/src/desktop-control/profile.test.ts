import { expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDesktopPairing } from "./profile.js";
import { generatePairing } from "../pairing.js";
import vectors from "./profile-vectors.json";

for (const vector of vectors.cases) {
  test(`shared profile acceptance: ${vector.name}`, async () => {
    const home = await mkdtemp(join(tmpdir(), "desktop vector "));
    const record: Record<string, unknown> = { ...vectors.base, ...vector.patch };
    if (vector.repeat) {
      const { field, text, count, suffix } = vector.repeat;
      record[field] = text.repeat(count) + (suffix ?? "");
    }
    if (vector.omit) delete record[vector.omit];
    const value = Object.hasOwn(vector, "root") ? vector.root : record;
    const path = join(home, "pairing.json");
    const bytes = JSON.stringify(value);
    await writeFile(path, bytes);
    if (vector.expected === "ok") {
      const pairing = await readDesktopPairing({ PEW2_HOME: home });
      expect(record.token).toBe(pairing.token);
      expect(record.key).toBe(pairing.key);
      expect(record.claimedBy).toBe(pairing.claimedBy);
    } else {
      await expect(readDesktopPairing({ PEW2_HOME: home })).rejects.toThrow(vector.expected);
    }
    expect(await readFile(path, "utf8")).toBe(bytes);
  });
}

test("wrong home and missing identity never mint replacement files", async () => {
  const home = await mkdtemp(join(tmpdir(), "desktop wrong home "));
  await expect(readDesktopPairing({ PEW2_HOME: home })).rejects.toThrow("missing_profile");
  expect(await readdir(home)).toEqual([]);
  await expect(readDesktopPairing({ PEW2_HOME: "relative" })).rejects.toThrow("missing_profile");
});

test("existing pairing is read-only and rejects relay and environment identity overrides", async () => {
  const home = await mkdtemp(join(tmpdir(), "desktop profile "));
  const pairing = { ...generatePairing(), createdAt: new Date(0).toISOString(), claimedBy: "existing-phone" };
  const path = join(home, "pairing.json");
  const bytes = JSON.stringify(pairing);
  await writeFile(path, bytes);
  expect(await readDesktopPairing({ PEW2_HOME: home })).toEqual(pairing);
  expect(await readFile(path, "utf8")).toBe(bytes);
  await expect(readDesktopPairing({ PEW2_HOME: home, PEW2_TOKEN: "override" })).rejects.toThrow("missing_profile");
  await expect(readDesktopPairing({ PEW2_HOME: home, PEW2_RELAY: "https://example.com" })).rejects.toThrow("relay_configured");
  await writeFile(path, JSON.stringify({ ...pairing, relay: "https://example.com" }));
  await expect(readDesktopPairing({ PEW2_HOME: home })).rejects.toThrow("relay_configured");
  await writeFile(path, JSON.stringify({ ...pairing, key: "x".repeat(64) }));
  await expect(readDesktopPairing({ PEW2_HOME: home })).rejects.toThrow("missing_profile");
});
