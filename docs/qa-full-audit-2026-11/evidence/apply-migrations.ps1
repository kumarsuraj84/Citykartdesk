# Brings the DISPOSABLE audit database up to the migration level of main. Local audit container only.
# Refuses to run against anything but supabase_db_ckdesk_audit. Stops at the first failing migration.
$ErrorActionPreference = 'Stop'
$container = 'supabase_db_ckdesk_audit'
if ($container -notmatch 'ckdesk_audit$') { throw 'wrong container' }
$root = 'D:\ANKUR AI PROJECTS\CitykartDesk-ZOHO Alternate'
$have = [int64](docker exec $container psql -U postgres -d postgres -tAc "select max(version) from supabase_migrations.schema_migrations;")
"database is at $have"
$files = Get-ChildItem "$root\supabase\migrations\*.sql" | Where-Object { [int64]($_.Name -split '_')[0] -gt $have } | Sort-Object Name
"to apply: $($files.Count) migration(s)"
foreach ($f in $files) {
  $ver = ($f.Name -split '_')[0]
  docker cp $f.FullName "${container}:/tmp/m.sql" | Out-Null
  # psql prints harmless NOTICEs on stderr; only its exit code says whether the migration failed
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $out = docker exec $container psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f /tmp/m.sql 2>&1
  $code = $LASTEXITCODE; $ErrorActionPreference = $prev
  if ($code -ne 0) { "FAILED at $($f.Name)"; $out | Select-Object -Last 15; exit 1 }
  docker exec $container psql -U postgres -d postgres -tAc "insert into supabase_migrations.schema_migrations (version) values ('$ver') on conflict do nothing;" | Out-Null
  "applied $($f.Name)"
}
"done: database now at " + (docker exec $container psql -U postgres -d postgres -tAc "select max(version) from supabase_migrations.schema_migrations;")
