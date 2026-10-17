// Compares the GRANT lines of two pg_dump -s files as privilege sets per object and role, ignoring TRUNCATE / REFERENCES / TRIGGER / MAINTAIN
// (migration 164 revokes those on purpose and its rollback deliberately does not give them back).
const fs = require('fs')
const IGN = new Set(['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'])
const ALL = { TABLE: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'], SEQUENCE: ['SELECT', 'UPDATE', 'USAGE'], FUNCTION: ['EXECUTE'] }
function load(f) {
  const m = {}
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const g = line.match(/^GRANT (.+?) ON (TABLE|SEQUENCE|FUNCTION) (\S+?)(\(.*\))? TO (\S+);$/)
    if (!g) continue
    let privs = g[1].split(',').map((x) => x.trim())
    if (privs.includes('ALL')) privs = ALL[g[2]] || []
    const key = `${g[2]} ${g[3]}${g[4] ? g[4].replace(/\s+/g, ' ') : ''} -> ${g[5]}`
    m[key] = new Set([...(m[key] || []), ...privs.filter((p) => !IGN.has(p))])
  }
  return m
}
const a = load(process.argv[2]), b = load(process.argv[3])
let n = 0
for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
  if (!/-> (anon|authenticated)$/.test(k)) continue
  const x = [...(a[k] || [])].sort().join(','), y = [...(b[k] || [])].sort().join(',')
  if (x !== y) { n++; console.log(`${k}\n   expected: ${x || '(none)'}\n   actual:   ${y || '(none)'}`) }
}
console.log(n === 0 ? 'ACL IDENTICAL for anon and authenticated (ignoring TRUNCATE/REFERENCES/TRIGGER/MAINTAIN)' : `${n} ACL differences`)
