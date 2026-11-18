# Installs the Citykart Desk database-server reporter on the DATABASE SERVER (10.0.0.205). Run once, as Administrator, in a PowerShell window on that server.
# What it does (nothing else):
#   1. creates the folder C:\ckdesk-health and copies db-host-agent.ps1 into it (read-only reporter; see the header of that file)
#   2. asks you to TYPE the shared secret (the same value that is set as HEALTH_AGENT_SECRET in the app's .env.local on 10.0.1.98) and saves it in
#      C:\ckdesk-health\agent.secret, readable only by SYSTEM and Administrators. The secret is never shown or printed.
#   3. adds ONE scheduled task, CitykartDesk-DbHostAgent, every minute, as SYSTEM
#   4. runs the reporter once and tells you whether the app accepted it
# It does not touch PostgreSQL, any database, or any other task or service. Remove with:  .\add-db-host-agent-task.ps1 -Remove
param(
  [string]$Url = 'http://10.0.1.98:3210/api/health/db-host',
  [string]$InstallDir = 'C:\ckdesk-health',
  [switch]$Remove
)
$ErrorActionPreference = 'Stop'
$taskName = 'CitykartDesk-DbHostAgent'

if ($Remove) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output "Removed the task $taskName. The folder $InstallDir was left in place (delete it by hand if you want)."
  return
}

$src = Join-Path $PSScriptRoot 'db-host-agent.ps1'
if (-not (Test-Path $src)) { throw "db-host-agent.ps1 not found next to this script ($src). Copy both files into the same folder." }
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Path $src -Destination (Join-Path $InstallDir 'db-host-agent.ps1') -Force

$secretFile = Join-Path $InstallDir 'agent.secret'
$secure = Read-Host -Prompt 'Type the shared secret (HEALTH_AGENT_SECRET, at least 16 characters; nothing is shown)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
if ($plain.Length -lt 16) { throw 'The secret must be at least 16 characters.' }
[IO.File]::WriteAllText($secretFile, $plain)
$plain = $null
# only SYSTEM and Administrators may read it
& icacls.exe $secretFile /inheritance:r /grant:r 'SYSTEM:(R)' 'Administrators:(F)' | Out-Null

$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$taskArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $InstallDir 'db-host-agent.ps1')`" -Url `"$Url`" -SecretFile `"$secretFile`""
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
$action = New-ScheduledTaskAction -Execute $ps -Argument $taskArgs -WorkingDirectory $InstallDir
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Output "Installed $taskName (every minute)."

Write-Output 'Test run now:'
& $ps -NoProfile -ExecutionPolicy Bypass -File (Join-Path $InstallDir 'db-host-agent.ps1') -Url $Url -SecretFile $secretFile
if ($LASTEXITCODE -eq 0) { Write-Output 'OK - the app accepted the report. The Health page shows the database server within a few minutes.' }
else { Write-Output 'The test run did not succeed. Check: (1) HEALTH_AGENT_SECRET is set to the SAME value in .env.local on 10.0.1.98 and the app was restarted, (2) this server can reach http://10.0.1.98:3210, (3) the app is the new release.' }
