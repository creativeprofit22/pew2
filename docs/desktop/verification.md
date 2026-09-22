# Desktop verification evidence

## 2026-09-21 — prerequisite inspection

- **Runtime:** Bun 1.3.14, Node 22.20.0, npm 10.9.3, Rust 1.97.1,
  Cargo 1.97.1, stable x86_64-pc-windows-msvc toolchain.
- **Runtime:** Visual Studio 2022 Build Tools with x64 C++ component detected.
- **Runtime:** Host is Windows 10 Pro x64, build 19045 — not the Windows 11
  acceptance target. Windows 11 native acceptance remains unverified.
- **Runtime:** Existing machine-specific E-drive pew2 data folder exists.
  No pairing content read or daemon restarted during prerequisite inspection.
- **Runtime:** OSV returned no entries for ten selected direct dependency versions;
  transitive dependency audit and resolved lockfile validation remain outstanding.
- **Permission:** User approved the exact dependency list and required transitive
  downloads, with caches/artifacts on E:, and integration preserving existing edits.
- **Code:** Existing daemon shutdown calls watcher/relay cleanup and closeAll;
  desktop IPC must reuse this path and retain the existing signal semantics.

## Implementation checks through step 6 — 2026-09-21

- **Runtime:** 18 Bun daemon-control tests passed. Real child processes exercised
  startup/handshake, bound-port reporting, on-demand pairing, idle graceful stop,
  parent pipe EOF, absent profile without identity creation, and collision with
  an independent listener that continued responding afterward.
- **Runtime:** Root daemon TypeScript checking and scoped daemon/control lint passed.
- **Runtime:** Five Rust tests passed on Windows 10, including a compiled checkout
  daemon launched suspended into a Job, private handshake, graceful exit, Job-close
  termination without prior IPC stop/EOF, duplicate Start refusal, stale-instance
  confirmation refusal and refusal to upgrade graceful approval to forced killing.
- **Runtime:** Rust formatting applied; Clippy passed with `-D warnings`.
- **Runtime:** Four desktop pure-state tests passed; desktop build/typecheck and
  scoped lint passed. Production assets: JS 196.97 kB (62.90 kB gzip), CSS 3.78 kB
  (1.30 kB gzip). These sizes are not startup or idle-resource measurements.
- **Runtime:** Actual Tauri/WebView2 window rendered the stopped state using the
  explicitly supplied existing E-drive profile. Opening it did not start a daemon.
  It closed normally with exit 0. No pairing was revealed or existing daemon stopped.
- **Runtime:** Native window captures reviewed at 560×700 and a 336×760 outer window
  (approximately 320px content width). Initial post-resize capture preceded repaint;
  a settled capture verified reflow. Review removed a redundant divider and shortened
  the displayed Win32 extended path prefix without changing its filesystem value.
  Secret-free captures are local under `E:\DevCaches\pew2-desktop-native`, not Git.
- **Runtime:** WebView2 153.0.4234.48 detected. Network categories include both
  Private and Public. Firewall profiles report enabled, but applicable inbound
  rules/exposure have not been verified. No network/firewall changes were made.
- **Runtime:** Measured CSS contrast ratios: primary text/canvas 16.88:1,
  secondary text/canvas 8.16:1, CTA text/accent 6.05:1, control border/surface
  4.75:1, error text/surface 10.12:1, focus/canvas 8.31:1.
- **Code:** Native preference writes stage and sync before replacement. Malformed
  existing preferences are not overwritten. Daemon profile loading is read-only.
- **Code:** IPC frames cap at 64 KiB, native response queue at one, UI diagnostics
  at 20 entries. Arbitrary daemon/provider output is discarded, not exposed through
  a regex-based redaction promise. Forced termination requires current instance AND
  matching force approval, so a graceful-stop confirmation cannot silently upgrade.

## Current verification through step 8 — 2026-09-21

