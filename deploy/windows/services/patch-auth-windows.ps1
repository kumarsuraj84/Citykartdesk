$ErrorActionPreference = "Stop"
$path = "E:\CK Projects\CitykartDesk\services\auth\src\cmd\serve_cmd.go"
$content = Get-Content -Raw -Path $path

# Remove the two Unix-only imports
$content = $content -replace '(?m)^\s*"syscall"\r?\n', ''
$content = $content -replace '(?m)^\s*"golang\.org/x/sys/unix"\r?\n', ''

# Replace the SO_REUSEPORT Control block with a plain ListenConfig.
# This only affects how multiple *processes* could share one port (a
# horizontal-scaling optimization) - not used for this single-instance
# deployment, and not part of any auth/session logic.
$pattern = [regex]::new('lc := net\.ListenConfig\{\s*Control: func\(network, address string, c syscall\.RawConn\) error \{.*?\},\s*\}', [System.Text.RegularExpressions.RegexOptions]::Singleline)
$content = $pattern.Replace($content, 'lc := net.ListenConfig{}')

Set-Content -Path $path -Value $content -NoNewline
Write-Host "PATCHED"
