; Contract checked against Tauri CLI 2.11.5's installer.nsi and utils.nsh.
; No process termination, firewall, service, autorun, or profile mutations.

; Override Tauri's default kill-by-name macro completely (not a racy precheck).
!macroundef CheckIfAppIsRunning
!macro CheckIfAppIsRunning executableName productName
  nsis_tauri_utils::FindProcess "${executableName}"
  Pop $R0
  ${If} $R0 != 1
    IfSilent +2
    MessageBox MB_OK|MB_ICONEXCLAMATION "Close ${productName} after stopping active work, then run this installer again. No running process has been stopped."
    Abort "Launcher is running or its state could not be checked."
  ${EndIf}
!macroend

!define MUI_UNCONFIRMPAGE_TEXT_TOP "Uninstall the launcher only. Your pew2 pairing, provider settings and launcher preferences are always preserved. The data-removal checkbox does not apply to this launcher."

!macro NSIS_HOOK_PREINSTALL
  ReadRegStr $R0 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${If} $R0 == ""
    ReadRegStr $R0 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${EndIf}
  ${If} $R0 == ""
    IfSilent +2
    MessageBox MB_OK|MB_ICONEXCLAMATION "Microsoft Edge WebView2 Runtime is required. Install it separately from Microsoft, then run this installer again. Nothing will be downloaded automatically."
    Abort "WebView2 Runtime was not found."
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Preserve even an unusually located existing profile inside app-data folders.
  StrCpy $DeleteAppDataCheckboxState 0
!macroend
