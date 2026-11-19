# Citykart Desk - run the web app as several worker processes on the app server 10.0.1.98 (and back to one process again).
# Run on 10.0.1.98 in an ADMINISTRATOR PowerShell, AFTER a release that contains cluster-server.cjs has been deployed (every release from 2026-11-19 on has it).
#   .\use-workers-on-98.ps1 -DryRun          only show what would be changed (changes nothing)
#   .\use-workers-on-98.ps1 -Workers 3       switch the CkDeskApp service to 3 workers (about 15-20 seconds of interruption while the service restarts)
#   .\use-workers-on-98.ps1 -Undo            back to one process, exactly as before
# What it changes (and nothing else): (1) a line  CKDESK_WORKERS=3  in the app's .env.local (a release keeps that file), and (2) the program argument of the CkDeskApp service
# from  server.js  to  cluster-server.cjs  (written down first in a text file, so -Undo knows what to put back). It does not touch the proxy, the data service, the sign-in
# service, the file service, the database, or any other application on this server. If the app is not healthy 60 seconds after the restart, it puts everything back by itself.
# Why 3 and not 10: today's peak is about 3 requests a second, one process handles several hundred; the workers are for safety - if one process is blocked or restarts,
# the others keep serving people - and they keep every CPU busy only when needed. Never more than 8 (the launcher refuses more).
param([int]$Workers = 3, [switch]$Undo, [switch]$DryRun,
      [string]$Base = 'D:\Citykart_Applications\Citykart_Ckdesk_App', [string]$ServiceName = 'CkDeskApp', [string]$HealthUrl = 'http://127.0.0.1:3210')
$ErrorActionPreference = 'Stop'
$nssm = "$Base\tools\nssm.exe"
$appDir = "$Base\app\standalone"
$envFile = "$appDir\.env.local"
$noteFile = "$Base\workers-before-change.txt"
$envName = 'CKDESK_WORKERS'

function Get-Nssm($name) { ((& $nssm get $ServiceName $name 2>$null) | Out-String) -replace "`0", '' -replace '\s+$', '' }
function Healthy([int]$tries = 60) {
  for ($i = 0; $i -lt $tries; $i++) {
    try { $h = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 "$HealthUrl/api/health").Content; if ($h -match '"status":"ok"' -and $h -match '"db":"ok"') { return $true } } catch { }
    Start-Sleep -Seconds 1
  }
  return $false
}
function Set-EnvLine($value) {      # value = $null removes the line
  $lines = @(Get-Content $envFile | Where-Object { $_ -notmatch "^\s*$envName\s*=" })
  if ($null -ne $value) { $lines += "$envName=$value" }
  Set-Content -Path $envFile -Value $lines -Encoding ASCII
}
function Restart-App {
  Stop-Service $ServiceName -Force
  Start-Service $ServiceName
}

if (-not $Undo -and ($Workers -lt 2 -or $Workers -gt 8)) { throw 'Workers must be from 2 to 8 (use -Undo for one process).' }
foreach ($p in $nssm, $envFile) { if (-not (Test-Path $p)) { throw "not found: $p" } }
if (-not $Undo -and -not (Test-Path "$appDir\cluster-server.cjs")) { throw "cluster-server.cjs is not in $appDir - deploy a release that contains it first. Nothing was changed." }
if (-not $Undo -and -not (Test-Path "$appDir\rate-limit-counters.cjs")) { throw "rate-limit-counters.cjs is not in $appDir - deploy a release that contains it first. Nothing was changed." }

$currentParams = Get-Nssm 'AppParameters'
"service $ServiceName runs now with the argument: [$currentParams]"
"app folder: $appDir"

if ($Undo) {
  $original = 'server.js'
  if (Test-Path $noteFile) { $m = Select-String -Path $noteFile -Pattern '^AppParameters=(.*)$' | Select-Object -First 1; if ($m) { $original = $m.Matches[0].Groups[1].Value.Trim() } }
  if ($original -match 'cluster-server') { $original = 'server.js' }
  "Undo: the argument will be set back to [$original] and the $envName line removed."
  if ($DryRun) { 'DRY RUN: nothing changed.'; return }
  Set-EnvLine $null
  & $nssm set $ServiceName AppParameters $original | Out-Null
  Restart-App
  if (Healthy) { 'DONE: one process again, the app is healthy.' } else { 'WARNING: the app did not become healthy - check logs\CkDeskApp.err.log and tell Claude.' }
  return
}

"Will write $envName=$Workers into $envFile and set the argument to [cluster-server.cjs]."
if ($DryRun) { 'DRY RUN: nothing changed.'; return }
if ($currentParams -notmatch 'cluster-server') {
  "AppParameters=$currentParams" | Set-Content -Path $noteFile -Encoding ASCII      # what to put back
  "written down in $noteFile"
}
Set-EnvLine "$Workers"
& $nssm set $ServiceName AppParameters 'cluster-server.cjs' | Out-Null
$stopwatch = [Diagnostics.Stopwatch]::StartNew()
Restart-App
if (Healthy) {
  $kids = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'cluster-server' })
  "HEALTHY after $([int]$stopwatch.Elapsed.TotalSeconds) s. node processes of the app: $($kids.Count) (1 launcher + $Workers workers expected)"
  "Check the last lines of $Base\logs\CkDeskApp.out.log for '[cluster] ... starting $Workers workers'."
  "To go back:  .\use-workers-on-98.ps1 -Undo"
} else {
  'NOT healthy - putting everything back ...'
  Set-EnvLine $null
  & $nssm set $ServiceName AppParameters $(if ($currentParams -match 'cluster-server') { 'server.js' } else { $currentParams }) | Out-Null
  Restart-App
  if (Healthy) { 'ROLLED BACK: one process again, the app is healthy. Tell Claude what the log says.' } else { 'ROLLBACK DID NOT BECOME HEALTHY - needs attention now.' }
  exit 1
}
