import { Dialog } from "./Dialog.js";

export function StopDialog({ force, closing, pending, onCancel, onConfirm }: {
  force: boolean; closing: boolean; pending: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  return <Dialog titleId="stop-title" descriptionId="stop-help" onCancel={() => { if (!pending) onCancel(); }}>
    <h2 id="stop-title">{force ? "Force phone access to stop?" : "Stop active work?"}</h2>
    <p id="stop-help">{force
      ? "The daemon is not responding or has not finished stopping. Forced termination can interrupt agent writes and lose unfinished work."
      : "An agent is working, waiting for approval, or opening a session. Stopping now interrupts that work and cancels pending approvals."}</p>
    <p>Only the daemon started by this launcher and its child processes will be stopped.</p>
    <div className="actions">
      <button type="button" autoFocus disabled={pending} onClick={onCancel}>Keep running</button>
      <button type="button" className="danger" disabled={pending} onClick={onConfirm}>
        {pending ? "Stopping…" : force ? "Force stop" : closing ? "Stop work and close" : "Stop active work"}
      </button>
    </div>
  </Dialog>;
}