- **Runtime:** `npm test`: **1,249 pass, 12 existing platform skips, zero failures**
  across 122 files. No new test was skipped. Root typecheck and lint pass.
  The Windows test helper now explicitly isolates PEW2_HOME/USERPROFILE, rather
  than relying on HOME, which Windows homedir does not use. Ten existing end-to-end
  failures reproduced before that fix; all ten now pass.
- **Runtime:** **19 daemon-control + 6 desktop pure tests** pass, including a real
  authenticated offline echo session blocked on approval. Stop requests confirmation;
  omitting confirmation leaves the work alive; confirmation runs shared shutdown.
- **Runtime:** **7 Rust tests** pass, including packaged-only navigation policy. Formatting check and Clippy `-D warnings` pass.
  Tests also preserve prior preferences/unowned staging files on a failed selection,
  and verify explicitly approved forced termination is intentional, not an unexpected
  exit or a reason to reopen the confirmation dialog. That last assertion was run
  failing before the controller fix and passed afterward.
- **Runtime:** Native release acceptance passes using the bundled compiled daemon
  and isolated profiles/ephemeral ports. Verified opening does not start the daemon,
  three Start/Stop cycles, a second instance restoring/focusing the minimised window,
  authenticated local transport and custom echo-provider discovery, busy close cancel,
  busy close confirm, restart preserving the test pairing, and parent crash terminating
  the daemon and two owned Bun agent descendants. An independent listener survives.
- **Runtime:** Start, Stop, Keep running and Stop work and close pass using WebView
  keyboard Enter events. Windows-wide synthetic key delivery was intermittent even
  with foreground/focus checks; UI Automation invocation passed the same flow.
  The repeatable harness now drives browser keyboard events through a test-only
  loopback debugger, checks that its listener belongs to the test launcher, and
  uses isolated WebView data on E:. Debugging is not enabled by the shipped app.
  Two consecutive full runs passed. Physical keyboard/Tab flow and Narrator remain
  unverified; these results are not an accessibility-conformance assessment.
- **Runtime:** A polling-versus-Stop collision was reproduced in the real window.
  A three-command bounded bridge queue and avoiding redundant hide requests fixed it;
  native duplicate Start remains rejected. Native acceptance was rerun after the fix.
- **Runtime:** The acceptance harness initially changed USERPROFILE for the native
  WebView host; that was removed. Its daemon profile/workspace remain isolated via
  explicit PEW2_HOME/PEW2_WORKSPACE. A malformed test manifest also initially fell
  back to bundled echo; it now has the required description and checks the discovered
  provider name before any offline prompt. No billed model call occurred.

### Current artifact

Unsigned per-user NSIS, version **0.9.19**, built with the Cargo lockfile and
explicit `--no-sign`. NSIS 3.11 and nsis-tauri-utils 0.5.3 downloads were separately
authorized. Matching compiled daemon version and all **12 provider IDs** verified.

- Installer: `E:\DevCaches\pew2-desktop-target\x86_64-pc-windows-msvc\release\bundle\nsis\pew2 phone access_0.9.19_x64-setup.exe`
- Installer SHA-256: `137a252c3dd32858b0df60347ab98dc9409ce3e2f0ddc25b471c15ac8b53d0d0`
- Bundled daemon SHA-256: `ab981db6a00202599676e84a10a5967431b4b1185add1f550e76f63de60c800c`
- Frontend: JS 197.33 kB (63.00 kB gzip), CSS 3.78 kB (1.30 kB gzip).
- Installer compiled successfully; **local install, uninstall, reinstall and
  same-version replacement pass on Windows 10**. The installed executable and
  sidecar were exercised from `E:\tools\pew2 phone access` (a path with spaces).
  Generated artifact reports are ignored, not committed.

### Resource sample, not a performance guarantee

Automated release run on this Windows 10 host, with an isolated fresh WebView
profile and the test-only loopback debugger enabled:

