// Compares the output of live-readonly/live-readonly-check.sql (run by the owner on the live database) with the rehearsal baseline (migrations 0-163 = what production should have).
// usage: node compare-live-state.cjs <live-state.txt> <state_0163_baseline.txt>
// Prints the INFO lines and every table / function / policy line that differs. Nothing here connects to any server.
const fs = require('fs')
const [live, base] = process.argv.slice(2)
const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r/g, '').split('\n')
const L = read(live), B = read(base)
console.log('--- information from the live database')
L.filter((l) => l.startsWith('INFO|')).forEach((l) => console.log('  ' + l.slice(5)))
const pick = (a) => new Set(a.filter((l) => /^[TFP]\|/.test(l)))
const lv = pick(L), bs = pick(B)
const onlyLive = [...lv].filter((x) => !bs.has(x)), onlyBase = [...bs].filter((x) => !lv.has(x))
console.log(`\n--- rights / policies: live ${lv.size} lines, rehearsal baseline ${bs.size} lines`)
console.log(`    only on live: ${onlyLive.length}   only in baseline: ${onlyBase.length}`)
const kind = { T: 'table', F: 'function', P: 'policy' }
const show = (title, arr) => { if (!arr.length) return; console.log('\n' + title); arr.slice(0, 80).forEach((x) => console.log('  ' + kind[x[0]] + ': ' + x.slice(2, 200))); if (arr.length > 80) console.log(`  ... ${arr.length - 80} more`) }
show('ONLY ON LIVE (live has it, the rehearsal baseline does not):', onlyLive)
show('ONLY IN BASELINE (rehearsal has it, live does not):', onlyBase)
if (!onlyLive.length && !onlyBase.length) console.log('\nRESULT: identical - the live database matches the state the migrations were rehearsed on.')
else console.log('\nRESULT: differences found - explain each one before any migration is applied.')
