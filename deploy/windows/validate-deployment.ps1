# Post-deploy validation for the Windows-native Citykart DESK stack.
#
# Checks the specific regressions this deployment has already hit once and
# silently degraded performance/correctness without any error in the logs -
# see docs/WINDOWS-DEPLOYMENT.md and
# docs/CITYKART-DESK-DEPLOYMENT-PARITY-AND-PERFORMANCE-REMEDIATION.md for the
# incidents behind each check. Run after any deploy, service restart, or
# config change to CitykartAuth/CitykartPostgrest/CitykartStorage.
#
# Usage: powershell -File deploy\windows\validate-deployment.ps1
# Exit code 0 = all checks passed. Non-zero = at least one check failed.

param(
    [string]$AuthUrl = "http://127.0.0.1:9999",
    [string]$PostgrestUrl = "http://127.0.0.1:3001",
    [string]$DbUri = "postgres://citykart_desk_app@127.0.0.1:5432/citykart_desk"
)

$failures = @()
$warnings = @()

function Test-Check($name, [scriptblock]$check) {
    try {
        $result = & $check
        if ($result -eq $true) {
            Write-Output "[PASS] $name"
        } elseif ($result -eq $null -or $result -eq $false) {
            Write-Output "[FAIL] $name"
            $script:failures += $name
        } else {
            Write-Output "[WARN] $name : $result"
            $script:warnings += $name
        }
    } catch {
        Write-Output "[FAIL] $name : $($_.Exception.Message)"
        $script:failures += $name
    }
}

Write-Output "=== Citykart DESK deployment validation ==="
Write-Output ""

# 1. JWKS must not be empty. An empty-but-200 JWKS silently forces every
#    getClaims() call in proxy.ts into a real network round-trip to
#    GoTrue's /user endpoint - the dominant root cause of Main's original
#    auth-related latency (Root Cause #4). This was never flagged by GoTrue
#    itself: {"keys":[]} is a valid, healthy 200 response.
Test-Check "GoTrue JWKS is non-empty (Root Cause #4)" {
    $jwks = Invoke-RestMethod -Uri "$AuthUrl/.well-known/jwks.json" -Method Get
    if ($jwks.keys -and $jwks.keys.Count -gt 0) { return $true }
    return "JWKS has 0 keys - GoTrue is symmetric-only, getClaims() cannot verify locally. See docs/WINDOWS-DEPLOYMENT.md 'JWT signing keys (JWKS)'."
}

# 2. service_role must have BYPASSRLS. A role created before bootstrap-roles.sql's
#    ALTER ROLE lines existed silently kept rolbypassrls=false forever, making
#    admin writes silent no-ops with no error anywhere.
Test-Check "service_role has BYPASSRLS" {
    $out = & psql $DbUri -t -c "SELECT rolbypassrls FROM pg_roles WHERE rolname = 'service_role';" 2>&1
    if ($LASTEXITCODE -ne 0) { return "could not query Postgres: $out" }
    if (($out -join '').Trim() -eq 't') { return $true }
    return "service_role.rolbypassrls is not true - run: ALTER ROLE service_role BYPASSRLS;"
}

# 3. GoTrue/PostgREST must connect via 127.0.0.1, not localhost. Windows
#    resolves "localhost" via IPv6-then-IPv4 fallback, adding ~750ms per new
#    connection.
Test-Check "auth/.env uses 127.0.0.1 (not localhost) for DATABASE_URL" {
    $envPath = "E:\CK Projects\CitykartDesk\services\auth\.env"
    if (-not (Test-Path $envPath)) { return "not found: $envPath" }
    $line = Get-Content $envPath | Where-Object { $_ -match '^DATABASE_URL=' }
    if ($line -match '127\.0\.0\.1' -and $line -match 'sslmode=disable') { return $true }
    return "DATABASE_URL does not use 127.0.0.1 + sslmode=disable: $line"
}

# 4. request_sequences counter sanity - not a hard failure, just surfaces the
#    current state so a leftover bulk-test counter isn't missed silently.
Test-Check "request_sequences.last_no (informational)" {
    $out = & psql $DbUri -t -c "SELECT prefix, last_no FROM request_sequences;" 2>&1
    if ($LASTEXITCODE -ne 0) { return "could not query Postgres: $out" }
    return ($out -join '; ').Trim()
}

Write-Output ""
Write-Output "=== Summary ==="
Write-Output "Failures: $($failures.Count)"
Write-Output "Warnings/informational: $($warnings.Count)"

if ($failures.Count -gt 0) {
    Write-Output ""
    Write-Output "FAILED CHECKS:"
    $failures | ForEach-Object { Write-Output "  - $_" }
    exit 1
}
exit 0
