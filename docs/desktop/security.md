# Desktop launcher security boundaries

Specific controls and native tests are implemented; [verification](verification.md)
separates executed checks from remaining acceptance. This is not a security
certification. The limited risk record below is engineering guidance, not legal advice.

## Assets and boundaries

Pairing credentials grant phone access and must never enter status, logs,
diagnostic history, screenshots or clipboard automatically. Reveal only on an
explicit user action, over the owned private channel; clear UI references on hide.
Provider credentials remain in the existing profile/environment, not preferences.

The webview receives narrow commands, not arbitrary process execution, PIDs,
paths to execute, filesystem access or environment maps. Native code validates
all control frames and profile choices. Local bundled content alone is not an
IPC permission boundary. Remote pages, shell plugins and navigation are excluded.

A Job Object owns only the launched daemon and its actual descendants. It must
never adopt or stop a separate daemon/service. Bind conflicts fail visibly. Job
kill-on-close is a crash cleanup backstop, not a sandbox and not lossless recovery:
a launcher crash may abruptly interrupt agent writes or active work.

## Native screenshot verification boundary

`capture-window.ps1` refuses **every external process/window** before accessibility
inspection, window manipulation, `PrintWindow` or file creation. The former negative
label search was not evidence that pairing was hidden: an empty/partial tree passed,
and reveal could occur after inspection. Stopped labels and blur-to-hide are not
capture authorization or a rendering lock.

The only supported capture is `-Fixture Stopped`: a fixed, helper-owned WinForms
window with no profile reads, WebView, IPC, pairing data or reveal actions. Its handle
must belong to the helper process; foreground focus is restored on exit. It never
accepts caller-provided UI content. This verifies the native PNG capture mechanism,
**not the launcher layout**. The fixture is explicitly labelled in its pixels.
The output must be a new file. This is not protection against a compromised host.

Windows acceptance no longer captures screenshots automatically on failure. Use its
fixed-label diagnostic state instead. Capturing a real launcher would require a
separate credential-exclusion design that lasts through rendering; another label
scan, a delay or repeated negative searches cannot provide that guarantee.

## Network

This release is LAN-only and rejects profiles with relay configured without
changing them. Binding all interfaces does not limit exposure to a private LAN.
Windows network profile and firewall policy must be checked without elevation or
modification. Unknown policy is visibly unverified. Any firewall change requires
separate permission. A phone test must use Wi-Fi without adb reverse and establish
authenticated connection/provider discovery, not merely an HTTP health response.

## Implemented controls and limitations

- **Runtime:** Source/native tests reject malformed, oversized and incompatible
  frames; a real separate listener survives a bind conflict. Real echo approvals
  exercise cancel/confirm. Native crash acceptance observes the owned daemon and
  two agent descendants exit while an independent listener survives.
- **Code:** Native navigation is limited to packaged origins; the exact loopback
  Vite origin is allowed only in development. CSP and command capabilities are
  separate controls. Pairing objects never enter native snapshots or diagnostics.
- **Code:** Data-folder selection validates a canonical existing profile and stores
  only a path via staged writes. Failed selection preserves previous preferences;
  cleanup removes only a staging file created by that same write.
- **Code:** Parent environment/provider configuration is deliberately inherited,
  with PEW2_TOKEN removed and explicit home/workspace supplied. No environment or
  provider output is logged. Arbitrary stderr is drained and discarded; ordinary
  daemon console messages become at most 128 fixed notices in launcher mode.
- **Code:** Startup and request waits are bounded; there is no automatic restart
  loop. Failed channels request cleanup. Destructive fallback requires the current
  instance AND explicit force mode; it cannot reuse a stale graceful-stop approval.
- **Runtime:** Installer compilation passes. **Code:** installer hooks refuse
  force-killing a running launcher, skip runtime downloads and preserve app data.
  Local silent uninstall/reinstall and same-version replacement now pass;
  clean-system and future-version behaviour still need testing.

## Limited desktop risk record — 2026-09-21

Confirmed scope: local unsigned test delivery, not a public launch. No new cloud
accounts, tracking, payments, uploads, model endpoint or automated decisions are
introduced. Existing pairing credentials, paths and provider environment remain
on the computer. Third-party Windows/WebView2/provider software has its own
behaviour; absence of launcher analytics does not certify those vendors.

| Risk | Evidence | Status / next gate |
| --- | --- | --- |
| Pairing disclosure | Code + tests: explicit reveal, no automatic clipboard, clear on hide/blur, bounded secret-free diagnostics; capture helper rejects external windows | Native screenshots limited to fixed noncredential fixtures, not live launcher verification; raw JS memory is not promised to be cryptographically erased |
| Work interruption | Runtime: busy confirmation and owned crash cleanup | Crash/forced termination can lose unfinished work; never promise lossless recovery |
| Network exposure | Runtime: separately authorized read-only admin inspection found installed-sidecar Private Allow / Public Block rules | No rules changed; the Private rule is not LocalSubnet-limited, and future policy changes are not monitored |
| Accessibility | Runtime: native narrow layout, contrast and keyboard button activation | Full Tab order, Narrator, 200% scaling and forced-colour acceptance remain open; no legal conformance claim |
| Supply chain | Runtime: pinned versions, lockfiles, OSV and workspace audit | Five Rust maintenance advisories and existing workspace advisories remain documented; no blanket clean-audit claim |
| Distribution licences | Code/registry metadata: project AGPL, dependency declarations including MPL-2.0 | Review third-party notices/source obligations before public distribution; obtain qualified legal review if licensing or distribution terms are uncertain |
| Windows acceptance | Runtime: installed Windows 10 lifecycle, removal/reinstallation and real-phone Wi-Fi handoff pass | Clean Windows 11 and full accessibility remain gates; no model verification claimed |

The phone app, relay service, model vendors, full repository history and any public
marketing/legal surface were not audited as part of this desktop implementation.
No deployment, code signing or public publication is authorized by these checks.
