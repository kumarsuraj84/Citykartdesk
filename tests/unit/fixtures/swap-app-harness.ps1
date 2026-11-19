# Test harness for scripts\windows\swap-app.ps1 (used by tests/unit/swap-app-script.test.ts; run on a developer PC, never on a server).
# Builds a fake "app server" in a temp folder: a running OLD build (a tiny node server) and a zip with a NEW build, replaces the Windows service commands by functions that
# start and stop that node server, runs the real swap script against it, and watches the health address every 100 ms to measure how long nothing answered.
param([ValidateSet('good', 'bad')][string]$NewBuild = 'good', [int]$Port = 3291)
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:TEMP ("swaptest-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$app = Join-Path $root 'app'
$old = Join-Path $app 'standalone'
$newSrc = Join-Path $root 'newbuild'
New-Item -ItemType Directory -Force -Path $old, $newSrc | Out-Null

function Server-Js($version, $healthy) {
  $status = if ($healthy) { 'ok' } else { 'down' }
  "const http=require('http');http.createServer((q,s)=>{s.setHeader('content-type','application/json');if(q.url.startsWith('/api/health'))s.end(JSON.stringify({status:'$status',db:'ok'}));else if(q.url.startsWith('/api/version'))s.end(JSON.stringify({buildId:'$version'}));else s.end('{}')}).listen($Port,'127.0.0.1')"
}
Set-Content -Path (Join-Path $old 'server.js') -Value (Server-Js 'OLD' $true)
Set-Content -Path (Join-Path $old '.env.local') -Value 'SECRET_FOR_TEST=1'
# page files of the old build (what a browser tab left open before the release still asks for)
$oldChunks = Join-Path $old '.next-deploy\static\chunks'
New-Item -ItemType Directory -Force -Path $oldChunks | Out-Null
Set-Content -Path (Join-Path $oldChunks 'old-abc.js') -Value 'OLDFILE'
Set-Content -Path (Join-Path $oldChunks 'common.js') -Value 'OLDVERSION'
Set-Content -Path (Join-Path $oldChunks 'old-ancient.js') -Value 'ANCIENT'
(Get-Item (Join-Path $oldChunks 'old-ancient.js')).LastWriteTime = (Get-Date).AddDays(-30)
Set-Content -Path (Join-Path $newSrc 'server.js') -Value (Server-Js 'NEW' ($NewBuild -eq 'good'))
$newChunks = Join-Path $newSrc '.next-deploy\static\chunks'
New-Item -ItemType Directory -Force -Path $newChunks | Out-Null
Set-Content -Path (Join-Path $newChunks 'new-xyz.js') -Value 'NEWFILE'
Set-Content -Path (Join-Path $newChunks 'common.js') -Value 'NEWVERSION'
# a few hundred small files, like a real build, so unpacking takes a moment
New-Item -ItemType Directory -Force -Path (Join-Path $newSrc 'node_modules') | Out-Null
1..300 | ForEach-Object { Set-Content -Path (Join-Path $newSrc "node_modules\f$_.js") -Value "module.exports=$_" }
Compress-Archive -Path (Join-Path $newSrc '*') -DestinationPath (Join-Path $root 'ckdesk-deploy.zip') -Force

$global:proc = $null
function Stop-Service { [CmdletBinding()] param([Parameter(Position = 0)]$Name, [switch]$Force) if ($global:proc -and -not $global:proc.HasExited) { Stop-Process -Id $global:proc.Id -Force; $global:proc.WaitForExit() } }
function Start-Service { [CmdletBinding()] param([Parameter(Position = 0)]$Name) $global:proc = Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory (Join-Path $app 'standalone') -PassThru -WindowStyle Hidden }

Start-Service 'fake'
$url = "http://127.0.0.1:$Port"
for ($i = 0; $i -lt 50; $i++) { try { $null = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 "$url/api/health"; break } catch { Start-Sleep -Milliseconds 200 } }

# watch the address from a background job
$watch = Start-Job -ScriptBlock {
  param($url)
  $rows = @()
  $end = (Get-Date).AddSeconds(40)
  while ((Get-Date) -lt $end) {
    $ok = $false
    try { $null = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 "$url/api/health"; $ok = $true } catch { }
    $rows += , @((Get-Date).Ticks, $ok)
    Start-Sleep -Milliseconds 100
  }
  $rows
} -ArgumentList $url

Start-Sleep -Milliseconds 800
$swap = Join-Path (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))) 'scripts\windows\swap-app.ps1'
$out = & $swap -Base $root -ServiceName 'fake' -HealthUrl $url -HealthTries 8 2>&1 | Out-String
$exit = $LASTEXITCODE
Start-Sleep -Milliseconds 800
Stop-Job $watch | Out-Null
$rows = Receive-Job $watch
Remove-Job $watch -Force

# longest stretch with no answer
$longest = 0.0; $startTick = $null
foreach ($r in $rows) {
  if (-not $r[1]) { if ($null -eq $startTick) { $startTick = $r[0] } ; $longest = [math]::Max($longest, ($r[0] - $startTick) / 1e7) } else { $startTick = $null }
}
$version = ''
try { $version = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "$url/api/version").Content } catch { $version = 'NO ANSWER' }
$bakNames = @(Get-ChildItem $app -Directory | Where-Object { $_.Name -like 'standalone-bak-*' } | ForEach-Object { $_.Name }) -join ','
$hasNext = Test-Path (Join-Path $app 'standalone-next')
$envKept = Test-Path (Join-Path $app 'standalone\.env.local')
$st = Join-Path $app 'standalone\.next-deploy\static\chunks'
$oldKept = Test-Path (Join-Path $st 'old-abc.js')
$ancientGone = -not (Test-Path (Join-Path $st 'old-ancient.js'))
$newKept = Test-Path (Join-Path $st 'new-xyz.js')
$commonNew = $false; if (Test-Path (Join-Path $st 'common.js')) { $commonNew = ((Get-Content (Join-Path $st 'common.js') -Raw) -match 'NEWVERSION') }
if ($global:proc -and -not $global:proc.HasExited) { Stop-Process -Id $global:proc.Id -Force }
Start-Sleep -Milliseconds 300
Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue

"RESULT exit=$exit longestSilenceSeconds=$([math]::Round($longest, 1)) version=$version backups=$bakNames leftoverNext=$hasNext envKept=$envKept oldChunkKept=$oldKept ancientChunkPruned=$ancientGone newChunk=$newKept commonIsNew=$commonNew"
"--- script output ---"
$out
