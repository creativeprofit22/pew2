[CmdletBinding(DefaultParameterSetName='External')]
param(
  [Parameter(Mandatory=$true, ParameterSetName='External')][int]$ProcessId,
  [Parameter(Mandatory=$true, ParameterSetName='Fixture')][ValidateSet('Stopped')][string]$Fixture,
  [Parameter(Mandatory=$true)][string]$OutputPath,
  [ValidateRange(320,1600)][int]$Width = 560,
  [ValidateRange(320,1600)][int]$Height = 700
)
$ErrorActionPreference = 'Stop'
# UI Automation cannot prove completeness or lock a WebView against secret reveal.
# Reject external windows BEFORE window lookup, resize, PrintWindow or file creation.
if ($PSCmdlet.ParameterSetName -ne 'Fixture') { throw 'External window capture is disabled: only the helper-owned noncredential fixture may be captured.' }
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -ReferencedAssemblies System.Windows.Forms @'
using System;
using System.Runtime.InteropServices;
public class LauncherCaptureFixture : System.Windows.Forms.Form {
  protected override bool ShowWithoutActivation { get { return true; } }
}
public static class LauncherCapture {
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  public struct Rect { public int Left, Top, Right, Bottom; }
}
'@
# Closed, static fixture: no WebView, IPC, profile reads, pairing data, controls or
# event handlers that could reveal credentials between validation and rendering.
$previous = [LauncherCapture]::GetForegroundWindow()
$form = New-Object LauncherCaptureFixture
$bitmap = $null
try {
  $form.Text = 'pew2 NONCREDENTIAL capture fixture'
  $form.Width = $Width
  $form.Height = $Height
  $form.StartPosition = 'Manual'
  $form.Location = New-Object System.Drawing.Point 80,80
  $label = New-Object System.Windows.Forms.Label
  $label.AutoSize = $true
  $label.Text = "NONCREDENTIAL FIXTURE - not launcher evidence`r`nPhone access is stopped`r`nStart phone access"
  $form.Controls.Add($label)
  $form.Show()
  [System.Windows.Forms.Application]::DoEvents()
  $form.Refresh()
  $target = $form.Handle
  [uint32]$owner = 0
  [void][LauncherCapture]::GetWindowThreadProcessId($target, [ref]$owner)
  if ($owner -ne $PID -or $form.IsDisposed -or !$form.Visible -or $target -eq [IntPtr]::Zero) { throw 'Could not establish owned fixture state.' }
  $rect = New-Object LauncherCapture+Rect
  if (![LauncherCapture]::GetWindowRect($target, [ref]$rect)) { throw 'Could not measure the fixture.' }
  $bitmap = New-Object System.Drawing.Bitmap ($rect.Right - $rect.Left), ($rect.Bottom - $rect.Top)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $dc = $graphics.GetHdc()
    try {
      if (![LauncherCapture]::PrintWindow($target, $dc, 2)) { throw 'Could not capture the fixture.' }
    } finally { $graphics.ReleaseHdc($dc) }
  } finally { $graphics.Dispose() }
  $stream = [System.IO.File]::Open($OutputPath, [System.IO.FileMode]::CreateNew)
  try { $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png) } finally { $stream.Dispose() }
  @{ captured = $true; fixture = $Fixture; width = $bitmap.Width; height = $bitmap.Height } | ConvertTo-Json -Compress
} finally {
  if ($bitmap) { $bitmap.Dispose() }
  $form.Close(); $form.Dispose()
  if ($previous -ne [IntPtr]::Zero -and [LauncherCapture]::GetForegroundWindow() -ne $previous) { [void][LauncherCapture]::SetForegroundWindow($previous) }
}
