import type { Snapshot } from "./bridge.js";

const failures: Record<string, string> = {
  pairing_unavailable: "The pairing code could not be prepared. Phone access and active work are still running. Try revealing it again.",
  missing_profile: "Choose an existing pew2 data folder with a valid pairing. If you have not set up pew2 yet, complete the CLI setup first.",
  relay_configured: "This profile has remote relay access configured. This launcher supports local Wi-Fi only and has not changed your settings.",
  missing_binary: "The bundled daemon is missing. Reinstall the matching desktop package; a globally installed daemon is not used.",
  port_unavailable: "Already running elsewhere / port unavailable. Another program is using this port. This launcher has not stopped it.",
  protocol_mismatch: "The launcher and bundled daemon do not match. Reinstall them together.",
  invalid_frame: "The private control channel returned an invalid message. Phone access could not be verified.",
  unexpected_exit: "Phone access ended unexpectedly. Check the details below, then start again when ready.",
  channel_broken: "The private connection to the daemon ended. It has been asked to stop; forced termination requires your confirmation.",
  startup_failed: "Phone access could not start. Check the selected data folder and installed desktop package.",
  startup_timeout: "The daemon did not become ready in time. It has been asked to stop.",
  shutdown_timeout: "The daemon has not stopped yet. Forcing it to stop can interrupt active work.",
  ownership_failed: "Windows process ownership could not be established. The launcher refused to run the daemon.",
  workspace_missing: "The default work folder is unavailable. Check your Windows user folder or PEW2_WORKSPACE setting.",
  preferences_failed: "The selected folder could not be saved. Your previous selection has been preserved.",
  preferences_invalid: "Saved launcher preferences could not be read. They were not overwritten.",
  operation_in_progress: "Another action is still finishing. Please wait, then try again.",
  stale_confirmation: "That confirmation belongs to an earlier run. Request Stop again for the current run.",
  confirmation_changed: "The stop conditions changed. Review the current warning before confirming again.",
  not_running: "Phone access is not running. Start it before using this action.",
  already_running: "This launcher already owns a running daemon.",
};
export function failureText(code: unknown): string {
  const key = code instanceof Error ? code.message : code;
  return typeof key === "string" && Object.hasOwn(failures, key)
    ? failures[key]!
    : "The action could not finish. Refresh the status or retry after checking the desktop installation.";
}

export function resolveActionFailure(error: unknown, snapshotFailure?: string | null): unknown {
  const code = error instanceof Error ? error.message : error;
  // Snapshot failures describe the lifecycle and may predate this action.
  // Only the native generic wrapper delegates its reason to the fresh snapshot.
  return code === "daemon_failed" ? snapshotFailure ?? error : error;
}

export interface ViewState {
  snapshot: Snapshot | null;
  epoch: number;
  pending: string | null;
  error: string | null;
  diagnostics: string[];
}
export const initialState: ViewState = { snapshot: null, epoch: 0, pending: null, error: null, diagnostics: [] };
export type ViewEvent =
  | { type: "begin"; action: string; epoch: number }
  | { type: "snapshot"; snapshot: Snapshot; epoch: number }
  | { type: "error"; error: unknown; epoch: number }
  | { type: "end"; epoch: number };

export function transition(state: ViewState, event: ViewEvent): ViewState {
  if (event.type === "begin") {
    if (state.pending || event.epoch <= state.epoch) return state;
    return { ...state, epoch: event.epoch, pending: event.action, error: null };
  }
  if (event.epoch !== state.epoch) return state;
  if (event.type === "end") return { ...state, pending: null };
  if (event.type === "error") {
    const error = failureText(event.error);
    return { ...state, error, diagnostics: [...state.diagnostics, error].slice(-20) };
  }
  const previous = state.snapshot;
  const snapshot = event.snapshot;
  const message = snapshot.failure ? failureText(snapshot.failure) : statusLabel(snapshot);
  const changed = previous?.failure !== snapshot.failure || previous?.lifecycle !== snapshot.lifecycle;
  return { ...state, snapshot, diagnostics: changed ? [...state.diagnostics, message].slice(-20) : state.diagnostics };
}
export function displayHome(path: string): string {
  // Presentation only. Never send this shortened form back for filesystem use.
  if (path.startsWith("\\\\?\\UNC\\")) return `\\\\${path.slice(8)}`;
  return path.startsWith("\\\\?\\") ? path.slice(4) : path;
}
export function statusLabel(snapshot: Snapshot | null): string {
  if (!snapshot) return "Reading launcher settings";
  switch (snapshot.lifecycle) {
    case "starting": return "Starting phone access";
    case "stopping": return "Stopping phone access";
    case "failed": return "Phone access needs attention";
    case "stopped": return "Phone access is stopped";
    case "ready": return snapshot.status?.authenticatedConnections ? "Phone connected" : "Ready for your phone";
  }
}
