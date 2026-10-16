// Static inventory: which tables does the application write to, and with which kind of database client (the signed-in user's, or the server's own key)?
// Heuristic: for every `<receiver>.from('<table>')` it reads the chained call and looks for insert/update/upsert/delete; the receiver name decides the client kind.
// Output: JSON on stdout { table: { user: [file:line...], admin: [file:line...], unknown: [...] } }
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..', '..', '..')
const dirs = ['lib', 'app', 'components']
const files = []
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) { if (!['node_modules', '.next'].includes(e.name)) walk(p) }
    else if (/\.(ts|tsx)$/.test(e.name)) files.push(p)
  }
}
dirs.forEach((d) => walk(path.join(ROOT, d)))
const out = {}
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  const re = /([A-Za-z_$][\w$.()]*?)\s*\n?\s*\.from\(\s*['"`]([a-z_0-9]+)['"`]\s*\)/g
  let m
  while ((m = re.exec(src))) {
    const recv = m[1], table = m[2]
    const tail = src.slice(m.index + m[0].length, m.index + m[0].length + 900)
    const stop = tail.search(/\n\s*\n|;\s*\n|\n\s*(const|let|if|return|await|for)\s/)
    const chain = stop > 0 ? tail.slice(0, stop) : tail.slice(0, 400)
    const verb = (chain.match(/\.(insert|update|upsert|delete)\(/) || [])[1]
    if (!verb) continue
    const line = src.slice(0, m.index).split('\n').length
    const kind = /admin|service|svc|createAdminClient/i.test(recv) ? 'admin' : /supabase|client|rls|db\b|sb\b|userClient|writeClient|\bc\b/i.test(recv) ? 'user?' : 'unknown'
    out[table] = out[table] || { user: [], admin: [], unknown: [] }
    const rel = path.relative(ROOT, f).replace(/\\/g, '/') + ':' + line + ' ' + verb + ' (' + recv.slice(-24) + ')'
    ;(kind === 'admin' ? out[table].admin : kind === 'user?' ? out[table].user : out[table].unknown).push(rel)
  }
}
console.log(JSON.stringify(out, null, 1))
