# STEP 3 - run on 10.0.1.98 (PowerShell as Administrator), BEFORE step 4 (the app swap). Adds the four settings the Google Sheets connection needs to
# app\standalone\.env.local (the new app reads them; the old app ignores them). Keeps a dated copy of the file first. Never prints a value.
#
# What you need at hand: the Google OAuth client ID and client secret (the same ones the local .env.local uses; Google Cloud console > APIs & Services > Credentials),
# typed here at the prompt (the secret is hidden while typing).
#
# Why OAUTH_REDIRECT_BASE_URL: Google does not accept a plain-http public IP address as the return address; it does accept http://localhost:<port>.
# So the one-time "Connect Google Sheets" is done through an SSH tunnel from your PC (see step 7) and the return address is http://localhost:3211 .
param(
  [string]$RedirectBase = 'http://localhost:3211'
)
$ErrorActionPreference = 'Stop'
$f = 'D:\Citykart_Applications\Citykart_Ckdesk_App\app\standalone\.env.local'
if (-not (Test-Path $f)) { throw "not found: $f" }
$names = @(); foreach ($l in (Get-Content $f)) { if ($l -match '^\s*([A-Za-z0-9_]+)\s*=') { $names += $Matches[1] } }
foreach ($k in 'GOOGLE_OAUTH_CLIENT_ID','GOOGLE_OAUTH_CLIENT_SECRET','OAUTH_STATE_SECRET','OAUTH_REDIRECT_BASE_URL') {
  if ($names -contains $k) { throw "$k is already in .env.local. Nothing was changed. (Edit it by hand if it must change.)" }
}
$id = Read-Host 'Google OAuth client ID'
$sec = Read-Host 'Google OAuth client secret' -AsSecureString
$secPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
if ($id.Trim().Length -lt 20 -or $secPlain.Trim().Length -lt 10) { throw 'The client id or secret looks too short. Nothing was changed.' }
$bytes = New-Object byte[] 32; (New-Object System.Security.Cryptography.RNGCryptoServiceProvider).GetBytes($bytes)
$state = -join ($bytes | ForEach-Object { $_.ToString('x2') })
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Copy-Item $f "$f.bak-$stamp"
$text = [IO.File]::ReadAllText($f)
if (-not $text.EndsWith("`n")) { $text += "`r`n" }
$text += "GOOGLE_OAUTH_CLIENT_ID=$($id.Trim())`r`nGOOGLE_OAUTH_CLIENT_SECRET=$($secPlain.Trim())`r`nOAUTH_STATE_SECRET=$state`r`nOAUTH_REDIRECT_BASE_URL=$RedirectBase`r`n"
[IO.File]::WriteAllText($f, $text, (New-Object System.Text.UTF8Encoding($false)))
$secPlain = $null
"Added: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, OAUTH_STATE_SECRET (random, new), OAUTH_REDIRECT_BASE_URL=$RedirectBase"
"Backup of the old file: $f.bak-$stamp"
"The app reads them at start-up: step 4 (the swap) copies this file into the new app and starts it."
