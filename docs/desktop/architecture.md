# Desktop launcher architecture

## Status

The launcher, private control path and local unsigned installer are implemented.
See [verification](verification.md) for tested behaviour and remaining acceptance
gates; implementation is not equivalent to installation or release.

## Dependency direction

Local React UI → typed desktop bridge → Rust controller → anonymous owned
stdin/stdout pipes → existing daemon services. The phone protocol is independent.
No LAN control endpoint and no arbitrary frontend shell/argument/environment API.

The controller owns a suspended Windows process, an unnamed kill-on-close Job
Object, and its stdio handles. Assignment must succeed before resume. A PID by
itself is not ownership. Graceful stop precedes destructive fallback; busy work
requires confirmation referring to the current controller instance.

Control frames are versioned, bounded newline-delimited JSON with request IDs.
Only explicit desktop-owned mode reserves stdout for these frames. Normal logs
are replaced with capped fixed notices on stderr; native code drains/discards raw
stderr rather than trying to scrub arbitrary provider credentials with regexes.
Ordinary CLI behaviour remains unchanged.
Readiness requires both server bind and the owned private handshake. HTTP health
is not ownership, phone authentication, provider authentication or model readiness.

## Modules and private protocol v3

- `App.tsx` composes focused components; `useLauncher.ts` owns subscriptions,
  in-memory pairing visibility, confirmation and polling cleanup.
- `bridge.ts` exposes fixed native actions. `commandLane.ts` bounds/serializes
  at most three commands so background polling cannot collide with Stop.
- `state.ts` rejects stale action epochs and caps secret-free diagnostic history.
- Native `commands.rs` applies the allowlisted surface and moves blocking work
  off the webview thread. `controller.rs` owns exactly one child and its readers.
- `configuration.rs` validates existing profiles and stages nonsecret preference
  writes; `windows_job.rs` owns handles and suspended creation; `control_codec.rs`
  validates child responses independently of the TypeScript codec.
- Daemon `desktop-control/{protocol,transport,profile,runtime}.ts` handles bounded
  frames, mode validation, read-only identity selection and lifecycle integration.

Request fields are exactly `{v: 3, id, command, instance}`. IDs are positive
monotonically increasing safe-integer strings; instance is bounded to 64 ASCII
identifier characters. Hello must be first and cannot repeat. Each subsequent
frame must refer to the same instance. Frames cap at 64 KiB including a bounded
partial buffer, excluding the newline. Malformed UTF-8/JSON, extra fields,
unknown commands, mismatched versions/IDs/instances and oversized data fail closed.

| Command | Reply |
| --- | --- |
| hello, status | status |
| stop-request | stopping status or confirmation-required with coarse busy reason |
| confirm-stop | stopping status, only after a confirmation request for this instance |
| reveal-pairing | validated local link and compact QR rows, or nonfatal `command-error` (`pairing_unavailable`) |
| hide-pairing | hidden acknowledgement; no secret history is retained |

Ordinary responses carry the same v/id/instance plus their type and one typed payload.
Failure replies use allowlisted codes. A terminal transport failure instead sends
exactly `{v: 3, type: "terminal", code}` before cleanup, with no reflected request
ID, instance, malformed bytes or exception text. It is accepted only from the
owned inherited pipe, with exact fields and the same failure-code allowlist;
ordinary responses still require matching IDs/instances. Terminal flushing has a
100ms bound so a broken or undrained output pipe cannot hold cleanup indefinitely.
The native side closes stdin on either a terminal failure or a receive error. Status includes lifecycle, bind address,
port, authenticated local **phone** socket count and coarse busy reason, never session IDs
or credentials. The existing `authenticatedConnections` field is phone-only: it
counts live LAN clients only after a valid hello proof and device admission, with
a nonempty device ID that is not a CLI watcher (`isLocalWatcher` / `CLI_DEVICE_PREFIX`).
CLI watchers keep their authenticated access but do not contribute to this count;
a bearer socket before hello, raw socket presence and `/health` do not establish
phone connectivity. Disconnect removes the phone from the count. No total-client
count is exposed by this private field. The phone protocol is unchanged.
The native side holds a one-frame response queue and continuously
drains both pipes. Pairing objects go only to the reveal call, never the snapshot.