| Measurement | Observed |
| --- | --- |
| Stopped window observed | 4,685 ms |
| Ready status observed after Start | 626 ms |
| Process counts after three stopped cycles | 7, 7, 7 (launcher + WebView processes) |
| Ready process-tree summed working set | 440,897,536 bytes (~420 MiB) |
| Process-tree CPU time during idle sample | 0.015625 seconds |
| Idle sample wall duration | 3.533 seconds |
| Owned daemon/agent processes absent after crash | 3 |

Timing includes UI Automation and fresh WebView-profile overhead. Prior runs with
a warm standard WebView profile observed the stopped window around 1.2–1.3 seconds;
the different setup means those are not a before/after performance comparison. Summed working sets count shared pages
more than once and are not private RAM. A three-second sample and three cycles do
not establish long-term memory stability or a cold-start benchmark.

### Dependency/security evidence

- OSV queried all **275 registry packages in the resolved Windows Cargo graph**.
  Five entries are unmaintained-package advisories: unic-char-property 0.9.0
  (RUSTSEC-2025-0081), unic-char-range 0.9.0 (0075), unic-common 0.9.0 (0080),
  unic-ucd-ident 0.9.0 (0100), unic-ucd-version 0.9.0 (0098). The advisory details
  were fetched; they report maintenance status, not a demonstrated launcher exploit.
- `bun audit --json` reports advisories in existing workspace dependency groups:
  xmldom, brace-expansion, image-size, js-yaml, nanoid, postcss, sharp, undici and
  uuid. This is **not a clean repository audit**; unrelated dependency upgrades were
  not made. The new Vite graph resolves PostCSS 8.5.28 and nanoid 3.3.19, outside
  the reported affected ranges. Whole-workspace reachability was not fully audited.
- Cargo licence metadata includes permissive licences and MPL-2.0. No unknown
  declaration appeared in that query. Metadata is not a completed third-party
  notices/source-offer review; that remains a public-distribution gate.
- Code review confirms local assets/CSP, restricted command permissions, fixed
  executable/arguments, stdio-only handle inheritance, Job assignment before resume,
  bounded framing, no general shell/filesystem frontend plugin, and no desktop-owned
  updater. This is evidence of specific controls, not security certification.

## Local installation and phone acceptance — step 9

User separately authorized installation, removal and reinstallation with isolated
profiles, preserving the existing daemon, real pairing and firewall settings.

- **Runtime:** Per-user installation at `E:\tools\pew2 phone access` succeeds.
  Desktop and Start Menu shortcuts exist; no run-at-login entry was registered.
  Windows Authenticode reports `NotSigned`, as expected.
- **Runtime:** Installed lifecycle acceptance passes: repeated Start/Stop,
  single-instance restore/focus, offline echo approval, close cancel/confirm,
  owned descendant crash cleanup, and preserved test pairing. Browser keyboard
  checks use the isolated test-only debugger; physical Tab/Narrator remain open.
- **Runtime:** The installed main executable differs from the build output by
  exactly Tauri's three-byte `UNK` → `NSS` bundle-type marker. This was checked
  against tauri-utils 2.9.3 and every other byte was required to match. The installed
  sidecar hash matches exactly; no general integrity exception was introduced.
- **Runtime:** The native folder picker saved a test profile. Uninstall removed
  application executables/registration while preserving that selection and the
  test pairing byte-for-byte. Reinstall restored the selection in the actual UI
  without PEW2_HOME in the environment.
- **Runtime:** Replacement while the launcher was open refused with exit 2 and
  left it running. Same-version replacement after a graceful close passed and
  preserved the selected folder and real pairing. Future-version upgrades and
  the interactive data-removal checkbox on a clean system remain untested.
- **Runtime:** The native picker then selected `E:\tools\pew2-data` for normal use.
  The launcher stayed stopped. Read-only hash comparisons confirm the real
  `pairing.json` was unchanged throughout. At this stage the original daemon still
  owned 8787; the separately authorized handoff is recorded below.
  No real phone prompt or pairing rotation occurred.
- **Runtime:** Phone and PC are on the same Private-network Wi-Fi subnet and
  adb reverse is empty. `netsh` reports BlockInbound/AllowOutbound policies, but
  detailed firewall application/port-rule inspection was denied to this session.
  Empty results from the denied queries are **not evidence of absent rules**.

