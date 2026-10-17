// Compares two pg_dump -s files statement by statement, ignoring comments, whitespace, the random \restrict token and the "TO authenticated" role clause of policies.
// usage: node schema-diff.cjs <expected.sql> <actual.sql>
const fs = require('fs')
const norm = (f) => fs.readFileSync(f, 'utf8').replace(/\r/g, '').replace(/^\\(un)?restrict.*$/mg, '').split(/;\n/)
  .map((s) => s.replace(/--.*$/mg, '').replace(/\s+/g, ' ').replace(/ TO authenticated /g, ' ').trim()).filter(Boolean)
const a = norm(process.argv[2]), b = norm(process.argv[3])
const A = new Set(a), B = new Set(b)
const oa = a.filter((x) => !B.has(x)), ob = b.filter((x) => !A.has(x))
console.log(`statements only in expected: ${oa.length}; only in actual: ${ob.length}`)
for (const x of oa) console.log('EXPECTED> ' + x.slice(0, 260))
for (const x of ob) console.log('ACTUAL>   ' + x.slice(0, 260))