Private v3 retains v2's encoding of QR `modules` as 21–177 square rows of ASCII `0`/`1`, with
valid QR dimensions (21 + 4n). Native decoding validates every row before
converting to the existing boolean matrix for the webview. Even the largest QR
and accepted link fit the unchanged 64 KiB limit; profile token bounds remain
32–1,024 characters. v1/v2 peers are rejected, not guessed or silently accepted.
Both private codecs and their fixtures advance together; this does not change the
phone protocol or the webview payload. Pending private-protocol work must use the
shared TS/Rust version constants and preserve the terminal envelope and compact QR rows.
Local pairing generation, validation or size errors return only
`pairing_unavailable`, without exception text or credentials. Only a reveal
request may receive this command error. It does not close the pipe, change daemon
lifecycle, discard a pending stop confirmation or request forced termination.
Malformed incoming frames and actual channel failures still fail closed.

The native hello receive deadline is 30 seconds and solely owned by the launcher;
there is no competing daemon startup timer. Expiration reports `startup_timeout`
before closing stdin, including when the server import never reaches readiness.
A receive disconnect/EOF reports `channel_broken`, not a timeout. An incompatible
initial request gets terminal `protocol_mismatch`; stderr is never a fallback
protocol. Normal native requests time out after 5 seconds (`channel_broken`).
A failed channel requests EOF cleanup and retains the Job handle until exit or
explicit force approval. Shared daemon shutdown keeps the existing 500ms grace;
a stop taking over 5 seconds exposes a destructive fallback, never an automatic
kill. Force approval must match both the current instance and the current force
mode. Approved forced exits are treated as intentional. Launcher death closes the
Job and can terminate agents abruptly without lossless recovery.

## Configuration and updates

Selection precedence is explicit existing PEW2_HOME, saved launcher selection,
then USERPROFILE/.pew2. An explicit environment override therefore also wins after
a restart. Workspace precedence is PEW2_WORKSPACE, then the Windows user folder;
root or missing work folders are rejected. The selected
existing canonical data directory is shown before Start; only its path may be
saved in launcher preferences. Never create a replacement pairing silently.
A relay-enabled profile is rejected rather than modified. Required provider
configuration/PATH is preserved, with a deliberate workspace default rather than
the installation directory. The development machine's E-drive profile is not a
shipped default. Desktop-owned daemon self-update is disabled; the launcher and
bundled daemon are built together. Standalone CLI update behaviour remains.
Native preferences live in Tauri's per-user config directory as `selection.json`;
only the canonical path is stored. Profile loading refuses missing keys, relay
configuration and malformed files without minting or migrating identity. Desktop
mode also skips the standalone orphan sweep: it must not stop an unrelated daemon.
Native selection/start and daemon startup share the acceptance vectors in
`packages/daemon/src/desktop-control/profile-vectors.json`. Tokens are 32–1,024
ASCII letters/digits/underscore/hyphen; keys are exactly 64 hexadecimal characters.
An absent `claimedBy` is valid; a present value must be a string of at most 256
UTF-16 code units (JavaScript string length, not Rust UTF-8 bytes). Empty claims
remain valid. Invalid selections fail before saving preferences, preserving the
previous selection and leaving the profile bytes untouched. Both validator tests
consume the same boundary, malformed-value and trailing-newline fixtures.

## Packaging and installer policy

The build compiles the checkout, verifies the daemon/launcher version match and
all bundled provider IDs, hashes the sidecar and bundles it as an installed sibling.
The frontend never selects the executable. NSIS is current-user only, unsigned,
without updater/startup registration or prerequisite download. Local build caches
are used; binaries, target output and artifacts are ignored by Git.

