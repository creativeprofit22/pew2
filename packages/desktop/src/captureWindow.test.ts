import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const helper = fileURLToPath(new URL("../scripts/capture-window.test.ps1", import.meta.url));

test.skipIf(process.platform !== "win32")("native capture refuses external windows and captures only its noncredential fixture", () => {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-File", helper], {
    encoding: "utf8", shell: false, windowsHide: true, timeout: 30_000, maxBuffer: 64 * 1024,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("owned noncredential fixture: PNG verified");
  for (const state of ["safe", "empty", "partial", "visible", "race"]) {
    expect(result.stdout).toContain(`external ${state}: refused before native operations`);
  }
}, 35_000);

test("native acceptance does not take failure screenshots", async () => {
  const source = await Bun.file(new URL("../scripts/windows-acceptance.ts", import.meta.url)).text();
  expect(source).not.toContain("capture-window.ps1");
  expect(source).not.toContain("native-failure.png");
});
