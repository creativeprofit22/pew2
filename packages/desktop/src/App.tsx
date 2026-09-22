import { ConnectionPanel } from "./components/ConnectionPanel.js";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel.js";
import { PairingDialog } from "./components/PairingDialog.js";
import { StopDialog } from "./components/StopDialog.js";
import { useLauncher } from "./useLauncher.js";

export function App() {
  const launcher = useLauncher();
  return <main className="content-rail">
    <header><span className="wordmark">pew2</span><h1>Phone access</h1></header>
    <ConnectionPanel state={launcher.state}
      onStart={() => { void launcher.start(); }} onStop={() => { void launcher.stop(); }}
      onChooseHome={() => { void launcher.chooseHome(); }} onPair={() => { void launcher.revealPairing(); }} />
    <DiagnosticsPanel state={launcher.state} />
    <footer>Manual control. No start at login. Closing this window also stops its phone access.</footer>
    {launcher.pairing && <PairingDialog pairing={launcher.pairing} onHide={launcher.hidePairing} />}
    {launcher.stopDialog && <StopDialog force={Boolean(launcher.state.snapshot?.forceConfirmation)}
      closing={launcher.closeRequested} pending={Boolean(launcher.state.pending)} onCancel={launcher.cancelStop}
      onConfirm={() => { void launcher.confirmStop(); }} />}
  </main>;
}
