/** Compiled only for inherited-pipe tests; never bundled into the CLI. */
import { basename } from "node:path";
import { serveDesktop } from "./runtime.js";

if (import.meta.main) {
  if (basename(process.env.PEW2_HOME ?? "").startsWith("desktop-early-exit-")) {
    // A plausible code in stderr must NOT become a protocol result.
    process.stderr.write("startup_timeout\n");
    process.exit(7);
  }
  // Exercise the real runtime/transport while server readiness never arrives.
  await serveDesktop(["serve", "--desktop-control"], () => new Promise(() => {}));
}
