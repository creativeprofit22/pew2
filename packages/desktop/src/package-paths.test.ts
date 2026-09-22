import { describe, expect, test } from "bun:test";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { packagingTarget } from "../scripts/package-paths.js";

const desktop = resolve("packages", "desktop");
const cases = [
  { name: "default", selected: undefined, expected: join(desktop, "src-tauri", "target") },
  { name: "absolute", selected: resolve("build-target"), expected: resolve("build-target") },
  { name: "relative", selected: "trace-relative-target", expected: join(desktop, "src-tauri", "trace-relative-target") },
  { name: "relative with spaces", selected: "target with spaces", expected: join(desktop, "src-tauri", "target with spaces") },
  { name: "absolute with spaces", selected: resolve("build target with spaces"), expected: resolve("build target with spaces") },
];

describe("packaging target paths (no build or packaging side effects)", () => {
  for (const { name, selected, expected } of cases) {
    test(name, () => {
      const inherited = { CARGO_TARGET_DIR: selected, CARGO_HOME: "existing cargo home" };
      const { env, nsisDirectory } = packagingTarget(desktop, inherited);
      expect(env.CARGO_TARGET_DIR).toBe(expected);
      expect(isAbsolute(env.CARGO_TARGET_DIR!)).toBe(true);
      expect(env.CARGO_HOME).toBe(inherited.CARGO_HOME);
      expect(inherited.CARGO_TARGET_DIR).toBe(selected);
      expect(nsisDirectory).toBe(join(expected, "x86_64-pc-windows-msvc", "release", "bundle", "nsis"));
      const installer = join(nsisDirectory, "pew2 phone access_0.9.19_x64-setup.exe");
      expect(resolve(dirname(installer), "../../../..")).toBe(env.CARGO_TARGET_DIR!);
      // windows-acceptance.ts derives the release executable from the report's installer.
      expect(resolve(dirname(installer), "../..", "pew2-desktop.exe"))
        .toBe(join(expected, "x86_64-pc-windows-msvc", "release", "pew2-desktop.exe"));
    });
  }
});
