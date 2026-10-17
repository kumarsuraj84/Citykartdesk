#!/usr/bin/env bash
# LOCAL ONLY - rehearsal of migrations 164-169 on the DISPOSABLE audit database (container supabase_db_ckdesk_audit).
#   1. rebuild the database from migrations 0-163 (= what production has today), record the baseline
#   2. apply 164..169 one by one, record the privilege + policy state after each
#   3. roll back 169..164 in reverse order; after each rollback the state must equal the state recorded before that migration
#   4. apply 164..169 again; the final state must equal the first final state
# Output: state files and compare results in security-assessment-2026-10/07-FINAL-REMEDIATION/rehearsal/
# It refuses to run unless the container is the audit one. It needs the isolation gate to have passed (run it first through audit-2026-10/guard/run.ps1).
set -u
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/../../.."
C=supabase_db_ckdesk_audit
R=security-assessment-2026-10/07-FINAL-REMEDIATION/rehearsal
PRIVS=$R/privs.sql
[ "$(docker ps --format '{{.Names}}' | grep -c "^$C$")" = "1" ] || { echo "audit database container not running"; exit 2; }
SKIP_RESET="${SKIP_RESET:-0}"
# LIVE_START=1: before migration 164 the table / function rights of the rehearsal database are set to what the LIVE database holds (read-only snapshot, align-to-live.sql),
# so the whole proof is repeated from production's real starting point. Results go to rehearsal/live-start/.
ALIGN=""
if [ "${LIVE_START:-0}" = "1" ]; then ALIGN=$R/align-to-live.sql; R=$R/live-start; mkdir -p $R; cp $ALIGN $R/ 2>/dev/null; fi

state() {
  docker cp $PRIVS $C:/var/tmp/privs.sql >/dev/null
  docker exec $C psql -U postgres -d postgres -q -f /var/tmp/privs.sql > "$1" 2>&1
  # an empty or failed snapshot would make every later comparison meaningless: stop instead of reporting a false IDENTICAL
  [ "$(grep -c '^[TFP]|' "$1")" -gt 300 ] || { echo "FATAL: snapshot $1 holds too few lines (privileges not captured)"; exit 3; }
}
apply() { docker exec -i $C psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$1" 2>&1 | grep -v "^NOTICE\|^$" | tail -3; docker restart supabase_rest_ckdesk_audit >/dev/null; }
mig() { ls supabase/migrations | grep "^20240101000$1" | head -1; }
rbk() { ls supabase/rollback | grep "^$1" | head -1; }
compare() { node -e "
const fs=require('fs');const rd=f=>new Set(fs.readFileSync(f,'utf8').split('\n').filter(l=>/^[TFP]\|/.test(l)).filter(l=>!/_m169_function_grants|_grant_snapshots/.test(l)));
const a=rd('$1'),b=rd('$2');const oa=[...a].filter(x=>!b.has(x)),ob=[...b].filter(x=>!a.has(x));
console.log('   '+(oa.length+ob.length===0?'IDENTICAL':'DIFFERENT')+' (only-expected '+oa.length+', only-actual '+ob.length+')');
for(const x of oa.slice(0,5))console.log('     expected-only:',x.slice(0,160));for(const x of ob.slice(0,5))console.log('     actual-only:  ',x.slice(0,160));"; }

if [ "$SKIP_RESET" != "1" ]; then
  echo "== 1. rebuild baseline (migrations 0-163)"
  npx supabase db reset --workdir audit-2026-10/env 2>&1 | tail -2
  sleep 5
fi
if [ -n "$ALIGN" ]; then echo "== aligning rights to the live database"; apply "$ALIGN"; fi
docker exec $C pg_dump -U postgres -d postgres -s > $R/schema_0163_baseline.sql
state $R/state_0163_baseline.txt
for n in 164 165 166 167 168 169 170 171; do echo "== forward $n"; apply "supabase/migrations/$(mig $n)"; state $R/state_0$n.txt; done
cp $R/state_0171.txt $R/state_final_first.txt

echo "== 3. rollback in reverse order"
prev=(170 169 168 167 166 165 164 163); i=0
for n in 171 170 169 168 167 166 165 164; do
  echo "-- rollback $n"; apply "supabase/rollback/$(rbk $n)"; p=${prev[$i]}; i=$((i+1))
  state $R/rb_after_$n.txt; [ "$p" = "163" ] && exp=$R/state_0163_baseline.txt || exp=$R/state_0$p.txt
  echo "   expected = state before migration $n:"; compare $exp $R/rb_after_$n.txt
done

echo "-- full schema + ACL comparison after the complete rollback (baseline vs rolled back)"
docker exec $C pg_dump -U postgres -d postgres -s > $R/schema_after_full_rollback.sql
node security-assessment-2026-10/07-FINAL-REMEDIATION/tools/schema-diff.cjs $R/schema_0163_baseline.sql $R/schema_after_full_rollback.sql | grep -vE "^(EXPECTED|ACTUAL)> +(GRANT|REVOKE|ALTER DEFAULT)" | tee $R/schema_diff_normalised.txt | cut -c1-200
node security-assessment-2026-10/07-FINAL-REMEDIATION/tools/acl-diff.cjs $R/schema_0163_baseline.sql $R/schema_after_full_rollback.sql > $R/acl_diff_rollback_vs_baseline.txt; tail -1 $R/acl_diff_rollback_vs_baseline.txt; grep -cE "^(TABLE|SEQUENCE)" $R/acl_diff_rollback_vs_baseline.txt | sed "s/^/   table or sequence ACL differences: /"
echo "== 4. re-apply 164-171"
for n in 164 165 166 167 168 169 170 171; do apply "supabase/migrations/$(mig $n)"; done
state $R/state_reapplied.txt
echo "   re-applied final = first final:"; compare $R/state_final_first.txt $R/state_reapplied.txt
