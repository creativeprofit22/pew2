# pew2 phone access for Windows

This package is the standalone manual desktop launcher. It controls the bundled
pew2 daemon; it is not another coding agent or a replacement phone client.

**The unsigned launcher is installed and locally tested on Windows 10**, including
removal/reinstallation with preserved pairing and preferences. The existing phone
has authenticated over Wi-Fi and shown GG Coder through the installed launcher,
without USB reverse forwarding or a model prompt. Windows 11, clean-machine and
full accessibility acceptance remain open; Windows 11 x64 is the target.

## Development

Use the repository's Bun workspace. New direct dependencies are pinned exactly.
The native build requires Rust/MSVC 1.88 or newer, Visual Studio C++ build tools
and WebView2. Tested tools: Rust 1.97.1, Bun 1.3.14, Node 22.20.0. Vite requires
Node ^20.19.0 or >=22.12.0. Install only with the operator's approval; from the
repository root, `bun install --frozen-lockfile --ignore-scripts` uses the lockfile.
Do not install prerequisites automatically. Use an E-drive cache/build directory
on the development machine; do not bake machine-specific paths into the app.

From this directory:

- `bun run typecheck` — frontend/static checks.
- `bun run test` — pure desktop tests.
- `bun run build` — frontend production assets.
- `bun run tauri dev` — native development window.
- `bun run prepare:native` — generate local icons, compile the checkout daemon,
  and verify its version and all bundled provider IDs.
- `bun run build:installer` — produce an unsigned per-user NSIS installer;
  skips signing, uses the Cargo lockfile and never installs the result.
- Native tests require the compiled fixture and an isolated port (see below).
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` — Rust formatting.
- `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` — native lint.

From the repository root in Bash, after `prepare:native`:

```bash
export CARGO_HOME='E:\DevCaches\cargo'
export CARGO_TARGET_DIR='E:\DevCaches\pew2-desktop-target'
export TEMP='E:\DevCaches\tmp'
export TMP="$TEMP"
bun build --compile packages/daemon/src/desktop-control/startup.fixture.ts \
  --outfile 'E:/DevCaches/tmp/pew2-desktop-startup-fixture.exe'
PEW2_PORT=0 \
PEW2_DESKTOP_STARTUP_FIXTURE='E:\DevCaches\tmp\pew2-desktop-startup-fixture.exe' \
PEW2_DESKTOP_TEST_BINARY='E:\Projects\pew2\packages\desktop\src-tauri\binaries\pew2-daemon-x86_64-pc-windows-msvc.exe' \
cargo test --locked --manifest-path packages/desktop/src-tauri/Cargo.toml --lib
```

Those E-drive paths are development examples, never application defaults.
Rebuild both test executables after private-control edits. The startup fixture
uses the real runtime/transport but never imports the server; native tests inject
a 250ms receive deadline, reject an actual incompatible initial request, and
check early unrelated exit (including misleading stderr), EOF cleanup and process
exit before releasing the Job. It is test-only and is never shipped.
Packaging otherwise keeps its tool/cache output under this package or the chosen
Cargo target directory. `CARGO_TARGET_DIR` defaults to `src-tauri/target`;
relative overrides resolve from `packages/desktop/src-tauri`, matching Cargo's
working directory, while absolute overrides keep their location. Packaging passes
the resolved absolute root to Cargo and uses it for installer lookup and reporting.
Installer tools are NSIS 3.11 and nsis-tauri-utils 0.5.3.
Their download is separate from installing or distributing the resulting app.

After building, `bun run packages/desktop/scripts/windows-acceptance.ts` from the
root exercises the release executable with isolated data folders/ephemeral ports
and the offline echo agent. Close any existing launcher first. It temporarily
uses an ownership-checked, loopback-only WebView debugger for browser keyboard
events, with isolated WebView data; no debugger is enabled by the shipped app.
It tests browser keyboard activation, repeated cycles, busy close/cancel/confirm, restart, single-instance
focus, and deliberate crash cleanup. It does not install the artifact, touch the
existing daemon, send billed prompts, or substitute for a clean Windows 11 test.
Reports and generated files live under ignored `artifacts/`; never commit them.

Run `npm run typecheck`, `npm run lint` and `npm test` at the root as well. The root
test command retains explicit source roots and includes desktop pure tests.

Opening the launcher does not start the daemon. Only an explicit
Start action may launch its owned process. No tray, startup registration,
self-update, analytics, remote webpages or model calls are part of this package.

## Boundaries and evidence

- [Design](DESIGN.md)
- [Architecture](../../docs/desktop/architecture.md)
- [Security boundaries](../../docs/desktop/security.md)
- [Windows guide](../../docs/desktop/windows-guide.md)
- [Verification status](../../docs/desktop/verification.md)
