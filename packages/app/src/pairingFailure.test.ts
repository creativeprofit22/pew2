import { expect, spyOn, test } from "bun:test";
import {
  formatPairingFailure,
  pairingFailure,
  pairingRefusalForDevice,
  recordPairingFailure,
  type PairingFailure,
} from "./pairingFailure";

const unreachable =
  "That code did not connect. Check the machine is awake and running pew2 — and if the code is old, run `pew2 pair` there to get the current one.";

const cases: Array<[PairingFailure, string]> = [
  [pairingFailure.link("empty"), "Enter a link."],
  [pairingFailure.link("invalid-url"), "Not a valid link. Should start with ws://"],
  [pairingFailure.link("unsupported-protocol"), "Need a ws:// or wss:// link."],
  [pairingFailure.link("missing-token"), "No token in that link. Run `pew2 pair` again."],
  [pairingFailure.link("short-token"), "Token too short. The link looks cut off."],
  [pairingFailure.link("invalid-token"), "The pairing token is damaged. Scan the code again."],
  [
    pairingFailure.link("missing-key"),
    "That link has no encryption key. Update pew2 and run `pew2 pair`.",
  ],
  [
    pairingFailure.link("invalid-key"),
    "The encryption key in that link is damaged. Scan it again.",
  ],
  [pairingFailure.socket("create-failed"), unreachable],
  [pairingFailure.socket("timed-out"), unreachable],
  [pairingFailure.socket("transport-error"), unreachable],
  [pairingFailure.socket("closed-before-proof"), unreachable],
  [pairingFailure.socket("reconnect-stalled"), "Can't reach your machine."],
  [pairingFailure.handshake("send-failed"), unreachable],
  [
    pairingFailure.handshake("device-refused"),
    "This pairing is already in use. Run `pew2 pair --rotate` on the machine.",
  ],
  [
    pairingFailure.handshake("unpaired"),
    "This device is no longer paired. Run `pew2 pair` on the machine.",
  ],
  [
    pairingFailure.handshake("wire-version"),
    "This app and the machine use different protocol versions. Update the app and pew2 on the machine.",
  ],
  [
    pairingFailure.handshake("wire-version-app-old"),
    "This app uses an older protocol version. Update the app.",
  ],
  [
    pairingFailure.handshake("wire-version-daemon-old"),
    "pew2 on the machine uses an older protocol version. Update pew2 on the machine.",
  ],
  [
    pairingFailure.handshake("key-mismatch"),
    "That code did not work: the machine answered with a key this device cannot read. Run `pew2 pair` on the machine and scan the new code.",
  ],
];

test("every allowlisted failure has exact static output", () => {
  for (const [failure, message] of cases) {
    expect(failure.message).toBe(message);
    expect(formatPairingFailure(failure)).toBe(
      `${message}\nDiagnostic: ${failure.stage}/${failure.reason}`,
    );
  }
});

test("durable connections act only on refusals targeting this device", () => {
  const current = "phone-aaaa";

  for (const code of ["device-refused", "wire-version"] as const) {
    expect(pairingRefusalForDevice({ code, deviceId: current }, current)).toEqual(
      pairingFailure.handshake(code),
    );
    expect(pairingRefusalForDevice({ code, deviceId: "phone-other" }, current)).toBeUndefined();
    expect(pairingRefusalForDevice({ code }, current)).toBeUndefined();
  }

  expect(
    pairingRefusalForDevice({ code: "wire-version", deviceId: current, update: "app" }, current),
  ).toEqual(pairingFailure.handshake("wire-version-app-old"));
  expect(
    pairingRefusalForDevice({ code: "wire-version", deviceId: current, update: "daemon" }, current),
  ).toEqual(pairingFailure.handshake("wire-version-daemon-old"));
  // The target is untrusted network input. Unknown and absent values use static neutral copy.
  for (const update of [undefined, "desktop", null]) {
    expect(
      pairingRefusalForDevice({ code: "wire-version", deviceId: current, update }, current),
    ).toEqual(pairingFailure.handshake("wire-version"));
  }

  // LAN sends this on the same socket, so older daemons need no address.
  expect(pairingRefusalForDevice({ code: "unpaired" }, current)).toEqual(
    pairingFailure.handshake("unpaired"),
  );
});

test("formatting and recording cannot carry pairing or transport secrets", () => {
  const secrets = [
    "token-secret-1234567890",
    "key-secret-0987654321",
    "private.example.test",
    "?pairing=token-secret-1234567890",
    "#k=key-secret-0987654321",
    "ws://private.example.test/connect?pairing=token-secret-1234567890#k=key-secret-0987654321",
  ];
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    for (const [failure] of cases) recordPairingFailure(failure);
    const output = [
      ...cases.map(([failure]) => formatPairingFailure(failure)),
      ...warn.mock.calls.flat().map(String),
    ].join("\n");
    for (const secret of secrets) expect(output).not.toContain(secret);
    for (const [failure] of cases) {
      expect(warn).toHaveBeenCalledWith(failure.stage, failure.reason);
    }
  } finally {
    warn.mockRestore();
  }
});
