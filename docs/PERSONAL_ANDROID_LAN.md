# Personal Android APK on trusted home Wi-Fi

This is an **opt-in personal build policy**, not a shared default or an endpoint
editor. Set `PEW2_ANDROID_LAN_HOST` to the desktop daemon's private IPv4 address
when Expo generates Android. `app.config.js` registers the local plugin only
when that value is present. No Expo account, cloud build or relay is needed.

Accepted input is one canonical IPv4 literal in `10.0.0.0/8`, `172.16.0.0/12` or
`192.168.0.0/16`. Empty values, public/loopback/link-local addresses, hostnames,
URLs, ports, CIDRs, leading-zero octets and wildcards fail configuration.
The generated policy denies cleartext by default and permits it for **only that
exact address**, with `includeSubdomains="false"`. It never sets a broad
`usesCleartextTraffic` opt-in. Use only on a trusted LAN; this does not add TLS.
The app's existing pairing still selects the endpoint; this policy does not.

## Existing E-drive-only Windows setup

In PowerShell, use the existing local environment helper (machine-specific,
not part of the repository):

```powershell
. E:\tools\pew2-env.ps1
$env:PEW2_ANDROID_LAN_HOST = Read-Host 'Desktop private IPv4 address'
$env:EXPO_NO_METRO_WORKSPACE_ROOT = '1'
$env:NODE_ENV = 'production'
$env:EXPO_OFFLINE = '1'
$env:EXPO_NO_TELEMETRY = '1'
Remove-Item Env:EXPO_PUBLIC_HARNESS -ErrorAction SilentlyContinue
```

Keep `EXPO_NO_METRO_WORKSPACE_ROOT=1` and `NODE_ENV=production`: these were
required by the installed local release toolchain. The helper puts SDK, JDK,
Gradle/npm/Bun caches and temporary files on E:. Use installed tools; do not
install/download dependencies or enroll signing credentials for this workflow.

**Do not run `expo prebuild --clean` against the existing app directory.** It
removes `android/`, including the retained signing identity and personal native
settings. Generate only in a disposable E: copy with this app's config, plugin,
assets, package manifest and access to the already-installed dependencies.
From that disposable app root, the offline generation command is:

```powershell
node E:\Projects\pew2\node_modules\expo\bin\cli prebuild --platform android --no-install --template E:\Projects\pew2\node_modules\expo\template.tgz
```

`--clean` is appropriate **only inside that disposable copy** to verify clean
regeneration. Inspect the generated files:

- `android/app/src/main/AndroidManifest.xml`: application references
  `@xml/pew2_personal_network_security`.
- `android/app/src/main/res/xml/pew2_personal_network_security.xml`: base
  `cleartextTrafficPermitted="false"`, one domain-config allowing cleartext,
  and one exact address with `includeSubdomains="false"`.

For the retained local native tree, after approval, transfer only that XML and
the manifest's `android:networkSecurityConfig` attribute. Do **not** copy the
whole generated manifest, Gradle files or keystore over the existing tree.
Keep the installed signing identity, package and version settings unchanged.
Do not commit generated `android/`, APKs, keystores or personal environment files.

Unsetting the variable leaves default **fresh generation** unchanged; it does
not revoke an exception already baked into an APK or a reused native tree.
To revoke/change a personal policy, explicitly regenerate and inspect the
appropriate build inputs. An existing different network-security reference is
rejected instead of silently replaced.

## Release packaging and checks — separate approval required

Generation/tests do not authorize a release build or device installation.
After local build approval, keep the environment above and the retained native
tree/signing identity:

```powershell
Set-Location E:\Projects\pew2\packages\app\android
.\gradlew.bat --offline assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain
```

Before any installation, inspect the resulting APK with the installed
`E:\tools\android-sdk\build-tools\36.0.0` tools:

1. `aapt.exe dump badging <apk>`: expected package/version, no
   `application-debuggable` flag. Also inspect `aapt.exe dump xmltree <apk>
   AndroidManifest.xml` for absence/false `android:debuggable` and the
   `android:networkSecurityConfig` resource ID.
2. `aapt.exe dump --values resources <apk>`: resolve that ID to its packaged XML path
   (AAPT may shorten the filename). Dump that path with `aapt.exe dump xmltree`
   and confirm base=false, domain-config=true, includeSubdomains=false and only
   the intended address. Source XML alone is not artifact verification.
3. `apksigner.bat verify --print-certs <apk>`: require success and compare
   certificate SHA-256 with the previously verified installed APK/local report
   `E:\tools\pew2-personal-lan-verification.md`. Stop on mismatch; never rotate
   the key or uninstall to make installation succeed.
4. `aapt.exe list <apk>`: require `assets/index.android.bundle` (standalone JS).

Device installation/reconnection also needs approval. Preserve drafts,
attachments, pending messages and app data; stop if safe update cannot be
established. Never uninstall, clear storage or forget pairing. On authorized
verification, use Metro off and `adb reverse --list` empty; verify existing
history/provider discovery on the two requested trusted home networks. No
model prompt or billing is necessary.

## Regression tests

The normal repository test command includes `src/personalAndroidLan.test.js`.
It exercises the installed Expo mod compiler against disposable manifests,
including no opt-in, private ranges, malformed/public inputs, exact XML,
repeat application, host replacement and conflicting existing policy.
On this Windows machine, dot-source the E-drive helper before running:

```powershell
Set-Location E:\Projects\pew2
bun test ./packages/app/src/personalAndroidLan.test.js
```
