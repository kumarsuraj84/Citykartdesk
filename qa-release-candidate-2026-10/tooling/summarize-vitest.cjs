// Summarises a vitest --reporter=json result file: totals, and every failed file / failed test with a short reason.
// Usage: node summarize-vitest.cjs <results.json> [--all]   (--all also lists every file with its pass/fail/skip counts)
const fs = require('fs')
const file = process.argv[2]
const r = JSON.parse(fs.readFileSync(file, 'utf8'))
const rel = (n) => n.replace(/\\/g, '/').split('CitykartDesk-ZOHO Alternate/')[1] ?? n
const sum = { files: r.testResults.length, tests: r.numTotalTests, passed: r.numPassedTests, failed: r.numFailedTests, skipped: r.numPendingTests, todo: r.numTodoTests }
console.log(JSON.stringify(sum))
const bad = r.testResults.filter((f) => f.status !== 'passed')
console.log('files not passed:', bad.length)
for (const f of bad) {
  const fails = (f.assertionResults || []).filter((a) => a.status === 'failed')
  console.log('-', rel(f.name), '| failed tests:', fails.length, '| suite message:', String(f.message || '').slice(0, 220).replace(/\n/g, ' '))
  for (const a of fails.slice(0, 6)) console.log('     *', a.fullName.slice(0, 130), '::', String((a.failureMessages || [])[0] || '').slice(0, 220).replace(/\n/g, ' '))
}
if (process.argv.includes('--all')) {
  for (const f of r.testResults) {
    const c = { passed: 0, failed: 0, skipped: 0 }
    for (const a of f.assertionResults || []) { if (a.status === 'passed') c.passed++; else if (a.status === 'failed') c.failed++; else c.skipped++ }
    console.log(`${f.status === 'passed' ? 'PASS' : 'FAIL'} ${rel(f.name)} p=${c.passed} f=${c.failed} s=${c.skipped}`)
  }
}
