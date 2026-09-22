import type { Pairing } from "../bridge.js";
import { Dialog } from "./Dialog.js";

export function PairingDialog({ pairing, onHide }: { pairing: Pairing; onHide: () => void }) {
  const size = pairing.modules.length;
  const modules = pairing.modules.flatMap((row, y) => row.flatMap((dark, x) => dark ? [`M${x + 4},${y + 4}h1v1h-1z`] : [])).join("");
  return <Dialog titleId="pairing-title" descriptionId="pairing-help" onCancel={onHide}>
    <h2 id="pairing-title">Pair your phone</h2>
    <p id="pairing-help">Scan from the pew2 phone app on the same Wi-Fi. This code contains access credentials. Do not share it or include it in screenshots.</p>
    <button type="button" autoFocus onClick={onHide}>Hide pairing code</button>
    <svg className="pairing-code" viewBox={`0 0 ${size + 8} ${size + 8}`} role="img" aria-label="Phone pairing QR code" shapeRendering="crispEdges">
      <rect width={size + 8} height={size + 8} fill="#fff" />
      <path d={modules} fill="#000" />
    </svg>
    <label htmlFor="pairing-link">Or select this link to copy it yourself</label>
    <textarea id="pairing-link" readOnly value={pairing.link} rows={4} spellCheck={false} autoComplete="off" />
    <p className="secondary">Nothing is copied automatically. The code is hidden when this window loses focus.</p>
  </Dialog>;
}
