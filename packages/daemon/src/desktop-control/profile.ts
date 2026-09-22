import { open, realpath } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import type { Pairing } from "../pairing.js";
import { ControlError } from "./protocol.js";

/** Startup policy: refuse relay-enabled profiles without changing them. */
export async function readDesktopPairing(env: NodeJS.ProcessEnv = process.env): Promise<Pairing> {
  return readProfile(env, true);
}

/**
 * Live revocation must not depend on startup LAN policy: a CLI can configure a
 * relay before rotating. Read only validated identity, never return the relay,
 * and never mint, migrate or repair the stored profile.
 */
export async function readDesktopIdentity(env: NodeJS.ProcessEnv = process.env): Promise<Pairing> {
  return readProfile(env, false);
}

async function readProfile(env: NodeJS.ProcessEnv, startup: boolean): Promise<Pairing> {
  if (!env.PEW2_HOME || !isAbsolute(env.PEW2_HOME) || env.PEW2_TOKEN) throw new ControlError("missing_profile");
  if (startup && env.PEW2_RELAY) throw new ControlError("relay_configured");
  let value: unknown;
  try {
    const home = await realpath(env.PEW2_HOME);
    const file = await open(join(home, "pairing.json"), "r");
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 16 * 1024) throw new Error("invalid profile");
      const bytes = Buffer.alloc(16 * 1024 + 1);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      if (bytesRead > 16 * 1024) throw new Error("invalid profile");
      value = JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"));
    } finally { await file.close(); }
  } catch { throw new ControlError("missing_profile"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ControlError("missing_profile");
  const record = value as Record<string, unknown>;
  if (startup && record.relay !== undefined && record.relay !== "") throw new ControlError("relay_configured");
  if (typeof record.token !== "string" || record.token.length < 32 || record.token.length > 1024 ||
      !/^[a-zA-Z0-9_-]+$/.test(record.token) || typeof record.key !== "string" || !/^[a-fA-F0-9]{64}$/.test(record.key) ||
      (record.claimedBy !== undefined && (typeof record.claimedBy !== "string" || record.claimedBy.length > 256))) {
    throw new ControlError("missing_profile");
  }
  return {
    token: record.token,
    key: record.key,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date(0).toISOString(),
    ...(typeof record.claimedBy === "string" ? { claimedBy: record.claimedBy } : {}),
  };
}