### Verification-loop correction

The lengthy session was repeated verification and troubleshooting, not a hung
installer. At the final check, no launcher or installer process was stuck. The
leftover loopback Vite test server was stopped; the independent daemon was left
untouched. Further automated repetitions were stopped. The installed application
was closed cleanly after verification and remains available through its shortcuts.

### Authorized firewall inspection and real-phone handoff — 19:03–19:15 UTC

- User separately authorized a **read-only administrator firewall inspection**.
  The script has a 45-second job deadline and performs no policy mutations.
  It examined 1,091 enabled inbound rules. After excluding rules bound to other
  Windows app-package identities, the installed daemon has a matching **Private
  Allow** rule and **Public Block** rule. Firewall profiles are enabled with
  default inbound blocking. No rule was created, removed or changed by this check.
  The Private rule allows any remote address, not only LocalSubnet; no internet
  reachability or router-isolation guarantee is inferred. The UI's conservative
  exposure label remains unverified because the app does not elevate to inspect
  live policy; this report is a dated, operator-authorized snapshot.
- User then authorized switching the idle legacy daemon and confirmed no queued
  phone prompts. An authenticated local watcher reported **zero active sessions**;
  the check was repeated immediately before handoff. There were no child agents.
  The original process's creation time, open process handle and port ownership were
  checked before Windows termination. This was an explicitly approved one-off idle
  legacy stop, **not a claim of graceful Windows signal shutdown**. No service or
  startup configuration was changed.
- The installed launcher was already open and stopped with the saved E-drive
  profile selected. Its Start button launched `E:\tools\pew2 phone access\pew2-daemon.exe`;
  the listener's parent PID was the launcher, not the former server.
- **Runtime phone evidence:** the phone app was brought to the foreground without
  resetting app data, changing pairing or submitting a prompt. The native window
  reported **Phone connected**. An established TCP connection to the owned daemon
  used the phone's current Wi-Fi address (matching `adb shell ip -4 route`), and
  `adb reverse --list` was empty. A memory-only phone UI inspection found a Connected
  label and **GG Coder**. Raw phone UI text, pairing URLs and screenshots were not
  saved. This establishes authenticated Wi-Fi transport and provider discovery,
  not model authentication, entitlement or a completed model response.
- A final byte-hash comparison matched the real pairing file to its pre-install
  baseline. The installed launcher and its owned daemon were left running for use.
  Keep the window open or minimised; Stop/close ends its phone access.

## Typed startup/control failures — 2026-09-22

- **Reproduced:** An incompatible request sent through real inherited pipes
  previously exited with no stdout frame (the new regression failed parsing EOF).
- **Implemented:** Private TS/Rust codecs advance together to v3. Terminal
  transport errors carry only version/type/allowlisted code, with a 100ms flush
  bound and no reflected request bytes. Compact QR rows and ordinary strict
  correlation remain unchanged. Stderr is still drained/discarded, never parsed.
- **Deadline ownership:** Native alone owns the 30-second hello receive deadline;
  it reports `startup_timeout` and closes stdin. The competing daemon timer is
  removed. EOF/disconnection remains `channel_broken`; an actual incompatible
  initial request produces `protocol_mismatch`. No automatic restart or kill.
- **Runtime:** `bun test ./packages/daemon/src/desktop-control` — **32 passed**.
  Includes inherited-pipe mismatch, malformed-input non-disclosure, and bounded
  terminal flushing on stalled/broken pipes. Root TypeScript check and scoped
  ESLint passed.
- **Runtime:** `cargo test --offline --locked --manifest-path
  packages/desktop/src-tauri/Cargo.toml --lib` — **13 passed**, using the README's
  isolated cache/temp environment, `PEW2_PORT=0`, and newly compiled daemon and
  startup-fixture executables. The real runtime/transport fixture never becomes
  ready (test-injected **250ms** deadline), rejects an incompatible initial
  control version, or exits early with misleading `startup_timeout` stderr.
  Native snapshots preserve the three distinct results after reaping. Tests
  observe actual process exit within a bounded cleanup window **before** releasing
  the Job, rather than passing because test teardown killed an orphan.
