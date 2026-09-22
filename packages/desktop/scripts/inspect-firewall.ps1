# Read-only firewall inspection. Never creates, removes, enables or changes rules.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$output = Join-Path $PSScriptRoot '..\artifacts\firewall-inspection.json'
$job = Start-Job -ScriptBlock {
  $ErrorActionPreference = 'Stop'
  Import-Module "$PSHOME\Modules\NetSecurity\NetSecurity.psd1"
  $program = 'E:\tools\pew2 phone access\pew2-daemon.exe'
  function Port-Matches($ports) {
    foreach ($port in @($ports)) {
      if ($port -eq 'Any' -or $port -eq '8787') { return $true }
      if ($port -match '^(\d+)-(\d+)$') {
        if ([int]$Matches[1] -le 8787 -and [int]$Matches[2] -ge 8787) { return $true }
      } elseif ($port -notmatch '^\d+$') {
        # Keep symbolic/dynamic ports visible rather than guessing they do not apply.
        return $true
      }
    }
    return $false
  }
  $rules = @(Get-NetFirewallRule -PolicyStore ActiveStore -Enabled True -Direction Inbound)
  if ($rules.Count -gt 3000) { throw 'Policy exceeds this bounded inspection; manual review required.' }
  $candidates = @()
  foreach ($rule in $rules) {
    $port = $rule | Get-NetFirewallPortFilter
    if ($port.Protocol -notin @('TCP', '6', 'Any', '256') -or !(Port-Matches $port.LocalPort)) { continue }
    $application = $rule | Get-NetFirewallApplicationFilter
    if ($application.Program -ne 'Any' -and [Environment]::ExpandEnvironmentVariables($application.Program) -ne $program) { continue }
    $service = $rule | Get-NetFirewallServiceFilter
    if ($service.Service -ne 'Any') { continue }
    $address = $rule | Get-NetFirewallAddressFilter
    $security = $rule | Get-NetFirewallSecurityFilter
    $candidates += [pscustomobject]@{
      name=$rule.Name; label=$rule.DisplayName; action=$rule.Action.ToString(); profiles=$rule.Profile.ToString()
      program=$application.Program; package=$application.Package; localPorts=@($port.LocalPort)
      localAddresses=@($address.LocalAddress); remoteAddresses=@($address.RemoteAddress)
      authentication=$security.Authentication.ToString(); encryption=$security.Encryption.ToString()
      source=$rule.PolicyStoreSourceType.ToString()
    }
  }
  [pscustomobject]@{
    inspectedAt=[DateTime]::UtcNow.ToString('o'); readOnly=$true; program=$program; port=8787
    inboundRulesExamined=$rules.Count; candidates=$candidates
    profiles=@(Get-NetFirewallProfile -PolicyStore ActiveStore | Select-Object Name,Enabled,DefaultInboundAction,AllowInboundRules)
  }
}
try {
  if (!(Wait-Job $job -Timeout 45)) { Stop-Job $job; throw 'Read-only firewall inspection timed out after 45 seconds.' }
  if ($job.State -ne 'Completed') { Receive-Job $job -ErrorAction Stop | Out-Null; throw 'Firewall inspection failed.' }
  $result = Receive-Job $job -ErrorAction Stop
  $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $output -Encoding UTF8
  Write-Output 'firewall-inspection-complete'
} finally {
  Remove-Job $job -Force -ErrorAction SilentlyContinue
}
