# Builds the app for Main, using a separate output directory (.next-deploy) so this never
# touches `.next` — the local dev server's own build cache — even if it's running at the
# same time. Zips .next-deploy/standalone, ready to stage and swap onto Main.
param(
  [string]$SupabaseUrl = 'http://10.0.1.12:8443',
  [string]$AppUrl = 'http://182.72.84.10:3210',
  [Parameter(Mandatory = $true)][string]$SupabaseAnonKey,
  [Parameter(Mandatory = $true)][string]$ZipPath
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))

$env:NEXT_PUBLIC_SUPABASE_URL = $SupabaseUrl
$env:NEXT_PUBLIC_APP_URL = $AppUrl
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY = $SupabaseAnonKey
$env:NEXT_DIST_DIR = '.next-deploy'

if (Test-Path .next-deploy) { Remove-Item .next-deploy -Recurse -Force }
# --webpack, not the (default-since-Next-16) Turbopack: Turbopack's standalone output has a
# real, non-deterministic bug tracing packages with native Node dependencies reached through
# a bundled importer (imapflow -> pino) — the compiled chunk ends up requiring a hashed
# external alias that has no corresponding file anywhere in the shipped bundle, crashing every
# route that shares that server chunk. Confirmed by building the exact same commit twice:
# passed once, failed differently (a different package hash-aliased) the next time. Webpack's
# file-tracing for standalone output is Next's original, mature implementation and doesn't
# have this problem. Local dev (`next dev`) is untouched and still uses Turbopack.
$out = npx next build --webpack 2>&1
"build exit: $LASTEXITCODE"
if ($LASTEXITCODE -ne 0) { $out | Select-Object -Last 15; exit 1 }

# The standalone build's OWN internal folder is named after $env:NEXT_DIST_DIR (i.e.
# ".next-deploy", not ".next") — its required-server-files.json's distDir says so, and
# that's where server.js actually looks for static assets at runtime. Copying to a
# folder literally named ".next" (as this used to do) silently ships a build whose
# server can never find its own CSS/JS — confirmed as the real cause of the 2026-09-22
# Main outage: the HTML and every chunk file were present and correct, "/login" itself
# returned 200, but every "/_next/static/..." asset the page referenced 404'd because
# they'd been copied one directory over from where the server was actually reading.
$distDir = $env:NEXT_DIST_DIR
Copy-Item .next-deploy\static ".next-deploy\standalone\$distDir\static" -Recurse -Force
Copy-Item public .next-deploy\standalone\public -Recurse -Force

$bad = Get-ChildItem .next-deploy\standalone, .next-deploy\static -Recurse -File |
  Select-String -Pattern '127.0.0.1:54321', 'localhost:3210' -List | Select-Object -First 3
"local URLs baked: " + [bool]$bad
if ($bad) { exit 1 }

# Every static asset the prerendered login page's own HTML references must actually exist
# at the exact path the shipped server.js will look for it — the failure mode this catches
# is real, not theoretical: it's exactly what took Main down.
$loginHtml = Get-ChildItem ".next-deploy\standalone\$distDir\server\app" -Recurse -Filter 'login.html' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($loginHtml) {
  $refs = Select-String -Path $loginHtml.FullName -Pattern '/_next/static/[^"''\\]+\.(css|js)' -AllMatches |
    ForEach-Object { $_.Matches } | ForEach-Object { $_.Value } | Sort-Object -Unique
  $missing = $refs | Where-Object { -not (Test-Path (Join-Path ".next-deploy\standalone\$distDir" ($_ -replace '^/_next/', ''))) }
  "asset refs checked: $($refs.Count), missing: $($missing.Count)"
  if ($missing.Count -gt 0) { $missing | ForEach-Object { "  MISSING: $_" }; exit 1 }
} else {
  "WARNING: could not find login.html to verify asset consistency"
  exit 1
}

if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
Compress-Archive -Path '.next-deploy\standalone\*' -DestinationPath $ZipPath -CompressionLevel Optimal -Force
Remove-Item .next-deploy -Recurse -Force
"zip ready: $ZipPath"
