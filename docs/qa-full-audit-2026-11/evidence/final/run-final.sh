cd "D:/ANKUR AI PROJECTS/CitykartDesk-ZOHO Alternate"
F=docs/qa-full-audit-2026-11/evidence/final
: > $F/summary.txt
R="powershell -NoProfile -File audit-2026-10/guard/run.ps1 --"
st(){ n=$1; shift; s=$(date +%s); $R "$@" > $F/$n.log 2>&1; echo "$n exit=$? sec=$(( $(date +%s)-s ))" >> $F/summary.txt; }
st tsc node node_modules/typescript/lib/tsc.js --noEmit
st eslint node node_modules/eslint/bin/eslint.js app lib components types proxy.ts instrumentation.ts next.config.ts scripts
st main npx vitest run --reporter=json --outputFile=$F/main.json
st remediation npx vitest run -c vitest.remediation.config.ts --reporter=json --outputFile=$F/remediation.json
st vapt npx vitest run -c vitest.vapt.config.ts --reporter=json --outputFile=$F/vapt.json
echo DONE >> $F/summary.txt
