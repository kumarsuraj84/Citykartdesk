# Run ON THE APP SERVER (10.0.1.98) in PowerShell, as Administrator. Sets HEALTH_AGENT_SECRET in the app's .env.local (the shared secret used by the small reporter on the
# database server 10.0.0.205). It changes only that one line; every other line of .env.local is kept. The value is typed by you (hidden), or generated here with -Generate and
# shown ONCE on this screen so you can type the same value when add-db-host-agent-task.ps1 asks for it on 205. It is never written anywhere else.
# The app reads .env.local only at start: the new value takes effect at the next app restart (the next release does that by itself).
param(
  [string]$EnvFile = 'D:\Citykart_Applications\Citykart_Ckdesk_App\app\standalone\.env.local',
  [switch]$Generate
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path $EnvFile)) { throw ".env.local not found at $EnvFile" }

if ($Generate) {
  $bytes = New-Object byte[] 24
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $value = ([BitConverter]::ToString($bytes) -replace '-', '').ToLower()
  Write-Host "`nGenerated secret (shown once; you will type the same value on the database server):" -ForegroundColor Yellow
  Write-Host $value -ForegroundColor Cyan
} else {
  $secure = Read-Host 'Type the secret (at least 16 characters; nothing is shown)' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
if ($value.Length -lt 16) { throw 'The secret must be at least 16 characters. Nothing was changed.' }
if ($value -match '\s') { throw 'The secret must not contain spaces. Nothing was changed.' }

$backup = "$EnvFile.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item $EnvFile $backup
$utf8 = New-Object Text.UTF8Encoding($false)
$lines = [IO.File]::ReadAllLines($EnvFile, $utf8) | Where-Object { $_ -notmatch '^\s*HEALTH_AGENT_SECRET\s*=' }
$lines = @($lines) + "HEALTH_AGENT_SECRET=$value"
[IO.File]::WriteAllLines($EnvFile, $lines, $utf8)
$value = $null
Write-Host "`nDone. HEALTH_AGENT_SECRET is set in $EnvFile (a copy of the old file: $backup)." -ForegroundColor Green
Write-Host 'It takes effect when the app next starts (the release does that). Next, on the database server 10.0.0.205, run add-db-host-agent-task.ps1 and type the SAME value when it asks.'
