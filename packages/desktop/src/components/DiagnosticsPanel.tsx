import type { ViewState } from "../state.js";

export function DiagnosticsPanel({ state }: { state: ViewState }) {
  return <details>
    <summary>Connection details and help</summary>
    <dl>
      <dt>Listening address</dt><dd>{state.snapshot?.status ? `${state.snapshot.status.bindAddress}:${state.snapshot.status.port}` : "Not listening through this launcher"}</dd>
      <dt>Authenticated phone connections</dt><dd>{state.snapshot?.status?.authenticatedConnections ?? 0}</dd>
      <dt>Network and firewall exposure</dt><dd>Unverified</dd>
    </dl>
    <p>Listening on all interfaces does not restrict access to a Private network. Check your Wi-Fi and Windows Private-network firewall rules before connecting. This launcher does not change them.</p>
    <p>If the port is unavailable, another daemon may already be running. It has not been stopped or adopted by this launcher.</p>
    <p>If the launcher crashes, Windows can terminate its agent processes abruptly. Keep important work saved.</p>
    <h3>Recent launcher events</h3>
    {state.diagnostics.length ? <ol className="diagnostics">{state.diagnostics.map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}</ol> : <p>No launcher events yet.</p>}
    <p className="secondary">At most 20 events are kept in memory. Raw provider output and pairing credentials are not included.</p>
  </details>;
}
