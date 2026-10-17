// Builds 02-COMPLETE-FINDING-CLOSURE-MATRIX.md: exactly the 70 rows of the master register, with the FINAL status from tools/closure-data.cjs.
const fs = require('fs'), path = require('path')
const root = path.resolve(__dirname, '..', '..')
const reg = fs.readFileSync(path.join(root, '02-VAPT', 'VAPT-MASTER-REGISTER.md'), 'utf8').split('\n').filter((l) => /^\| \*\*VAPT-/.test(l))
const data = require('./closure-data.cjs')
const NAME = { F: 'Fixed', P: 'Partially Fixed', D: 'Requires Decision', NV: 'Not Verified' }
const clean = (s) => s.replace(/\*\*/g, '').replace(/<br>.*$/, '').trim()
const rows = reg.map((l) => {
  const c = l.split('|').map((x) => x.trim())
  return { id: clean(c[1]), sev: clean(c[2]).split(/[ (]/)[0], module: clean(c[4]), title: clean(c[5]), earlier: clean(c[14]) }
})
const missing = rows.filter((r) => !data[r.id]).map((r) => r.id)
const extra = Object.keys(data).filter((k) => !rows.find((r) => r.id === k))
if (rows.length !== 70 || missing.length || extra.length) throw new Error(`register rows ${rows.length}, missing ${missing}, extra ${extra}`)
const cnt = {}; for (const r of rows) cnt[data[r.id].st] = (cnt[data[r.id].st] || 0) + 1
const sev = {}; for (const r of rows) { const k = r.sev + '/' + NAME[data[r.id].st]; sev[k] = (sev[k] || 0) + 1 }
const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')
let o = `# 02 — Complete finding closure matrix (final)\n\nLOCAL ONLY. Basis: the 70 rows of \`02-VAPT/VAPT-MASTER-REGISTER.md\`. A finding is marked **Fixed** only when a test that fails on the old behaviour (or a code/catalog proof where a live test is impossible, stated in the residual column) passes on the isolated audit stack. Evidence classes: A = reproduced before / blocked after on the isolated stack, B = proven by test of the new behaviour, C = code or catalogue proof, D = needs an action in production, E = needs an organisational decision or evidence.\n\n## Totals\n\n| Final status | Count |\n|---|---|\n`
for (const k of ['F', 'P', 'D', 'NV']) o += `| ${NAME[k]} | ${cnt[k] || 0} |\n`
o += `| **Total** | **${rows.length}** |\n| Open | 0 |\n\nBy original severity and final status:\n\n| Severity / status | Count |\n|---|---|\n`
for (const k of Object.keys(sev).sort()) o += `| ${k} | ${sev[k]} |\n`
o += `\nTest legend: T10/T11/T12 = \`tests/vapt/10,11,12\`; v20…v30 = \`tests/vapt/20…30\`; r<NN> = \`tests/remediation/<NN>-*\`; u:<name> = \`tests/unit/<name>\`. HTTP probes H1–H7 are recorded in \`02-VAPT/HTTP-PROBE-CAPTURES.md\`.\n\n## The 70 findings\n\n| # | ID | Original severity | Module | Finding | Earlier status | **Final status** | Fix and code reference | Migration | Test reference | Production action before it takes effect | Residual risk |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n`
rows.forEach((r, i) => {
  const d = data[r.id]
  o += `| ${i + 1} | ${r.id} | ${r.sev} | ${esc(r.module)} | ${esc(r.title)} | ${esc(r.earlier)} | **${NAME[d.st]}** | ${esc(d.fix)} (${esc(d.files)}) | ${d.mig} | ${esc(d.tests)} | ${esc(d.prod)} | ${esc(d.residual)} |\n`
})
fs.writeFileSync(path.join(root, '07-FINAL-REMEDIATION', '02-COMPLETE-FINDING-CLOSURE-MATRIX.md'), o + '\n' + fs.readFileSync(path.join(__dirname, 'new-findings.md'), 'utf8'))
console.log('written', rows.length, cnt)