- **Runtime:** Native Clippy (`--lib -- -D warnings`) and formatting checks for the
  changed Rust modules passed. Test binaries were built outside the repository;
  no installer or live daemon was replaced/restarted. UI copy/bridge/hook paths
  were inspected but no fresh interactive launcher or installer acceptance is
  claimed for v3; launcher and bundled daemon must be rebuilt together to ship it.

## Credential-safe native capture gate — 2026-09-22

- **Runtime reproduction before editing:** Executed the original helper's actual
  label predicate against injected empty and partial accessibility-name arrays.
  Both permitted the capture branch. A noncredential WinForms fixture changed to
  the pairing label after the check; the old decision still permitted capture.
  A complete visible-pairing label was refused. The sink was deliberately not
  called: this establishes a missing gate, **not an observed credential leak** or
  proof that WebView2 returns incomplete trees on this host.
- **Implemented:** External PID capture is unconditionally refused before native
  operations. Automatic acceptance failure screenshots were removed. The only
  positive path creates and captures a fixed, helper-owned noncredential fixture;
  it checks window ownership, disposes native resources and restores focus.
  No live launcher, profile, pairing or daemon was inspected or operated on.
- **Runtime:** `bun test ./packages/desktop/src` — **14 passed**, including the new
  native helper check. It retains the old predicate as a regression explanation,
  exercises external-window refusal with safe/empty/partial/visible/race fixtures,
  asserts denial precedes native setup (and therefore `PrintWindow`/Save), and
  verifies a normal fixture PNG's dimensions. Test-owned temporary output is
  removed. The race is a deterministic injected state change, not a timed attempt
  to reveal real credentials. Since external windows are never inspected or
  captured now, there is no external check-to-capture interval to race.
- **Runtime:** Desktop TypeScript check and scoped ESLint passed. The helper test
  also passed directly under Windows PowerShell. No installs were required.
- **Guarantee/limit:** `capture-window.ps1 -Fixture Stopped -OutputPath <new.png>`
  verifies native capture plumbing only; its pixels explicitly identify it as a
  fixture. It is **not** a screenshot of the production launcher. Historical layout
  captures above do not certify the removed label guard. No full native lifecycle,
  installer rebuild, Windows 11 or live-credential capture was run for this fix.

## Remaining acceptance / external gates

- Windows 11 x64 and a clean user/VM without Bun or the repository.
- Clean-system installer/missing-WebView2 UX, future-version upgrades and the
  interactive uninstall data-removal option.
- Full keyboard Tab flow, Narrator, 200% scaling, forced-colour checks and the remaining
  per-criterion accessibility review. No WCAG/ADA conformance is claimed.
- Firewall/network policy can change after the dated manual inspection above;
  the app deliberately does not cache a permanent security assurance.
- Final third-party licence/notice review before any public distribution.

Implementation, local installation and the real-phone handoff are verified as
scoped above. External release-acceptance gates remain open; Windows 10 evidence
is not Windows 11 acceptance. No billed-model verification, signing, commit or
public release is claimed. Do not store pairing links or screenshots containing
credentials in this report.

## Windows 11 installer qualification — blocked, 2026-09-22

**Ship decision: VERIFY-BEFORE-SHIP. Severity: Medium. Lane: Build/runtime.
Classification: UNTESTED-BLAST-RADIUS.** Scope: unsigned per-user Windows 11
x64 installer. Missing acceptance evidence is not a demonstrated Windows 11 defect.
The operator approved appending this blocker; no provisioning, download, installation
or destructive fixture action was authorized in this qualification session.

### Read-only observations and candidate identity

- **Runtime (host inspection, not target acceptance):** Windows 10 Pro, version
  `10.0.19045`, build `19045`, 64-bit. Registered machine WebView2 version:
  `153.0.4234.48`. No Windows 11 guest OS/WebView version was observed.
