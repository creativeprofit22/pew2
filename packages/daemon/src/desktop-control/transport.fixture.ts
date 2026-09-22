import { installPrivateLogging, runTransport } from "./transport.js";
import { CONTROL_VERSION } from "./protocol.js";

if (import.meta.main) {
  installPrivateLogging();
  console.log("fixture-secret-that-must-not-escape");
  await runTransport(process.stdin, process.stdout, {
    handle: request => ({ v: CONTROL_VERSION, id: request.id, instance: request.instance, type: "hidden" }),
    close: reason => { process.stderr.write(`${reason}\n`); },
  });
}
