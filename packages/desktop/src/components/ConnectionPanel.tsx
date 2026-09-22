import type { ViewState } from "../state.js";
import { displayHome, failureText, statusLabel } from "../state.js";

export function ConnectionPanel({ state, onStart, onStop, onChooseHome, onPair }: {
  state: ViewState; onStart: () => void; onStop: () => void; onChooseHome: () => void; onPair: () => void;
}) {
  const snapshot = state.snapshot;
  const running = Boolean(snapshot?.instance);
  const busy = Boolean(state.pending);
  const stopping = snapshot?.lifecycle === "stopping";
  const ready = snapshot?.lifecycle === "ready";
  const error = state.error ?? (snapshot?.failure ? failureText(snapshot.failure) : null);
  const label = state.pending ?? statusLabel(snapshot);
  return <>
    <section className="connection" aria-labelledby="connection-title">
      <p className="section-label">Local Wi-Fi access</p>
      <h2 id="connection-title" role="status" aria-live="polite" aria-atomic="true">{label}</h2>
      <p className="secondary">{ready
        ? snapshot.status?.authenticatedConnections
          ? "Your phone has authenticated with this daemon. Provider sign-in and model availability are separate checks."
          : "Open pew2 on your phone using the same Wi-Fi. Keep this window open or minimised."
        : "Start only when you need your phone. Opening this window does not start the daemon."}</p>
      <button type="button" className="primary" disabled={busy || !snapshot || (!running && !snapshot.home) || (stopping && !snapshot.forceConfirmation)} onClick={running ? onStop : onStart}>
        {busy ? state.pending : snapshot?.forceConfirmation ? "Review stop options" : stopping ? "Stopping phone access…" : running ? "Stop phone access" : "Start phone access"}
      </button>
      {ready && <button type="button" className="pair-button" disabled={busy} onClick={onPair}>Reveal pairing code</button>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
    <section aria-labelledby="folder-title">
      <h2 id="folder-title" className="small-heading">Your pew2 data folder</h2>
      <p className="path">{snapshot?.home ? displayHome(snapshot.home) : "No usable existing pairing selected"}</p>
      <button type="button" disabled={busy || running} onClick={onChooseHome}>Choose existing folder</button>
      <p className="secondary">Uses your existing pairing and provider settings. No identity is created, rotated or deleted.</p>
    </section>
  </>;
}
