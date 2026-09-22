# Headless build/regression gate only; never launches or installs the desktop app.
# Run from the repository root with the frozen Bun workspace already installed.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# Check native exit codes explicitly, including on Windows PowerShell 5.1.
$PSNativeCommandUseErrorActionPreference = $false

$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$desktop = Join-Path $root 'packages/desktop'
$manifest = Join-Path $desktop 'src-tauri/Cargo.toml'
$fixtureHome = Join-Path ([System.IO.Path]::GetTempPath()) ('pew2-ci-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureHome | Out-Null

# Do not inherit a developer's pairing, workspace, relay or running-daemon config.
$savedEnvironment = @{}
Get-ChildItem Env: | Where-Object { $_.Name -like 'PEW2_*' -or $_.Name -in @('TEMP', 'TMP') } | ForEach-Object {
    $savedEnvironment[$_.Name] = $_.Value
    Remove-Item ('Env:' + $_.Name)
}
$env:TEMP = $fixtureHome
$env:TMP = $fixtureHome
$env:PEW2_PORT = '0'
$env:PEW2_DESKTOP_STARTUP_FIXTURE = Join-Path $fixtureHome 'startup-fixture.exe'
$env:PEW2_DESKTOP_TEST_BINARY = Join-Path $desktop 'src-tauri/binaries/pew2-daemon-x86_64-pc-windows-msvc.exe'

Push-Location $desktop
try {
    & bun run prepare:native
    if ($LASTEXITCODE -ne 0) { throw "prepare:native failed ($LASTEXITCODE)." }
    & bun run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend production build failed ($LASTEXITCODE)." }
    & cargo fmt --manifest-path $manifest -- --check
    if ($LASTEXITCODE -ne 0) { throw "Rust formatting failed ($LASTEXITCODE)." }
    & bun build --compile (Join-Path $root 'packages/daemon/src/desktop-control/startup.fixture.ts') --outfile $env:PEW2_DESKTOP_STARTUP_FIXTURE
    if ($LASTEXITCODE -ne 0) { throw "Startup fixture compilation failed ($LASTEXITCODE)." }

    # Rust assertion failures can include complete pairing profiles. Keep output
    # in memory, never a CI log/artifact; only emit the fixed libtest summary.
    # PS 5.1 treats redirected native stderr as ErrorRecords, not exit status.
    $ErrorActionPreference = 'Continue'
    $nativeOutput = & cargo test --locked --manifest-path $manifest --lib 2>&1
    $nativeExit = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    foreach ($line in $nativeOutput) {
        if ([string]$line -match '^test result: (ok|FAILED)\. \d+ passed; \d+ failed; \d+ ignored; \d+ measured; \d+ filtered out; finished in [0-9.]+s$') {
            Write-Host ([string]$line)
        }
    }
    $nativeOutput = $null
    if ($nativeExit -ne 0) { throw "Native tests failed ($nativeExit); raw output withheld to protect fixture pairing data. Reproduce locally with isolated fixtures." }

    & cargo clippy --locked --manifest-path $manifest --all-targets -- -D warnings
    if ($LASTEXITCODE -ne 0) { throw "Native clippy failed ($LASTEXITCODE)." }
    # Existing packaging script supplies --no-sign --ci --locked, compiles NSIS
    # hooks, and verifies the installer exists. It never executes the installer.
    & bun run build:installer
    if ($LASTEXITCODE -ne 0) { throw "Unsigned NSIS compilation failed ($LASTEXITCODE)." }
    Write-Host 'Windows headless validation passed. Not installed, signed, published, or Windows 11 GUI/accessibility accepted.'
} finally {
    $ErrorActionPreference = 'Stop'
    Pop-Location
    Get-ChildItem Env: | Where-Object { $_.Name -like 'PEW2_*' -or $_.Name -in @('TEMP', 'TMP') } | ForEach-Object { Remove-Item ('Env:' + $_.Name) }
    foreach ($name in $savedEnvironment.Keys) { Set-Item ('Env:' + $name) $savedEnvironment[$name] }
    # Only this invocation's generated fixtures; never a user profile/cache.
    Remove-Item -LiteralPath $fixtureHome -Recurse -Force
}
