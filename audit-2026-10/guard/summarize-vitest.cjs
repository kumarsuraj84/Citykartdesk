// node summarize-vitest.cjs <vitest-json>  — prints totals and every failing test with its first error line
const j = require(require('path').resolve(process.argv[2]))
console.log(JSON.stringify({ files: j.testResults.length, total: j.numTotalTests, passed: j.numPassedTests, failed: j.numFailedTests, skipped: j.numPendingTests + (j.numTodoTests || 0), suitesFailed: j.numFailedTestSuites }))
for (const f of j.testResults) {
  const bad = f.assertionResults.filter((a) => a.status === 'failed')
  if (f.status !== 'passed' || bad.length) {
    console.log('\n## ' + f.name.split('Alternate')[1], f.status, (f.message || '').slice(0, 200).replace(/\s+/g, ' '))
    for (const a of bad) console.log('  FAIL:', a.fullName.slice(0, 120), '|', (a.failureMessages[0] || '').split('\n')[0].slice(0, 220))
  }
}
