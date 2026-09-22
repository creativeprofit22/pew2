param([Parameter(Mandatory=$true)][int]$ProcessId, [Parameter(Mandatory=$true)][string]$Folder)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
if (!(Test-Path -LiteralPath $Folder -PathType Container)) { throw 'The existing test folder is missing.' }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class FolderInput {
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder name, int length);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageW(IntPtr window, uint message, IntPtr wparam, string text);
  public static string ClassName(IntPtr window) { var name = new StringBuilder(64); GetClassName(window, name, 64); return name.ToString(); }
}
'@
$condition = New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::ProcessIdProperty), $ProcessId
$windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
$dialog = @($windows | Where-Object { $_.Current.Name -eq 'Select your existing pew2 data folder' }) | Select-Object -First 1
if (!$dialog) { throw 'Open the existing-folder chooser in this launcher first.' }
$controls = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$edit = @($controls | Where-Object { $_.Current.AutomationId -eq '1152' -and $_.Current.NativeWindowHandle -ne 0 }) | Select-Object -First 1
$select = @($controls | Where-Object { $_.Current.AutomationId -eq '1' -and $_.Current.NativeWindowHandle -ne 0 }) | Select-Object -First 1
if (!$edit -or !$select) { throw 'Native folder controls were not found.' }
$editHandle = [IntPtr]$edit.Current.NativeWindowHandle
$selectHandle = [IntPtr]$select.Current.NativeWindowHandle
if ([FolderInput]::ClassName($editHandle) -ne 'Edit' -or [FolderInput]::ClassName($selectHandle) -ne 'Button') { throw 'Unexpected native folder control classes.' }
foreach ($handle in @($editHandle, $selectHandle)) {
  [uint32]$owner = 0
  [void][FolderInput]::GetWindowThreadProcessId($handle, [ref]$owner)
  if ($owner -ne $ProcessId) { throw 'Folder control ownership changed.' }
}
if ([FolderInput]::SendMessageW($editHandle, 12, [IntPtr]::Zero, $Folder) -eq [IntPtr]::Zero) { throw 'Folder input was rejected.' }
[void][FolderInput]::SendMessageW($selectHandle, 245, [IntPtr]::Zero, $null)
Write-Output 'native-folder-selection-submitted'
