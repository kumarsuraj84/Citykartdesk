# High-frequency diagnostic sampler for the target-scale capacity investigation.
#
# Runs entirely locally on the target machine (no per-tick SSH round trips,
# which would be dominated by network latency at these intervals) and writes
# one CSV row per tick.
#
# CPU is measured by delta: Get-Counter/Get-NetTCPConnection (PDH/CIM-backed)
# measured 300-2900ms per call on this box - completely incompatible with a
# 250-500ms tick target. Get-Process (~60ms) exposes each process's
# cumulative CPU time in seconds; dividing the delta between two ticks by the
# delta wall-clock time and the logical processor count gives the same
# percentage a normal task-manager-style tool reports, without the PDH/CIM
# overhead. Same reasoning for TCP state: raw `netstat -ano` (~60ms) instead
# of Get-NetTCPConnection (~2200ms) for the identical information.
#
# Usage: powershell -File perf-sampler.ps1 -DurationSeconds 120 -IntervalMs 300 -OutFile C:\path\out.csv

param(
    [int]$DurationSeconds = 120,
    [int]$IntervalMs = 300,
    [string]$OutFile = "perf-sample.csv",
    [string]$DbUser = "postgres",
    [string]$DbHostName = "127.0.0.1",
    [string]$DbName = "citykart_desk",
    [int]$DbPort = 5432
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$services = @('CitykartApp', 'CitykartProxy', 'CitykartAuth', 'CitykartPostgrest', 'CitykartStorage')
$ports = @(3210, 8443, 9999, 3001, 5000, 5432)
$coreCount = [Environment]::ProcessorCount

# Each of these services runs under nssm (nssm get <svc> Application = node.exe/
# auth.exe/postgrest.exe): the PID Win32_Service reports is nssm's own wrapper
# process (near-zero CPU, it just supervises) - find the actual worker binary
# via its child processes (skipping the conhost.exe child nssm also spawns).
$allProcsAtStart = Get-CimInstance Win32_Process
$servicePids = @{}
foreach ($svc in $services) {
    try {
        $wrapperPid = (Get-CimInstance Win32_Service -Filter "Name='$svc'" -ErrorAction Stop).ProcessId
        $worker = $allProcsAtStart | Where-Object { $_.ParentProcessId -eq $wrapperPid -and $_.Name -ne 'conhost.exe' } | Select-Object -First 1
        # Cast explicitly: CIM's ProcessId is UInt32, Get-Process's .Id is
        # Int32 - using the raw CIM value as a hashtable key against
        # Int32-keyed entries silently never matches even when numerically
        # identical, since classic Hashtable key equality is type-sensitive.
        $servicePids[$svc] = if ($worker) { [int]$worker.ProcessId } else { $null }
    } catch { $servicePids[$svc] = $null }
}

$header = @('timestamp_iso', 'elapsed_ms', 'overall_cpu_pct', 'available_mb')
foreach ($svc in $services) { $header += "${svc}_cpu_pct" }
$header += 'postgres_cpu_pct_sum'
foreach ($p in $ports) { $header += "tcp_${p}_ESTABLISHED"; $header += "tcp_${p}_TIME_WAIT"; $header += "tcp_${p}_OTHER" }
$header += @('pg_total_conns', 'pg_active', 'pg_idle', 'pg_idle_in_txn', 'pg_waiting')
foreach ($svc in $services) { $header += "${svc}_status" }
$header += 'postgres_service_status'

Set-Content -Path $OutFile -Value ($header -join ',')

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$lastPgQuery = [DateTime]::MinValue
$pgCache = @{ total = ''; active = ''; idle = ''; idle_txn = ''; waiting = '' }
$lastMemQuery = [DateTime]::MinValue
$memCache = ''

# Seed the previous-tick process CPU snapshot so the very first row can
# already compute a delta instead of reporting a meaningless first sample.
$prevTime = [DateTime]::UtcNow
$prevProcs = @{}
foreach ($proc in (Get-Process -ErrorAction SilentlyContinue)) {
    if ($null -ne $proc.CPU) { $prevProcs[$proc.Id] = $proc.CPU }
}
Start-Sleep -Milliseconds 100

while ($sw.Elapsed.TotalSeconds -lt $DurationSeconds) {
    $tickStart = [DateTime]::UtcNow
    $elapsedSincePrev = ($tickStart - $prevTime).TotalSeconds
    if ($elapsedSincePrev -le 0) { $elapsedSincePrev = 0.001 }

    $procs = Get-Process -ErrorAction SilentlyContinue
    $curProcs = @{}
    $totalDeltaCpuSecs = 0.0
    foreach ($proc in $procs) {
        if ($null -eq $proc.CPU) { continue }
        $curProcs[$proc.Id] = $proc.CPU
        $prev = $prevProcs[$proc.Id]
        if ($null -ne $prev) {
            $delta = $proc.CPU - $prev
            if ($delta -gt 0) { $totalDeltaCpuSecs += $delta }
        }
    }
    $overallCpuPct = [math]::Round(($totalDeltaCpuSecs / $elapsedSincePrev / $coreCount) * 100, 2)
    if ($overallCpuPct -gt 100) { $overallCpuPct = 100 }

    $row = [ordered]@{}
    $row.timestamp_iso = $tickStart.ToString('o')
    $row.elapsed_ms = [math]::Round($sw.Elapsed.TotalMilliseconds, 0)
    $row.overall_cpu_pct = $overallCpuPct
    if (([DateTime]::UtcNow - $lastMemQuery).TotalMilliseconds -ge 1000) {
        try { $memCache = [math]::Round(((Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).FreePhysicalMemory) / 1024, 0) } catch { }
        $lastMemQuery = [DateTime]::UtcNow
    }
    $row.available_mb = $memCache

    foreach ($svc in $services) {
        $val = ''
        $svcPid = $servicePids[$svc]
        if ($svcPid) {
            $cur = $curProcs[$svcPid]
            $prev = $prevProcs[$svcPid]
            if ($null -ne $cur -and $null -ne $prev) {
                $val = [math]::Round((($cur - $prev) / $elapsedSincePrev) * 100, 2)
            }
        }
        $row["${svc}_cpu_pct"] = $val
    }

    $pgDeltaSum = 0.0
    foreach ($proc in $procs) {
        if ($proc.ProcessName -notlike 'postgres*') { continue }
        $cur = $curProcs[$proc.Id]
        $prev = $prevProcs[$proc.Id]
        if ($null -ne $cur -and $null -ne $prev) {
            $d = $cur - $prev
            if ($d -gt 0) { $pgDeltaSum += $d }
        }
    }
    $row.postgres_cpu_pct_sum = [math]::Round(($pgDeltaSum / $elapsedSincePrev) * 100, 2)

    $prevProcs = $curProcs
    $prevTime = $tickStart

    # --- TCP connection states per port, via raw netstat (Get-NetTCPConnection measured ~2s/call) ---
    $netstatLines = netstat -ano
    $connCounts = @{}
    foreach ($p in $ports) { $connCounts["${p}_ESTABLISHED"] = 0; $connCounts["${p}_TIME_WAIT"] = 0; $connCounts["${p}_OTHER"] = 0 }
    foreach ($line in $netstatLines) {
        if ($line -notmatch '^\s*TCP') { continue }
        $fields = ($line.Trim() -split '\s+')
        if ($fields.Count -lt 4) { continue }
        $localAddr = $fields[1]
        $remoteAddr = $fields[2]
        $state = $fields[3]
        $localPort = $null; $remotePort = $null
        if ($localAddr -match ':(\d+)$') { $localPort = [int]$Matches[1] }
        if ($remoteAddr -match ':(\d+)$') { $remotePort = [int]$Matches[1] }
        foreach ($p in $ports) {
            if ($localPort -eq $p -or $remotePort -eq $p) {
                if ($state -eq 'ESTABLISHED') { $connCounts["${p}_ESTABLISHED"]++ }
                elseif ($state -eq 'TIME_WAIT') { $connCounts["${p}_TIME_WAIT"]++ }
                else { $connCounts["${p}_OTHER"]++ }
            }
        }
    }
    foreach ($p in $ports) {
        $row["tcp_${p}_ESTABLISHED"] = $connCounts["${p}_ESTABLISHED"]
        $row["tcp_${p}_TIME_WAIT"] = $connCounts["${p}_TIME_WAIT"]
        $row["tcp_${p}_OTHER"] = $connCounts["${p}_OTHER"]
    }

    # --- Postgres connection/wait stats (throttled to ~1/sec, psql round trip is comparatively slow) ---
    if (([DateTime]::UtcNow - $lastPgQuery).TotalMilliseconds -ge 1000) {
        try {
            $sql = "select count(*) filter (where true) as total, count(*) filter (where state='active') as active, count(*) filter (where state='idle') as idle, count(*) filter (where state='idle in transaction') as idle_txn, count(*) filter (where wait_event is not null) as waiting from pg_stat_activity where datname = '$DbName';"
            $out = & psql -U $DbUser -h $DbHostName -p $DbPort -d $DbName -t -A -F "," -c $sql 2>$null
            if ($out) {
                $parts = ($out | Select-Object -First 1) -split ','
                if ($parts.Count -eq 5) {
                    $pgCache.total = $parts[0]; $pgCache.active = $parts[1]; $pgCache.idle = $parts[2]
                    $pgCache.idle_txn = $parts[3]; $pgCache.waiting = $parts[4]
                }
            }
        } catch { }
        $lastPgQuery = [DateTime]::UtcNow
    }
    $row.pg_total_conns = $pgCache.total
    $row.pg_active = $pgCache.active
    $row.pg_idle = $pgCache.idle
    $row.pg_idle_in_txn = $pgCache.idle_txn
    $row.pg_waiting = $pgCache.waiting

    foreach ($svc in $services) {
        try { $row["${svc}_status"] = (Get-Service -Name $svc -ErrorAction Stop).Status } catch { $row["${svc}_status"] = 'UNKNOWN' }
    }
    try { $row.postgres_service_status = (Get-Service -Name 'postgresql-x64-18' -ErrorAction Stop).Status } catch { $row.postgres_service_status = 'UNKNOWN' }

    Add-Content -Path $OutFile -Value (($header | ForEach-Object { $row[$_] }) -join ',')

    $elapsedThisTick = ([DateTime]::UtcNow - $tickStart).TotalMilliseconds
    $sleepMs = $IntervalMs - $elapsedThisTick
    if ($sleepMs -gt 0) { Start-Sleep -Milliseconds $sleepMs }
}

Write-Output "sampler done: $OutFile"
