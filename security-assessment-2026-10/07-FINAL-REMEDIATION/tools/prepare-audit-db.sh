#!/usr/bin/env bash
# LOCAL ONLY. Rebuilds the DISPOSABLE audit database from migrations 0-163, applies 164-169 (via the rehearsal script), then loads the synthetic data and the
# fixtures the test suites expect. Takes a few minutes. Re-run it whenever a failed run has left test data behind.
set -u
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/../../.."
C=supabase_db_ckdesk_audit
bash security-assessment-2026-10/07-FINAL-REMEDIATION/tools/rehearse-migrations.sh > security-assessment-2026-10/07-FINAL-REMEDIATION/rehearsal/rehearsal-latest.log 2>&1
grep -E "IDENTICAL|DIFFERENT|ERROR" security-assessment-2026-10/07-FINAL-REMEDIATION/rehearsal/rehearsal-latest.log | sort | uniq -c
docker exec -i $C psql -U postgres -d postgres -v n_tickets=3000 -v ON_ERROR_STOP=1 -f - < audit-2026-10/seed/synthetic-seed.sql > /dev/null 2>&1 && echo "seed ok"
docker exec -i $C psql -U postgres -d postgres -v n=250 -v ON_ERROR_STOP=1 -f - < audit-2026-10/seed/bulk-tickets.sql > /dev/null 2>&1 && echo "bulk ok"
docker exec $C psql -U postgres -d postgres -tAc "update org_module_access set enabled=true where module='intake'; update requests set resolved_at = least(resolved_at, now()), closed_at = least(closed_at, now()) where resolved_at > now() or closed_at > now(); insert into intake_channels (org_id, type, name, status) values ('00000000-0000-0000-0000-000000000001','email','Audit placeholder (paused)','paused') on conflict do nothing;" > /dev/null
docker restart supabase_rest_ckdesk_audit supabase_auth_ckdesk_audit > /dev/null; sleep 6; docker restart supabase_kong_ckdesk_audit > /dev/null; sleep 8
curl -s -o /dev/null -w "auth via gateway: %{http_code}\n" http://127.0.0.1:55421/auth/v1/health
