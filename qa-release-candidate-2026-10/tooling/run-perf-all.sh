#!/usr/bin/env bash
# QA performance campaign (local only, isolated audit database, synthetic data). Measures the same operations at three data sizes:
#   about 3,300 tickets (what the QA seed holds), 100,000 and 500,000 tickets, each through the project's own scale test and the QA workflow test.
# Usage: bash qa-release-candidate-2026-10/tooling/run-perf-all.sh   (writes logs to qa-release-candidate-2026-10/evidence/perf/)
set -uo pipefail
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/../.."
OUT=qa-release-candidate-2026-10/evidence/perf
mkdir -p "$OUT"
DB=supabase_db_ckdesk_audit
cnt() { docker exec "$DB" psql -U postgres -d postgres -tAc "select count(*) from requests"; }
one() {
  local label="$1"
  echo "=== $label: $(cnt) tickets, $(docker exec $DB psql -U postgres -d postgres -tAc "select pg_size_pretty(pg_database_size('postgres'))") database ===" | tee -a "$OUT/campaign.log"
  PERF_LABEL="qa-$label" bash security-assessment-2026-10/07-FINAL-REMEDIATION/tools/run-suite.sh "$OUT/scale-$label.log" --config qa-release-candidate-2026-10/tooling/vitest.qa.config.ts tests/vapt/91-performance-scale.test.ts | tee -a "$OUT/campaign.log"
  PERF_LABEL="qa-$label" bash security-assessment-2026-10/07-FINAL-REMEDIATION/tools/run-suite.sh "$OUT/workflows-$label.log" --config qa-release-candidate-2026-10/tooling/vitest.qa.config.ts qa-release-candidate-2026-10/tests/qa-perf-workflows.test.ts | tee -a "$OUT/campaign.log"
  cp security-assessment-2026-10/07-FINAL-REMEDIATION/perf/perf-qa-$label.json "$OUT/" 2>/dev/null || true
}
one 3k
bash qa-release-candidate-2026-10/tooling/gen-perf-data.sh 100000 | tee -a "$OUT/campaign.log"
one 100k
bash qa-release-candidate-2026-10/tooling/gen-perf-data.sh 500000 | tee -a "$OUT/campaign.log"
one 500k
echo "=== campaign finished $(date) ===" | tee -a "$OUT/campaign.log"
