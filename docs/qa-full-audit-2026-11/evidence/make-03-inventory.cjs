// Generates 03-COMPLETE-FEATURE-INVENTORY.md from evidence/feature-matrix.json + the audit evidence map below.
const fs = require('fs'), path = require('path')
const D = path.join(__dirname, '..')
const m = JSON.parse(fs.readFileSync(path.join(__dirname, 'feature-matrix.json'), 'utf8'))
const ev = {
  '01': 'Smoke; UI K01-K04; DAST S03-S06; UAT login in every scenario',
  '02': 'UI sweep (admin/users 6 widths); K05 Invite User pop-up; R04 profile-write attacks',
  '03': 'DAST S10-S12, R01-R04, R06 (multi-organisation); persona matrix in every UAT',
  '04': 'UI sweep (Home, 9 personas); load test; screenshots',
  '05': 'UAT A (store AC complaint), B (fixtures)',
  '06': 'UI sweep (admin/categories); existing 116 tests',
  '07': 'UAT A/B (form filled through the screen); UI-006 fix',
  '08': 'UAT D; W03 two technicians pick up at once',
  '09': 'UAT A-D (open > assigned > in progress > resolved); existing 220 tests',
  '10': 'UAT C (SLA 80%/100%); W01/W02',
  '11': 'UAT C; W01 conflict + parallel scheduler; W02; W05',
  '12': 'UAT B (CVM approval); public approve links S07; existing 115 tests',
  '13': 'UAT D (comments, attachments); SAST file serving review',
  '14': 'UAT A/C/G (mail to the mail-catcher, WhatsApp webhook); egress evidence',
  '15': 'DAST S14 hostile search; load test /requests?q=; UI sweep',
  '16': 'UI sweep; load test (executive dashboard, analytics); existing 150 tests',
  '17': 'UI sweep only; 30 existing tests',
  '18': 'DAST S07 token pages; UI sweep (rating page)',
  '19': 'UAT D (vendor technician and vendor manager); S12 vendor isolation',
  '20': 'UAT A (AC sheet, store AC complaint)',
  '21': 'UAT D (parts request, PO, approval)',
  '22': 'Code only: module dropped 2026-10-22; 7 legacy tests. NOT RUN in the browser.',
  '23': 'Unit tests only (13). No PMS sheet is configured in the audit stack. NOT RUN in the browser.',
  '24': 'UAT A/B (three sheets loaded); 323 existing tests',
  '25': 'UAT B (CVM approves on the Approvals screen); 178 tests',
  '26': 'UAT E (Zoho overview, reports, look-up, read-only proof, outage)',
  '27': 'UAT F (signed bridge vs stand-in, 18 checks); K11',
  '28': 'UAT C; W01-W05; recovery tests (report 12)',
  '29': 'SOC readiness (report 14); UAT F audit rows',
  '30': 'UI sweep (projects, tasks, intake, weather, profile); data API in UAT F',
}
const lowCoverage = (a) => (a.byLayer.unit + a.byLayer.integration + a.byLayer.remediation + a.byLayer.vapt) < 30
let out = `# 03 — Complete Feature Inventory

## Plain summary
Citykart Desk has **${m.pages} pages**, **${m.apiRoutes} API routes**, **${m.sourceFiles.toLocaleString()} source files**, **${m.testFiles} test files** and **${m.migrations} database migrations**. The directive lists 30 modules; this table maps each one to its code and to the evidence produced in this audit. The counts come from \`evidence/feature-matrix.mjs\` (a scan of the repository on ${m.generated.slice(0, 10)}).

"Tests" are the existing automated tests found for that area (unit / integration / remediation / VAPT). "Audit evidence" is what this audit added or re-ran. A module marked **LOW** has fewer than 30 existing automated tests.

| # | Module | Code files | Lines | Existing tests (u / i / r / v) | Audit evidence in this run | Existing cover |
|---|---|---|---|---|---|---|
`
for (const [k, a] of Object.entries(m.areas)) {
  const n = k.slice(0, 2); const name = k.slice(3)
  out += `| ${n} | ${name} | ${a.codeFiles} | ${a.linesOfCode.toLocaleString()} | ${a.byLayer.unit} / ${a.byLayer.integration} / ${a.byLayer.remediation} / ${a.byLayer.vapt} | ${ev[n] || ''} | ${lowCoverage(a) ? '**LOW**' : 'good'} |\n`
}
out += `
## Notes on the table
- **Page and API route lists** per module are in \`evidence/feature-matrix.json\` (\`sampleCode\` per area) and in report 07 (smoke) and 05 (UI sweep: 63 distinct pages visited).
- **LOW** areas (Requester Home, KB, Field Service Reports, PMS, Zoho, and a few others) carry the highest regression risk for future changes; this audit added browser checks for Home, KB (UI sweep), Zoho (UAT E) but **no new automated tests for FSR or PMS**: they are listed in report 16.
- **Not reachable in the audit stack** (need real outside services): live WhatsApp send, live mail send, Google/Microsoft mailbox sync, DeskTime sync, Google Sheet sync (the three sheets are read from local sample files), real CKOneAI machine, weather service, push notifications. These are marked NOT RUN (outside the isolation) in report 04.
- Module 22 (Field Service Reports / engineer visit) was **dropped by the owner on 2026-10-22**; only leftover code and tests remain.
`
fs.writeFileSync(path.join(D, '03-COMPLETE-FEATURE-INVENTORY.md'), out); console.log('written', out.length)