Pinned installer source reviewed on 2026-09-21:
[Tauri installer template](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.5/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi),
[helper macros](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.5/crates/tauri-bundler/src/bundle/windows/nsis/utils.nsh),
and [NSIS process result contract](https://github.com/tauri-apps/nsis-tauri-utils/blob/nsis_tauri_utils-v0.5.3/crates/nsis-process/src/lib.rs).
The hook replaces Tauri's generic kill-by-name macro with a refusal while running
(or if inspection fails), reports missing WebView2 without downloading it, and
forces preservation of app data during uninstall. It never stops a CLI service.
These hooks compile into the installer; clean install/update/uninstall still
require the separate acceptance checks in the verification report.

## Dependency selection — 2026-09-21

Registry metadata checked immediately before selection:

| Direct dependency | Exact version | Declared licence |
| --- | --- | --- |
| @tauri-apps/cli | 2.11.5 | Apache-2.0 OR MIT |
| @tauri-apps/api | 2.11.1 | Apache-2.0 OR MIT |
| vite | 8.3.0 | MIT |
| @types/react-dom | 19.1.11 | MIT |
| tauri | 2.11.6 | Apache-2.0 OR MIT |
| tauri-build | 2.6.3 | Apache-2.0 OR MIT |
| tauri-plugin-single-instance | 2.4.5 | Apache-2.0 OR MIT |
| tauri-plugin-dialog | 2.7.3 | Apache-2.0 OR MIT |
| serde | 1.0.229 | MIT OR Apache-2.0 |
| serde_json | 1.0.151 | MIT OR Apache-2.0 |
| windows | 0.62.2 | MIT OR Apache-2.0 |

React and React DOM reuse 19.1.0; TypeScript 5.9.2 and React types 19.1.10
match the existing workspace version lines. No general UI framework or Vite
React plugin is needed. Vite requires Node ^20.19.0 or >=22.12.0; this machine
has 22.20.0. Selected native direct crates require at most Rust 1.82; installed
Rust is 1.97.1 (MSVC). Resolved Windows-target Cargo metadata raises the
minimum to Rust 1.88 (including time, darling and ICU); Cargo.toml records that
minimum. Actual native checking/tests used 1.97.1, not 1.88.
OSV querybatch returned no entries for the ten listed Tauri/Vite/native package
versions. This is not a full dependency audit or a vulnerability-free claim.

Official Windows prerequisites require C++ tools and WebView2. No arbitrary
minimum WebView2 version is asserted; Evergreen runtime availability and the
actual rendered features must be verified. The launcher does not silently
install WebView2. Distribution must document prerequisite installation separately.

## Design references

Patterns only; no external implementation copied. These are pinned references,
not claims about latest upstream HEAD:

- [rclone UI owned lifecycle](https://github.com/rclone/rclone-ui/blob/453cc0c7dbc8cf355058ce92cc577b8002f97985/src-tauri/src/zookeeper.rs#L323-L429): hidden launch and intentional exits, not its broad executable API.
- [OpenLess Job ownership](https://github.com/Open-Less/openless/blob/c8bd7aa295e0fe1c26d7038dc47cac13819c71f3/openless-all/app/src-tauri/src/coding_agent/windows_job.rs#L23-L120): suspended launch, assignment and kill-on-close, not disarming after completion.
- [Tauri CLI 2.11.5](https://github.com/tauri-apps/tauri/releases/tag/tauri-cli-v2.11.5): CLI version is independent of API/crate versions.
- [Tauri capabilities](https://v2.tauri.app/security/capabilities/): narrow custom command permissions and packaged content only.
- [Windows prerequisites](https://v2.tauri.app/start/prerequisites/), re-read 2026-09-21.
- [Windows installer contract](https://v2.tauri.app/distribute/windows-installer/): unsigned, per-user NSIS target.
- [Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects): ownership/cleanup, not a permissions sandbox.
