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
$out = npm run build 2>&1
"build exit: $LASTEXITCODE"
if ($LASTEXITCODE -ne 0) { $out | Select-Object -Last 15; exit 1 }

Copy-Item .next-deploy\static .next-deploy\standalone\.next\static -Recurse -Force
Copy-Item public .next-deploy\standalone\public -Recurse -Force

$bad = Get-ChildItem .next-deploy\standalone, .next-deploy\static -Recurse -File |
  Select-String -Pattern '127.0.0.1:54321', 'localhost:3210' -List | Select-Object -First 3
"local URLs baked: " + [bool]$bad
if ($bad) { exit 1 }

Compress-Archive -Path '.next-deploy\standalone\*' -DestinationPath $ZipPath -CompressionLevel Optimal -Force
Remove-Item .next-deploy -Recurse -Force
"zip ready: $ZipPath"