- **Runtime:** `Get-VM`, `VBoxManage.exe` and `vmrun.exe` were not available in
  this session. Tool-catalog discovery exposed no remote Windows testing facility.
  This does not establish that no VM exists elsewhere; no approved disposable
  Windows 11 environment is currently available to this session.
- **Source snapshot:** HEAD `2bad7a415f2a108f31ba2bef30965f295000bfd0`, with
  modified tracked files and untracked desktop/control/docs trees. HEAD alone
  does not identify the candidate's source. The build reports contain no exact
  source-tree digest; final corrected-source provenance remains unverified.
- **Runtime (file metadata/hash checks):** Candidate installer version `0.9.19`,
  28,801,037 bytes, Authenticode `NotSigned`. SHA-256 matches the local installer
  build report dated `2026-09-22T06:19:37.158Z`. That report explicitly records
  `installed: false` and `windows11Accepted: false`. No installer was executed.
- **Runtime:** Adjacent release sidecar and packaging-input sidecar have identical
  SHA-256, matching the daemon build report dated `2026-09-22T06:16:18.045Z`.
  That report records daemon `0.9.19`, Bun `1.3.14`, and 12 provider IDs.
  The sidecar's PE ProductVersion is `1.3.14` (the compiler runtime metadata);
  it is not independent proof of daemon application version. No daemon metadata
  command or provider inventory was rerun in this qualification session.

Candidate files under
`E:\DevCaches\pew2-desktop-target\x86_64-pc-windows-msvc\release`:

| File | Observed SHA-256 |
| --- | --- |
| `bundle\nsis\pew2 phone access_0.9.19_x64-setup.exe` | `b40a586678f662268560affc084189884757bd93fe5a44701209eff2ede815c0` |
| `pew2-desktop.exe` (build output, not installed payload) | `670ac5e0878acc318890a4b4839d473b860f29018d63acd34ebe54f7818a48f5` |
| `pew2-daemon.exe` | `583ba0712e2ed94646948c90e2baa068490c563c30cd92067bbdf96522aaf702` |

The packaging-input sidecar is
`packages/desktop/src-tauri/binaries/pew2-daemon-x86_64-pc-windows-msvc.exe`.
The hashes above identify observed files only, not proof of installer payload
extraction or corrected-source completeness. They differ from the September 21
artifact above; historical installed-runtime results do not qualify this candidate.
An approved target run must hash the transferred installer and installed sidecar,
record the installed launcher hash, and verify application version/provider identity.
If comparing the installed launcher to build output, allow only the exact documented
Tauri `UNK` → `NSS` marker change, never a general integrity waiver.

### Required target evidence — all NOT RUN in this session

| Check | Required evidence before passing |
| --- | --- |
| Corrected candidate and clean target | Confirm queued fixes complete; freeze exact source snapshot and artifact hashes; record Windows 11 edition/build/x64 and WebView2 version; verify no installed Bun or checkout dependency |
| Current-user installation | Install as the disposable standard user; record destination, registration and shortcuts; no unintended elevation or machine-wide installation |
| First launch and lifecycle | Opening remains stopped with no daemon; repeated Start/Stop succeeds; deliberately isolated failure is visible and retry succeeds after its cause is removed |
| Selection and spaces | Use fixture profile/workspace/install paths containing spaces; select via picker and reopen without PEW2_HOME to prove saved-folder persistence |
| Single instance | Second launch exits/restores the first window without a second daemon |
| System changes | Compare readable before/after startup entries, scheduled tasks, services and firewall policy/rules; denied inspection is unavailable evidence, not absence of changes |
| Offline busy/approval | Standalone echo fixture plus dedicated test client, fixture-only identity; exercise busy/approval stop or close, cancellation preserving work, and explicit confirmation ending owned work |
| Missing WebView2 | Safely prepared disposable image only; observe prerequisite explanation/refusal, no silent download or partial usable install; do not remove the host's runtime |
| Running replacement | Installer refuses while launcher runs, leaves it and fixture data intact, and performs no forced termination |
| Closed replacement / repair | Close gracefully, replace same version, verify installed identity and preserved fixture pairing/preferences; label this repair, not upgrade |
| True version upgrade | Separately identified older and newer version artifacts, both hashed; verify version transition and preserved fixture state. No distinct version pair was qualified here |
| Uninstall / reinstall | Removal clears app files/registration/shortcuts but preserves byte hashes of fixture pairing, provider preferences and launcher selection; reinstall restores selection |
| Interactive data-removal option | Exercise the checkbox with approved disposable fixtures and verify the hook still preserves profile/preferences as documented |

