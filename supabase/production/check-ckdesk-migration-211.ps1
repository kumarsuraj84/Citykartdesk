# Citykart Desk - READ-ONLY check of migration 211 on the database server 10.0.0.205 (changes nothing).
# Shows the exact text of the two UPDATE rules and the two triggers, so they can be compared with what migration 211 should have made.
# You type the postgres password when asked; it is never stored.
$ErrorActionPreference = 'Stop'
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
$psql = "$pgBin\psql.exe"
if (-not (Test-Path $psql)) { throw "PostgreSQL tools not found in $pgBin - edit `$pgBin at the top of this script." }
$secure = Read-Host 'postgres password (typed here, not saved)' -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
try {
  Write-Host "`nThe UPDATE rules (policies) of the two tables:" -ForegroundColor Cyan
  & $psql -U postgres -h localhost -d ckdesk -x -c "SELECT tablename, policyname, roles, cmd, qual, with_check FROM pg_policies WHERE tablename IN ('request_time_entries','csat_surveys') AND cmd IN ('UPDATE','ALL') ORDER BY tablename, policyname;"
  Write-Host "`nThe two protection triggers:" -ForegroundColor Cyan
  & $psql -U postgres -h localhost -d ckdesk -c "SELECT tgrelid::regclass AS on_table, tgname, tgenabled FROM pg_trigger WHERE tgname IN ('trg_time_entry_request_unchanged','trg_csat_request_unchanged') AND NOT tgisinternal;"
  Write-Host "`nHow auth.uid() is defined here (so the rule text can be read correctly):" -ForegroundColor Cyan
  & $psql -U postgres -h localhost -d ckdesk -t -c "SELECT pg_get_functiondef('auth.uid()'::regprocedure);"
  Write-Host "`nDone (nothing was changed). Copy everything above and send it to Claude." -ForegroundColor Green
}
finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}
