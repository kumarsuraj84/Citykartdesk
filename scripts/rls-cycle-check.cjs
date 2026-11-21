// Finds the tables whose access rules can lead back to the same table (directly or through other tables).
// Why: PostgreSQL refuses ("infinite recursion detected in policy") when a rule that contains a sub-query - which includes the (SELECT fn()) form - is expanded while its own table is already being expanded.
// A rule WITHOUT a sub-query is never checked, so adding (SELECT ...) to a rule of a table that can reach itself can break writes that worked before.
//   node scripts/rls-cycle-check.cjs                (reads the local database in the docker container supabase_db_citykart_desk)
const { execFileSync } = require('child_process')
const CONTAINER = process.env.PGCONTAINER || 'supabase_db_citykart_desk'
const q = (sql) => JSON.parse(execFileSync('docker', ['exec', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', sql], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim() || '[]')

const tables = new Set(q(`select json_agg(relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')`))
const pols = q(`select json_agg(x) from (select c.relname as tbl, pol.polname as name, pol.polcmd as cmd,
  coalesce(pg_get_expr(pol.polqual, pol.polrelid),'') || ' ' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid),'') as ex
  from pg_policy pol join pg_class c on c.oid=pol.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public') x`)

const refsOf = (ex) => { const s = new Set(); for (const m of ex.matchAll(/\b(?:FROM|JOIN)\s+(?:public\.)?"?(\w+)"?/gi)) if (tables.has(m[1])) s.add(m[1]); return s }
const first = new Map(), further = new Map() // first hop: every policy; further hops: the rules a SELECT of that table uses (r, *)
for (const p of pols) {
  const r = refsOf(p.ex)
  if (!first.has(p.tbl)) first.set(p.tbl, new Set())
  r.forEach((x) => first.get(p.tbl).add(x))
  if (p.cmd === 'r' || p.cmd === '*') { if (!further.has(p.tbl)) further.set(p.tbl, new Set()); r.forEach((x) => further.get(p.tbl).add(x)) }
}
// can table t get back to itself?  start with every rule of t, then follow only the SELECT rules of the tables met
function reachesItself(t) {
  const seen = new Set(), stack = [...(first.get(t) || [])]
  while (stack.length) {
    const u = stack.pop()
    if (u === t) return true
    if (seen.has(u)) continue
    seen.add(u)
    for (const v of further.get(u) || []) stack.push(v)
  }
  return false
}
const cyc = [...tables].filter(reachesItself).sort()
if (require.main === module) {
  console.log('tables whose rules can lead back to the same table (' + cyc.length + '):')
  for (const t of cyc) console.log('  ' + t)
}
module.exports = { cyc, reachesItself }
