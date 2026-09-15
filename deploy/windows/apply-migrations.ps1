param([int]$SkipCount = 0)

$psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
$migDir = "E:\CK Projects\CitykartDesk\app\supabase\migrations"
$db = "citykart_desk"
$files = Get-ChildItem "$migDir\*.sql" | Sort-Object Name

$appliedRaw = & $psql -U postgres -d $db -t -A -c "SELECT version FROM schema_migrations;"
$applied = @{}
foreach ($v in $appliedRaw) {
    $v = $v.Trim()
    if ($v) { $applied[$v] = $true }
}

$total = $files.Count
$i = 0
$ranCount = 0
$skippedCount = 0
$failed = $null

foreach ($f in $files) {
    $i++
    $version = ($f.BaseName -split '_')[0]
    if ($i -le $SkipCount -or $applied.ContainsKey($version)) {
        $skippedCount++
        continue
    }
    $out = & $psql -U postgres -d $db -v ON_ERROR_STOP=1 -f $f.FullName 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FAILED at [$i/$total]: $($f.Name)"
        Write-Host ($out -join "`n")
        $failed = $f.Name
        break
    }
    & $psql -U postgres -d $db -v ON_ERROR_STOP=1 -c "INSERT INTO schema_migrations(version) VALUES ('$version') ON CONFLICT DO NOTHING;" | Out-Null
    $ranCount++
}

if (-not $failed) {
    Write-Host "ALL_MIGRATIONS_APPLIED total=$total skipped=$skippedCount ran=$ranCount"
} else {
    Write-Host "STOPPED_AT=$failed skipped=$skippedCount ran=$ranCount"
}
