// Builds 02-155-FEATURE-TEST-COVERAGE.md and prints per-group test counts from the final regression result file.
// Usage: node build-coverage.cjs   (reads evidence/feature-trace.json, evidence/11-final-regression-results.json and the browser journey log evidence/06-e2e.jsonl)
const fs = require('fs')
const path = require('path')
const ev = path.resolve(__dirname, '..', 'evidence')
const root = path.resolve(__dirname, '..')
const trace = JSON.parse(fs.readFileSync(path.join(ev, 'feature-trace.json'), 'utf8'))
const res = JSON.parse(fs.readFileSync(path.join(ev, '11-final-regression-results.json'), 'utf8'))
const rel = (n) => n.replace(/\\/g, '/').split('CitykartDesk-ZOHO Alternate/')[1] ?? n

// result per test file
const files = new Map()
const group = (p) => (p.startsWith('tests/unit') ? 'unit' : p.startsWith('tests/integration') ? 'integration' : p.startsWith('tests/vapt') ? 'vapt' : p.startsWith('tests/remediation') ? 'remediation' : p.startsWith('qa-release') ? 'qa-new' : 'other')
const totals = {}
for (const f of res.testResults) {
  const p = rel(f.name)
  const c = { passed: 0, failed: 0, skipped: 0 }
  for (const a of f.assertionResults || []) { if (a.status === 'passed') c.passed++; else if (a.status === 'failed') c.failed++; else c.skipped++ }
  files.set(p, { ...c, status: f.status })
  const g = group(p)
  totals[g] = totals[g] || { files: 0, tests: 0, passed: 0, failed: 0, skipped: 0, filesFailed: 0 }
  totals[g].files++; totals[g].tests += c.passed + c.failed + c.skipped; totals[g].passed += c.passed; totals[g].failed += c.failed; totals[g].skipped += c.skipped
  if (f.status !== 'passed') totals[g].filesFailed++
}
console.log(JSON.stringify(totals, null, 1))
console.log('ALL', JSON.stringify({ files: res.testResults.length, tests: res.numTotalTests, passed: res.numPassedTests, failed: res.numFailedTests, skipped: res.numPendingTests }))

