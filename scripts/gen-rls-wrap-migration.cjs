// Generates migration 213 (and its rollback) from the READ rules (policies) as they are in a database, so nothing is typed by hand:
// every call of an access helper that is made once per row is turned into a call made once per query.
//   node scripts/gen-rls-wrap-migration.cjs                      (reads the local database in the docker container supabase_db_citykart_desk)
// The same rule text with the same meaning: the helper functions are STABLE (same answer for the whole query), so asking once gives the same result as asking per row.
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const CONTAINER = process.env.PGCONTAINER || 'supabase_db_citykart_desk'
const TABLES = [
  'approvals', 'approval_decisions', 'notifications', 'request_activity', 'request_comments', 'request_attachments', 'request_time_entries', 'request_collaborators',
  'profiles', 'team_members', 'tasks', 'organizations', 'org_module_access', 'stores', 'services', 'teams', 'service_categories', 'service_sub_categories',
  'service_sub_category_tags', 'service_location_tags', 'sla_policies', 'oems', 'locations', 'csat_surveys', 'profile_mobile_numbers',
]
// helpers that take no argument and answer the same for the whole query
const SCALAR = ['auth.uid', 'current_org_id', 'current_user_role', 'is_agent']
const ARRAYS = ['current_user_team_ids', 'current_user_subordinate_ids', 'current_user_collab_request_ids', 'current_user_approver_request_ids', 'current_user_vendor_assignees']

const sql = `select coalesce(json_agg(x order by x.tbl, x.name), '[]') from (
  select c.relname as tbl, pol.polname as name, pol.polcmd as cmd, pol.polpermissive as permissive,
         coalesce((select array_agg(r.rolname order by r.rolname) from pg_roles r where r.oid = any(pol.polroles)), '{}') as roles,
         pol.polroles = '{0}' as is_public,
         pg_get_expr(pol.polqual, pol.polrelid) as qual, pg_get_expr(pol.polwithcheck, pol.polrelid) as check_
  from pg_policy pol join pg_class c on c.oid = pol.polrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and pol.polcmd in ('r', '*') and c.relname = any(array[${TABLES.map((t) => `'${t}'`).join(',')}])
) x`
const out = execFileSync('docker', ['exec', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', sql], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const allPolicies = JSON.parse(out.trim())
// A rule with a sub-query (which the (SELECT fn()) form is) makes PostgreSQL check for "infinite recursion" when the table can lead back to itself through its rules (tasks does: its insert rule looks at tasks).
// For such tables the rules are left exactly as they are.
const { cyc } = require('./rls-cycle-check.cjs')
const skipped = allPolicies.filter((p) => cyc.includes(p.tbl))
const policies = allPolicies.filter((p) => !cyc.includes(p.tbl))

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const NAMES = [...SCALAR, ...ARRAYS].map(esc).join('|')

function transform(expr) {
  if (!expr) return expr
  const keep = []
  const hold = (m) => { keep.push(m); return `@@${keep.length - 1}@@` }
  let s = expr
  // calls that are already made once per query, in any of the shapes the server prints them
  s = s.replace(new RegExp(`\\(\\s*SELECT\\s+(?:${NAMES})\\(\\)\\s+AS\\s+\\w+\\s*\\)`, 'g'), hold)
  // approver / collaborator checks that took the ticket of each row: one list per query, then a look-up in it
  s = s.replace(/is_request_approver\(([^()]+)\)/g, (_, a) => hold(`(${a} = ANY ((SELECT current_user_approver_request_ids())::uuid[]))`))
  s = s.replace(/is_request_collaborator\(([^()]+)\)/g, (_, a) => hold(`(${a} = ANY ((SELECT current_user_collab_request_ids())::uuid[]))`))
  // the no-argument helpers
  s = s.replace(new RegExp(`(?<![\\w.])(${NAMES})\\(\\)`, 'g'), (_, fn) => (ARRAYS.includes(fn) ? `((SELECT ${fn}())::uuid[])` : `(SELECT ${fn}())`))
  // put the held ones back (their own printed shape is fine as it is)
  s = s.replace(/@@(\d+)@@/g, (_, i) => keep[+i])
  return s
}

const cmdWord = { r: 'SELECT', '*': 'ALL' }
const rolesOf = (p) => (p.is_public ? 'public' : p.roles.map((r) => `"${r}"`).join(', '))
function create(p, qual, check) {
  const parts = [`CREATE POLICY "${p.name}" ON public.${p.tbl} AS ${p.permissive ? 'PERMISSIVE' : 'RESTRICTIVE'} FOR ${cmdWord[p.cmd]} TO ${rolesOf(p)}`]
  if (qual) parts.push(`  USING (${qual})`)
  if (check) parts.push(`  WITH CHECK (${check})`)
  return parts.join('\n') + ';'
}

const changed = []
for (const p of policies) {
  const q = transform(p.qual), c = transform(p.check_)
  if (q === p.qual && c === p.check_) continue
  changed.push({ p, q, c })
}

const head = (title, why) => `-- ${title}\n-- ${why}\n`
const migration = [
  head('Migration 213: the access rules of the busiest tables ask their helpers once per query, not once per row',
    'Reading 336 approvals as an ordinary user took about 110 ms because every row asked "who is this / which organisation / which role / which groups / is this person an approver" again. Migration 158 already did this for the tickets table;\n-- this does it for the other busy tables. Every rule below says exactly the same as before (the helpers are STABLE, so one answer per query equals one answer per row); only HOW OFTEN they are asked changes.\n-- The approver / collaborator checks that took each row\'s ticket now take one list per query and look the row up in it (the same sets: see current_user_approver_request_ids / current_user_collab_request_ids).\n-- Each rule is dropped and created again in this one transaction, so there is never a moment without its rule. Nothing about the data, the tables or the application changes.'),
  'BEGIN;\n',
  ...changed.map(({ p, q, c }) => `DROP POLICY IF EXISTS "${p.name}" ON public.${p.tbl};\n${create(p, q, c)}\n`),
  'COMMIT;\n',
].join('\n')

const rollback = [
  head('Rollback of migration 213: puts every access rule back exactly as it was before (the per-row form).', 'Run in the ckdesk database; then restart the data service (CkDeskPostgrest) on 10.0.1.98 so it reloads the schema.'),
  'BEGIN;\n',
  ...changed.map(({ p }) => `DROP POLICY IF EXISTS "${p.name}" ON public.${p.tbl};\n${create(p, p.qual, p.check_)}\n`),
  'COMMIT;\n',
].join('\n')

const mig = path.join(__dirname, '..', 'supabase', 'migrations', '20240101000213_wrap_rls_helper_calls.sql')
const rb = path.join(__dirname, '..', 'supabase', 'production', 'rollback-ckdesk-migration-213.sql')
fs.writeFileSync(mig, migration.replace(/\r?\n/g, '\r\n'))
fs.writeFileSync(rb, rollback.replace(/\r?\n/g, '\r\n'))
console.log(`policies read: ${allPolicies.length}; left alone because their table can lead back to itself: ${skipped.map((p) => p.tbl + '.' + p.name).join(', ') || 'none'}; rewritten: ${changed.length}`)
for (const { p } of changed) console.log(`  ${p.tbl}.${p.name} (${p.cmd})`)
console.log('wrote', mig, 'and', rb)
