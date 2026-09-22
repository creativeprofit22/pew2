import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createCommandLane } from "./commandLane.js";

const serial = createCommandLane();

export type BusyReason = "active_turn" | "pending_approval" | "opening_session";
export interface DaemonStatus {
  lifecycle: "ready" | "stopping";
  bindAddress: "0.0.0.0";
  port: number;
  /** Live LAN phone sockets after hello proof; excludes CLI watchers and pre-hello sockets. */
  authenticatedConnections: number;
  busy: BusyReason | null;
}
export interface Snapshot {
  lifecycle: "stopped" | "starting" | "ready" | "stopping" | "failed";
  instance: string | null;
  home: string | null;
  status: DaemonStatus | null;
  failure: string | null;
  confirmation: BusyReason | null;
  forceConfirmation: boolean;
  networkExposure: "unverified";
}
export interface Pairing { link: string; modules: boolean[][] }

/** No generic invoke, shell, path, PID, or environment surface is exported. */
export const desktop = {
  start: () => serial(() => invoke<Snapshot>("desktop_start")),
  status: () => serial(() => invoke<Snapshot>("desktop_status")),
  stop: () => serial(() => invoke<Snapshot>("desktop_stop")),
  confirmStop: (instance: string, force: boolean) => serial(() => invoke<Snapshot>("desktop_confirm_stop", { instance, force })),
  revealPairing: () => serial(() => invoke<Pairing>("desktop_reveal_pairing")),
  hidePairing: () => serial(() => invoke<void>("desktop_hide_pairing")),
  chooseHome: () => serial(() => invoke<Snapshot>("desktop_choose_home")),
  finishClose: () => serial(() => invoke<void>("desktop_finish_close")),
  onCloseRequested: (callback: () => void) => listen("desktop-close-requested", callback),
};
