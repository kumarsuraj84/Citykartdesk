#!/usr/bin/env bash
# LOCAL ONLY. Runs one vitest suite through the isolation gate. Cleans leftover synthetic intake channels first and, if the gate fails because of a
# transient connection owned by another program on this PC, waits and retries (up to ~10 minutes). It never bypasses the gate.
# usage: run-suite.sh <logfile> [vitest args...]
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/../../.."
LOG="$1"; shift
PS=powershell; command -v powershell >/dev/null 2>&1 || PS="/c/Windows/SysWOW64/WindowsPowerShell/v1.0/powershell.exe"
for attempt in $(seq 1 20); do
  docker exec supabase_db_ckdesk_audit psql -U postgres -d postgres -tAc "delete from intake_channels where name <> $$Audit placeholder (paused)$$; select owner_delete_org(id) from organizations where id <> $$00000000-0000-0000-0000-000000000001$$" >/dev/null 2>&1
  "$PS" -NoProfile -ExecutionPolicy Bypass -File audit-2026-10/guard/run.ps1 npx vitest run "$@" > "$LOG" 2>&1
  if grep -q "ISOLATION GATE: FAILED" "$LOG"; then echo "gate failed (attempt $attempt): $(sed 's/\x1b\[[0-9;]*m//g' "$LOG" | grep '^FAIL' | cut -c1-200)"; sleep 30; continue; fi
  break
done
sed 's/\x1b\[[0-9;]*m//g' "$LOG" | grep -E "ISOLATION|^ +Test Files|^ +Tests  |^ FAIL " | sort | uniq | head -12