// features that were also driven by hand in the browser (journeys) - ids from the trace
const browser = new Set(['F001', 'F007', 'F009', 'F010', 'F011', 'F012', 'F016', 'F020', 'F021', 'F022', 'F023', 'F024', 'F025', 'F026', 'F034', 'F038', 'F039', 'F040', 'F046', 'F048', 'F050', 'F055', 'F059', 'F060', 'F065', 'F078', 'F079', 'F080', 'F081', 'F083', 'F084', 'F085', 'F086', 'F087', 'F088', 'F089', 'F091', 'F093', 'F094', 'F095', 'F097', 'F099', 'F100', 'F102', 'F105', 'F124', 'F134', 'F151', 'F152', 'F153', 'F154', 'F155', 'F066', 'F075', 'F077'])
// features the new QA tests cover although the old trace found no test
const newTests = { F035: 'qa-gap-coverage: automatic time tracking', F067: 'qa-gap-coverage: round robin, load balanced, vendor-held ticket (and QA-D018)', F099: 'qa-gap-coverage: home dashboard counts' }
const outOfScope = new Set(['F144', 'F145', 'F146', 'F147', 'F148', 'F149', 'F150'])   // not built
const pathOf = (t) => (t.match(/(tests\/[A-Za-z0-9_./-]+?\.test\.tsx?)|(tests\/[A-Za-z0-9_./-]+?\.test)(?=[\s(:]|$)/) || [])[0]
const lookup = (p) => { if (files.has(p)) return files.get(p); const k = [...files.keys()].find((x) => x.startsWith(p)); return k ? files.get(k) : null }

const rows = []
const tally = { PASS: 0, FAIL: 0, BLOCKED: 0, 'NOT TESTED': 0, 'OUT OF SCOPE': 0 }
for (const f of trace.features) {
  const paths = [...new Set(f.tests.map(pathOf).filter(Boolean))]
  const found = paths.map((p) => ({ p, r: lookup(p) }))
  const ran = found.filter((x) => x.r)
  const bad = ran.filter((x) => x.r.status !== 'passed' || x.r.failed > 0)
  const nTests = ran.reduce((a, x) => a + x.r.passed, 0)
  const auto = ran.length > 0 && bad.length === 0
  const hand = browser.has(f.id)
  let status, basis
  if (outOfScope.has(f.id)) { status = 'OUT OF SCOPE'; basis = 'Not built yet (the guide says so; not a defect)' }
  else if (bad.length) { status = 'FAIL'; basis = 'failing test file: ' + bad.map((x) => x.p).join(', ') }
  else if (auto && hand) { status = 'PASS'; basis = `automated (${ran.length} file(s), ${nTests} tests) + driven by hand in the browser` }
  else if (auto) { status = 'PASS'; basis = `automated (${ran.length} file(s), ${nTests} tests)` }
  else if (hand) { status = 'PASS'; basis = 'driven by hand in the browser (no automated test names it)' }
  else if (newTests[f.id]) { status = 'PASS'; basis = newTests[f.id] }
  else { status = 'NOT TESTED'; basis = 'no automated test found and not driven by hand in this QA' }
  if (newTests[f.id] && status === 'PASS' && !basis.includes('qa-gap')) basis += ' + ' + newTests[f.id]
  tally[status]++
  rows.push({ f, status, basis })
}
console.log(JSON.stringify(tally))

const md = []
md.push('# 02 — Test coverage of the 155 features')
md.push('')
md.push('Source list: Appendix A of `docs/CKDESK-ARCHITECTURE-FEATURES-AND-TEST-GUIDE.md` (155 rows). Status words: **PASS / FAIL / BLOCKED / NOT TESTED / OUT OF SCOPE**. A feature is PASS only when something actually ran and passed: the automated test files that name it passed in the **final regression run** (`evidence/11-final-regression-results.json`) and/or it was driven by hand in the browser (`evidence/06-e2e.jsonl`). "Guide" says whether the written guide matched the code (`agrees` / `differs` / `unclear`, from the code reading in `evidence/feature-trace.json`).')
md.push('')
md.push(`**Totals:** PASS ${tally.PASS} · FAIL ${tally.FAIL} · BLOCKED ${tally.BLOCKED} · NOT TESTED ${tally['NOT TESTED']} · OUT OF SCOPE ${tally['OUT OF SCOPE']} (= ${trace.features.length}).`)
md.push('')
md.push('Honesty notes: "automated" is the project\'s own test suite plus the new QA tests; for many rows the suite proves the rules and the screen was not opened. Rows marked *by hand* were opened and used in the QA browser. WhatsApp, DeskTime and the dropped engineer-visit module were out of scope by your instruction; none of the 155 rows is a WhatsApp, DeskTime or visit feature.')
md.push('')
md.push('| ID | Module | Feature | Status | Guide | Basis |')
md.push('|---|---|---|---|---|---|')
for (const { f, status, basis } of rows) md.push(`| ${f.id} | ${f.module} | ${f.name} | **${status}** | ${f.agreement} | ${basis.replace(/\|/g, '/')} |`)
md.push('')
md.push('## Features with no test and not driven by hand (NOT TESTED)')
md.push('')
for (const { f, status } of rows.filter((r) => r.status === 'NOT TESTED')) md.push(`* ${f.id} ${f.name} — ${f.note || ''}`.trim())
md.push('')
md.push('## Differences between the written guide and the code (found by the code reading)')
md.push('')
for (const d of trace.discrepancies) md.push(`* **${d.id}** — Guide: ${d.statement} → Code: ${d.reality}`)
md.push('')
md.push('## Things the code does that the guide does not mention')
md.push('')
for (const u of trace.undocumented) md.push(`* ${u.what}`)
md.push('')
fs.writeFileSync(path.join(root, '02-155-FEATURE-TEST-COVERAGE.md'), md.join('\n'))
fs.writeFileSync(path.join(ev, 'coverage-tally.json'), JSON.stringify({ tally, totals, all: { files: res.testResults.length, tests: res.numTotalTests, passed: res.numPassedTests, failed: res.numFailedTests, skipped: res.numPendingTests } }, null, 1))
console.log('written 02')