### Bun-free offline test preparation and safety limits

**Code:** The existing developer acceptance script runs under Bun, imports checkout
helpers and registers echo with `process.execPath` plus the source `.ts` file.
Its descendant assertion also expects `bun.exe`; running it unchanged is not a
clean-runtime test. The existing echo fixture supplies offline streaming (`tools`)
and pending approval (`permission`) without a model call.

Before target qualification, prepare standalone echo and test-client utilities on
the build machine, record their source identity and hashes, and smoke-test them.
Point a fixture-only provider manifest at the compiled echo executable. Transfer
only the reviewed installer/utilities and disposable fixtures, not Bun, checkout
or real pairing. Utility preparation and Bun-free execution were not performed
in this blocked session; installing Bun in the VM would invalidate the requirement.

Obtain separate approval for the concrete VM/image, OS/tool downloads, installation,
costs and destructive fixture actions before proceeding. Use fresh disposable
credentials; never reset the real phone, copy its pairing, call models, alter the
live daemon, or weaken Windows security policies to run the unsigned build.
A policy refusal is a blocker to record, not a reason to bypass protection.

No Windows 11 pass/fail execution evidence exists from this session. Only the
read-only host and artifact checks above passed. The missing target, exact corrected
source provenance, standalone test utilities and unexecuted acceptance matrix keep
the release gate blocked and task `3ad9c7c5` incomplete. Nothing was installed,
signed, committed or published.

## Native keyboard and accessibility acceptance — blocked, 2026-09-22

**Ship decision: VERIFY-BEFORE-SHIP. Severity: Medium. Lane: Parity + Regression.
Classification: UNTESTED-BLAST-RADIUS.** Scope: the Windows 11 control window and
pairing, stop and recovery dialogs. The operator authorized this secret-free
blocked matrix, not a completion claim. Task `504f1aa2` remains open.

### Evidence and limits

- **Current read-only host observation:** `Get-CimInstance Win32_OperatingSystem`
  returned Microsoft Windows 10 Pro, version `10.0.19045`, build `19045`, 64-bit.
  This is not Windows 11 acceptance. No Windows 11 target was available to this
  session; tool-catalog lookup exposed no remote native-interaction capability.
- **Source inspected:** `App.tsx`, `useLauncher.ts`, `state.ts`, `styles.css`,
  `ConnectionPanel.tsx`, `Dialog.tsx`, `PairingDialog.tsx`, `StopDialog.tsx`,
  `DiagnosticsPanel.tsx`; native `lib.rs`, `commands.rs`, `controller.rs`;
  `native-ui.ps1`, `native-cdp.ts`, `windows-acceptance.ts`; `DESIGN.md` and this
  report's existing evidence/gates. Source review is not a native-flow result.
- **Automation limitation confirmed in source:** `native-cdp.ts` calls
  `button.focus()` before debugger Enter events. `native-ui.ps1` similarly calls
  `SetFocus()` before injected Enter; other actions use UI Automation invocation.
  Neither establishes natural Tab order, physical keyboard routing, focus return
  after asynchronous actions, or Narrator output. The acceptance script itself
  records `physicalKeyboardTabFlowUnverified`.
- **Candidate limitation:** existing uncommitted changes include the desktop and
  verification trees. This pass did not establish completion of all queued
  runtime/error/profile fixes or identify a corrected native build for acceptance.
  Earlier build/test reports remain historical, not fresh verification here.

