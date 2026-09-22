param(
  [Parameter(Mandatory=$true)][int]$ProcessId,
  [ValidateSet('inspect','start','stop','keep','confirm','close','details','keyboard-start','keyboard-stop','keyboard-keep','keyboard-confirm','minimize','choose')][string]$Action = 'inspect'
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class LauncherInput {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [StructLayout(LayoutKind.Sequential)] public struct Keyboard { public ushort key, scan; public uint flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct Mouse { public int x, y; public uint data, flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] public struct InputData { [FieldOffset(0)] public Keyboard keyboard; [FieldOffset(0)] public Mouse mouse; }
  [StructLayout(LayoutKind.Sequential)] public struct Input { public uint type; public InputData data; }
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, Input[] inputs, int size);
  public static void PressEnter() {
    var down = new Input { type = 1, data = new InputData { keyboard = new Keyboard { key = 0x0d } } };
    var up = down; up.data.keyboard.flags = 2;
    if (SendInput(2, new[] { down, up }, Marshal.SizeOf(typeof(Input))) != 2) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
  }
}
'@
$processCondition = New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::ProcessIdProperty), $ProcessId
$root = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $processCondition)
if (!$root) { throw 'Launcher window is not yet available.' }
function Find-Name([string]$Name) {
  $condition = New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::NameProperty), $Name
  return $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
}
function Send-Enter([string[]]$Names) {
  foreach ($name in $Names) {
    $element = Find-Name $name
    if ($element) {
      $handle = [IntPtr]$root.Current.NativeWindowHandle
      [void][LauncherInput]::SetForegroundWindow($handle)
      $element.SetFocus()
      $focusDeadline = [DateTime]::UtcNow.AddSeconds(3)
      while (!$element.Current.HasKeyboardFocus -and [DateTime]::UtcNow -lt $focusDeadline) { [void][System.Threading.Thread]::Yield() }
      if (!$element.Current.HasKeyboardFocus -or [LauncherInput]::GetForegroundWindow() -ne $handle) { throw 'Refusing keyboard input because the expected launcher button is not focused.' }
      [LauncherInput]::PressEnter()
      return
    }
  }
  throw 'Expected keyboard target was not available.'
}
function Invoke-Named([string[]]$Names) {
  foreach ($name in $Names) {
    $element = Find-Name $name
    if ($element) {
      $invoke = $null
      if ($element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) {
        $invoke.Invoke()
        return
      }
      $expand = $null
      if ($element.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$expand)) {
        $expand.Expand()
        return
      }
    }
  }
  throw 'Expected launcher control was not available through UI Automation.'
}
switch ($Action) {
  'minimize' { $root.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern).SetWindowVisualState([System.Windows.Automation.WindowVisualState]::Minimized) }
  'keyboard-start' { Send-Enter @('Start phone access') }
  'keyboard-stop' { Send-Enter @('Stop phone access') }
  'keyboard-keep' { Send-Enter @('Keep running') }
  'keyboard-confirm' { Send-Enter @('Stop work and close') }
  'start' { Invoke-Named @('Start phone access') }
  'choose' { Invoke-Named @('Choose existing folder') }
  'stop' { Invoke-Named @('Stop phone access', 'Review stop options') }
  'keep' { Invoke-Named @('Keep running') }
  'confirm' { Invoke-Named @('Stop work and close', 'Stop active work', 'Force stop') }
  'details' { Invoke-Named @('Connection details and help') }
  'close' { $root.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern).Close(); Write-Output '{"closeRequested":true}'; exit 0 }
}
$elements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$names = @($elements | ForEach-Object { $_.Current.Name })
# Return fixed labels/numeric metadata only, never arbitrary accessibility text.
$ports = @($names | Where-Object { $_ -match '^0\.0\.0\.0:(\d{1,5})$' } | ForEach-Object { [int]($_.Split(':')[1]) })
@{
  selectedHome = @($names | Where-Object { $_ -match '^[A-Za-z]:\\' } | Select-Object -First 1)
  foreground = ([LauncherInput]::GetForegroundWindow() -eq [IntPtr]$root.Current.NativeWindowHandle)
  minimized = ($root.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern).Current.WindowVisualState -eq [System.Windows.Automation.WindowVisualState]::Minimized)
  stopped = ($names -contains 'Phone access is stopped')
  ready = ($names -contains 'Ready for your phone')
  connected = ($names -contains 'Phone connected')
  confirmation = ($names -contains 'Keep running')
  canStart = ($names -contains 'Start phone access')
  port = $(if ($ports.Count) { $ports[0] } else { 0 })
} | ConvertTo-Json -Compress
