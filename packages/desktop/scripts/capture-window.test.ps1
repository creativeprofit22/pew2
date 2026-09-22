# Native regression uses only a test-owned window and noncredential pixels.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CaptureTestFocus {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
}
'@
$previous = [CaptureTestFocus]::GetForegroundWindow()
$helper = Join-Path $PSScriptRoot 'capture-window.ps1'
$source = Get-Content $helper -Raw
$output = Join-Path ([System.IO.Path]::GetTempPath()) (([guid]::NewGuid().ToString()) + '.png')
$form = New-Object System.Windows.Forms.Form
$form.Text = 'pew2 phone access'
$label = New-Object System.Windows.Forms.Label
$label.AutoSize = $true
$form.Controls.Add($label)
# A visible, noncredential QR-like checkerboard; no profile, link or key is read.
$checker = New-Object System.Drawing.Bitmap 80,80
for ($x = 0; $x -lt 80; $x++) { for ($y = 0; $y -lt 80; $y++) {
  $color = if (([int][Math]::Floor($x / 10) + [int][Math]::Floor($y / 10)) % 2) { [System.Drawing.Color]::Black } else { [System.Drawing.Color]::White }
  $checker.SetPixel($x, $y, $color)
} }
$picture = New-Object System.Windows.Forms.PictureBox
$picture.Image = $checker
$picture.Top = 40
$form.Controls.Add($picture)
try {
  $form.Show()
  [System.Windows.Forms.Application]::DoEvents()
  & {
    # Frozen old predicate, first exercised directly from the original helper.
    # No PrintWindow or Save in this reproduction; only gate reachability.
    $guard = { if ($names -contains 'Hide pairing code' -or ($names | Where-Object { $_ -match '[?&]token=' })) { throw 'Refused' } }
    $cases = @(
      @{ name = 'empty'; names = @(); reveal = $false; expected = $true },
      @{ name = 'partial'; names = @('Phone access is stopped'); reveal = $false; expected = $true },
      @{ name = 'visible'; names = @('Hide pairing code'); reveal = $false; expected = $false },
      @{ name = 'race'; names = @('Phone access is stopped','Start phone access'); reveal = $true; expected = $true }
    )
    foreach ($case in $cases) {
      $label.Text = 'NONCREDENTIAL fixture'
      $names = $case.names
      $allowed = $true
      try { & $guard } catch { $allowed = $false }
      if ($case.reveal) { $label.Text = 'Hide pairing code'; [System.Windows.Forms.Application]::DoEvents() }
      if ($allowed -ne $case.expected) { throw 'Unexpected legacy result.' }
      Write-Output "legacy $($case.name): capture reachable=$allowed (sink not called)"
    }
  }
  # No external PID may reach window lookup, accessibility reads, PrintWindow or Save.
  # Assert ordering as well as exercising refusal against our own native fixture.
  $deny = $source.IndexOf("if (`$PSCmdlet.ParameterSetName -ne 'Fixture')")
  if ($deny -lt 0 -or $deny -gt $source.IndexOf('Add-Type')) { throw 'External capture must be denied before native operations.' }
  foreach ($state in @('safe', 'empty', 'partial', 'visible', 'race')) {
    $label.Text = switch ($state) { 'safe' { 'Phone access is stopped' }; 'empty' { '' }; 'partial' { 'Start phone access' }; default { 'Hide pairing code' } }
    [System.Windows.Forms.Application]::DoEvents()
    $refused = $false
    try { & $helper -ProcessId $PID -OutputPath $output } catch { $refused = $_.Exception.Message -match 'External window capture is disabled' }
    if (!$refused -or (Test-Path $output)) { throw "External $state capture was not refused." }
    Write-Output "external ${state}: refused before native operations"
  }
  $result = & $helper -Fixture Stopped -OutputPath $output | ConvertFrom-Json
  if (!$result.captured -or $result.fixture -ne 'Stopped' -or !(Test-Path $output)) { throw 'Noncredential fixture capture failed.' }
  $image = [System.Drawing.Image]::FromFile($output)
  try { if ($image.Width -ne 560 -or $image.Height -ne 700) { throw 'Unexpected fixture dimensions.' } } finally { $image.Dispose() }
  Write-Output 'owned noncredential fixture: PNG verified'
} finally {
  $form.Close(); $form.Dispose(); $checker.Dispose()
  if (Test-Path $output) { Remove-Item -LiteralPath $output }
  if ($previous -ne [IntPtr]::Zero -and [CaptureTestFocus]::GetForegroundWindow() -ne $previous) { [void][CaptureTestFocus]::SetForegroundWindow($previous) }
}
