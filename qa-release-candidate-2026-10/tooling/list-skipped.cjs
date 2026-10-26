// Lists every skipped / todo test of a vitest json result file with its file.
const fs = require('fs')
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const rel = (n) => n.replace(/\\/g, '/').split('CitykartDesk-ZOHO Alternate/')[1] ?? n
let n = 0
for (const f of r.testResults) for (const a of f.assertionResults || []) if (a.status !== 'passed' && a.status !== 'failed') { n++; console.log(`${a.status}\t${rel(f.name)}\t${a.fullName}`) }
console.log('total not passed/failed:', n)
