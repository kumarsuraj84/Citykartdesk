# OPTIONAL belt-and-braces for the CKDesk audit — NOT run by the audit. Review, then run in an ELEVATED PowerShell on the dev PC (10.0.0.47).
# Adds outbound BLOCK rules for the production machines (and the retired Main server) so no program on this PC can reach them while auditing.
# This only changes this PC's own firewall. Remove with:  .\windows-firewall-block.ps1 -Remove
param([switch]$Remove)
$name = 'CKDESK-AUDIT-BLOCK-PRODUCTION'
$addresses = '10.0.1.98', '10.0.0.205', '10.0.0.25', '10.0.1.12'   # 182.72.84.10 (public IP) is deliberately NOT blocked: it would also block your own browsing of the live site
if ($Remove) { Get-NetFirewallRule -DisplayName "$name*" -ErrorAction SilentlyContinue | Remove-NetFirewallRule; 'removed'; return }
foreach ($a in $addresses) {
  New-NetFirewallRule -DisplayName "$name $a" -Direction Outbound -Action Block -RemoteAddress $a -Profile Any | Out-Null
}
'blocked outbound to: ' + ($addresses -join ', ')
