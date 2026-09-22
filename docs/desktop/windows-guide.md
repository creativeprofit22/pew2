# Windows phone-access launcher

**Local test build: installation, removal/reinstallation and native lifecycle
checks pass on this Windows 10 PC, including the existing phone over Wi-Fi.**
Clean Windows 11 and full accessibility acceptance remain unverified. The target
is Windows 11 x64. This is an unsigned per-user installer, not a public release. It adds
no administrator requirement, startup registration, tray process or updater.
See the [verification report](verification.md) before relying on this build.

## Install prerequisites

Use the exact installer and SHA-256 in the verification report. Windows may warn
because the publisher is not signed; do not disable security policies to bypass
that warning. Establish the file's origin/hash and obtain local approval first.

Microsoft Edge WebView2 Runtime must already be available. The installer reports
if it cannot find the runtime and stops; it does not download or install WebView2.
Bun and the repository are not intended runtime prerequisites, but clean-machine
acceptance without them remains outstanding. Coding providers still need their
own normal installation and sign-in; the launcher does not supply subscriptions.

The installer is per-user. Before replacing or removing it, stop active work and
close the launcher. The installer refuses to force-close it. It does not modify
Windows firewall rules, the router or a separately installed pew2 CLI service.

## This PC

The launcher is installed in `E:\tools\pew2 phone access`, with Desktop and Start
Menu shortcuts. Its saved data folder is `E:\tools\pew2-data`. The old idle
source daemon was stopped only after explicit permission and fresh idle checks;
the installed launcher now owns phone access. Keep its window open/minimised.
The pairing was preserved, and no model prompt was sent during verification.

A separately authorized read-only inspection found the installed sidecar allowed
on Private networks and blocked on Public networks. This is a dated check, not a
permanent guarantee or an application-managed firewall rule. The launcher itself
does not request administrator rights or modify firewall policy.

## Daily use

1. Open pew2 phone access. Opening the window alone does not start anything.
2. Check the displayed existing pew2 data folder. Initial CLI setup is required
   if that folder has no usable pairing; do not create a second identity by guessing.
3. Click **Start phone access**. Keep the window open or minimised.
4. Connect the existing phone on the same Wi-Fi. Reveal the pairing QR only when
   deliberately pairing a device; it contains credentials.
5. Click Stop or close the window. Active work requires confirmation. Cancelling
   keeps the launcher and its owned daemon running.

Normal use requires no PowerShell. The folder chooser selects an existing profile;
on the development PC that is the existing E-drive pew2 folder, not a shipped
default. Selection is saved as a nonsecret path. An explicit PEW2_HOME environment
override takes precedence even after restart, so remove/change that override if
you intend a different saved selection to become the default.

A Stop confirmation defaults to **Keep running**. If the private channel breaks
or shutdown stalls, **Review stop options** offers a separate destructive **Force
stop** warning. Approval for an ordinary stop is never silently upgraded to a
forced stop. Forced termination can interrupt writes or lose unfinished work.

Use Tab and Enter for buttons; Escape cancels a confirmation. The pairing dialog
has a labelled text alternative to its local QR and a Hide button. It hides when
the window loses focus and never copies credentials automatically. Do not share
pairing links or capture screenshots while a code is revealed. Full Narrator and
200% scaling acceptance remain unverified.

Provider setup remains separate. A connected phone does not establish model authentication or successful model use.

## Troubleshooting boundaries

- A port already in use means another process may be running. The launcher must
  not stop, adopt or reconfigure it.
- A relay-enabled profile cannot run in this LAN-only launcher; it is not erased.
- WebView2 is a prerequisite; installer/runtime availability must be verified and
  any prerequisite download separately disclosed.
- Check Wi-Fi, Windows network profile and Private-network firewall rules. The
  launcher does not modify the firewall or router. Unknown exposure is not safe
  exposure; do not test with a billed prompt.
- Unsigned builds can trigger Windows warnings and have no publisher-signing
  assurance. Verify the documented artifact hash before local installation.

## Removal and data preservation

The installer hooks preserve pairing/provider data and launcher preferences. The
stock uninstaller's data-removal checkbox does not apply to this launcher; its
confirmation text says so. Removing the launcher should remove its application
files/shortcuts only, not `.pew2`, a selected external profile, or CLI services.
Local silent uninstall/reinstall and same-version replacement preserved pairing
and preferences in tests. Clean-system behaviour, future-version upgrades and the
interactive data-removal option remain acceptance gates, not proven guarantees.

There is no lossless crash recovery promise: closing the launcher's Windows Job
on a crash can abruptly kill its daemon and agent descendants. Save important
work. A local authenticated connection proves transport, not model entitlement
or a completed model response; no billed prompt is part of launcher verification.