### Per-flow matrix

Every status below concerns the requested **actual Windows 11 manual pass**.
Unverified means not exercised, not a demonstrated failure. No pass is inferred
from source semantics, earlier automation, screenshots or contrast arithmetic.

| Flow / check | Status | Required observation still missing |
| --- | --- | --- |
| Initial window and natural navigation | UNVERIFIED | Tab/Shift-Tab order and visible focus without programmatically placing focus; no unexpected activation |
| Start, idle Stop and restart | UNVERIFIED | Enter activation, truthful pending/result announcements, usable focus after asynchronous completion |
| Folder selection and cancel | UNVERIFIED | Native picker keyboard operation, selection/cancel outcomes and focus returned to Choose existing folder |
| Pairing reveal and explicit hide | UNVERIFIED | Noncredential fixture only; initial focus on Hide, containment, keyboard link access, return to Reveal |
| Pairing Escape and loss of window focus | UNVERIFIED | Hide behavior, no retained exposed fixture view, usable focus after return to the window |
| Busy Stop: cancel / Escape | UNVERIFIED | Offline echo only; Keep running initially focused, contained navigation, work preserved and focus returned to Stop |
| Busy Stop: confirm | UNVERIFIED | Explicit destructive activation, correct result announcement and reachable controls after owned work stops |
| Busy window-close: cancel / Escape | UNVERIFIED | Conservative initial focus, window/work retained and sensible focus restored after dismissal |
| Busy window-close: confirm | UNVERIFIED | Explicit Stop work and close, owned fixture work ends and window exits |
| Destructive fallback: cancel / confirm | UNVERIFIED | Isolated unresponsive fixture, truthful force-stop warning, safe initial focus, contained navigation and correct cancel/termination outcomes |
| Error and retry states | UNVERIFIED | Isolated profile/startup/control/pairing failures; correct error announced, recovery reachable, no stranded focus or false success after retry |
| Diagnostics disclosure | UNVERIFIED | Keyboard open/close, readable event order and reachable overflow content without a focus trap |
| 200% scaling | UNVERIFIED | Actual target text/display setting recorded; full window and dialogs remain readable and operable without clipping |
| Minimum width and long paths | UNVERIFIED | Nonsecret long-path fixtures; reflow, reachable controls and unobscured focus in window and dialogs |
| Forced colours | UNVERIFIED | Actual Windows contrast setting; text, controls, modal boundaries and focus remain distinguishable |
| Reduced motion | UNVERIFIED | Actual Windows setting; transitions respect preference without losing feedback |
| Narrator (separate manual evidence) | UNVERIFIED | Names, roles, descriptions, reading order, modal boundary and truthful nonduplicated status/error announcements across the flows above |

### Resume conditions and safety

Use an operator-accessible Windows 11 target after the related queued fixes are
confirmed complete. Record OS/WebView2 and exact candidate/source identity. Run
physical Tab/Shift-Tab/Enter/Escape without scripted focus placement, using only
isolated fixtures and offline echo for busy work. Obtain consent before changing
Narrator or system settings, record their original values and restore them.
Keep Narrator observations separate from automation and contrast calculations.

Do not interrupt the real-profile launcher or send model prompts. Respect the
separate capture guard: never capture a live pairing or bypass external-window
capture refusal. The helper-owned screenshot fixture is not the native product.
Record fixed labels and outcomes, not credential-bearing UI text or pairing URLs.

No native flows, Narrator, scaling, forced-colour or reduced-motion checks were
run in this session. No concrete runtime failure was reproduced, so no UI fix or
regression was introduced. No tests/typecheck/lint were rerun for this report-only
change. No settings, launcher processes or profiles were changed; no screenshots
were taken. After any future observed fix, rerun affected tests, typecheck, lint
and the failed native flow. Preserve the approved compact design and provisional
visual score. This bounded report claims neither WCAG nor ADA conformance.