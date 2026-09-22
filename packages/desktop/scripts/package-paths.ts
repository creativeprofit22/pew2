import { join, resolve } from "node:path";

/** Cargo metadata runs in src-tauri, so relative overrides belong to that base. */
export function packagingTarget(desktop: string, inherited: NodeJS.ProcessEnv) {
  const target = resolve(desktop, "src-tauri", inherited.CARGO_TARGET_DIR ?? "target");
  const env: NodeJS.ProcessEnv = { ...inherited, CARGO_TARGET_DIR: target };
  return {
    env,
    nsisDirectory: join(target, "x86_64-pc-windows-msvc", "release", "bundle", "nsis"),
  };
}
