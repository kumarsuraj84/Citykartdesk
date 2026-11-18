# Citykart Desk database-server reporter. Runs ONCE A MINUTE on the database server (10.0.0.205) as a scheduled task (installed by add-db-host-agent-task.ps1).
# READ-ONLY: it only READS Windows counters (processor use, memory, free space on the fixed disks) and sends those few numbers to the Citykart Desk app
# (POST /api/health/db-host, protected by its own shared secret). It does not touch PostgreSQL, any database, any file other than its own secret file, or any other program.
# The Health & Performance page (platform owners only) shows the numbers and raises an alert if the server runs out of CPU, memory or disk.
# Windows PowerShell 5.1 compatible. Text output only; the secret is never printed.
#
#   -DryRun   print the report that WOULD be sent (nothing is sent, no secret needed)
param(
  [string]$Url = 'http://10.0.1.98:3210/api/health/db-host',
  [string]$SecretFile = 'C:\ckdesk-health\agent.secret',
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'

function Get-DbHostReport {
  # processor use right now (locale independent: the CIM performance class, not a counter name)
  $cpuRow = Get-CimInstance -ClassName Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'"
  $cpu = [double]$cpuRow.PercentProcessorTime
  $os = Get-CimInstance -ClassName Win32_OperatingSystem
  $disks = @(Get-CimInstance -ClassName Win32_LogicalDisk -Filter 'DriveType=3' | Where-Object { $_.Size -gt 0 } | ForEach-Object {
      [ordered]@{ name = [string]$_.DeviceID; totalBytes = [double]$_.Size; freeBytes = [double]$_.FreeSpace }
    })
  [ordered]@{
    cpuPct        = [math]::Round([math]::Min(100, [math]::Max(0, $cpu)), 1)
    memTotalBytes = [double]$os.TotalVisibleMemorySize * 1024
    memFreeBytes  = [double]$os.FreePhysicalMemory * 1024
    disks         = $disks
  }
}

$report = Get-DbHostReport
$json = $report | ConvertTo-Json -Depth 4 -Compress
if ($DryRun) { $report | ConvertTo-Json -Depth 4; return }

if (-not (Test-Path $SecretFile)) { Write-Error "db-host-agent: secret file not found: $SecretFile (run add-db-host-agent-task.ps1 first)"; exit 1 }
$secret = (Get-Content -Path $SecretFile -Raw).Trim()
if ($secret.Length -lt 16) { Write-Error 'db-host-agent: the secret in the secret file is shorter than 16 characters'; exit 1 }
try {
  $null = Invoke-RestMethod -Method Post -Uri $Url -Headers @{ 'x-health-agent-secret' = $secret } -Body $json -ContentType 'application/json' -TimeoutSec 15
  Write-Output ("db-host-agent: sent cpu={0}% memFree={1:N1}GB disks={2}" -f $report.cpuPct, ($report.memFreeBytes / 1GB), $report.disks.Count)
} catch {
  $code = $null
  if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
  Write-Error ("db-host-agent: the app did not accept the report (" + $(if ($code) { "HTTP $code" } else { $_.Exception.Message }) + ")")
  exit 1
}
