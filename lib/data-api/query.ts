// Reads one page of an entity of the read-only data API. Always inside ONE organisation, always with the listed columns only, always in a stable order
// (cursor column, then id) so the next page starts exactly after the last row of this one.
import { type EntityDef, type Ctx, type Row, type OrgHop, ENTITIES } from './entities'
import { encodeCursor, type Cursor, isoUtc } from './params'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

const CHUNK = 150
/** The columns that make up a row's key: normally just `id`. An entity whose table has no row id of its own (team_members) is keyed by two columns and shows a synthetic text id "first:second". */
const keyCols = (def: EntityDef): string[] => def.compositeKey ?? ['id']
export const rowId = (def: EntityDef, r: Row): string => (def.compositeKey ? `${r[def.compositeKey[0]]}:${r[def.compositeKey[1]]}` : String(r.id))
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** A cursor for a composite-key entity is "uuid:uuid"; anything else is not one this API gave out. */
export const cursorFitsEntity = (def: EntityDef, after: Cursor | null): boolean => {
  if (!after || !def.compositeKey) return true
  const [a, b, ...rest] = after.id.split(':')
  return rest.length === 0 && UUID.test(a ?? '') && UUID.test(b ?? '')
}
const must = <T,>(res: { data: T | null; error: { message: string } | null }, what: string): T => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`)
  return (res.data ?? []) as T
}

/** The organisation the API serves: DATA_API_ORG_ID, or the only organisation there is. Null = cannot be decided (the API then says so and serves nothing). */
export async function resolveOrgId(db: Db): Promise<string | null> {
  const fromEnv = (process.env.DATA_API_ORG_ID ?? '').trim()
  if (/^[0-9a-f-]{36}$/i.test(fromEnv)) return fromEnv
  const orgs = must<{ id: string }[]>(await db.from('organizations').select('id').limit(3), 'read organisations')
  return orgs.length === 1 ? orgs[0].id : null
}

/** Keeps the rows of the organisation. A table without org_id is followed hop by hop (ticket -> organisation) with one lookup per hop for the whole page. */
async function inOrg(db: Db, orgId: string, hops: OrgHop[], rows: Row[]): Promise<Row[]> {
  let current: (string | null)[] = rows.map((r) => (r[hops[0].column] as string | null) ?? null)
  for (let h = 0; h < hops.length; h++) {
    const hop = hops[h]
    const ids = [...new Set(current.filter((v): v is string => !!v))]
    const next = new Map<string, string | null>()
    for (let i = 0; i < ids.length; i += CHUNK) {
      const data = must<Row[]>(await db.from(hop.table).select(`id, ${hop.carry}`).in('id', ids.slice(i, i + CHUNK)), `read ${hop.table}`)
      for (const d of data) next.set(String(d.id), (d[hop.carry] as string | null) ?? null)
    }
    current = current.map((v) => (v ? (next.get(v) ?? null) : null))
  }
  return rows.filter((_, i) => current[i] === orgId)
}

async function buildCtx(db: Db, orgId: string, def: EntityDef, rows: Row[]): Promise<Ctx> {
  const ctx: Ctx = { storeOfProfile: new Map(), storeCode: new Map() }
  if (!def.needsStoreOfProfile && !def.needsStoreCode) return ctx
  const stores = must<{ id: string; code: string }[]>(await db.from('stores').select('id, code').eq('org_id', orgId).limit(5000), 'read stores')
  for (const s of stores) ctx.storeCode.set(s.id, s.code)
  if (def.needsStoreOfProfile) {
    const ids = [...new Set(rows.flatMap((r) => def.needsStoreOfProfile!.profileColumns.map((c) => r[c] as string | null)).filter((v): v is string => !!v))]
    for (let i = 0; i < ids.length; i += CHUNK) {
      const ps = must<{ id: string; store_id: string | null }[]>(await db.from('profiles').select('id, store_id').in('id', ids.slice(i, i + CHUNK)), 'read profiles')
      for (const p of ps) if (p.store_id && ctx.storeCode.has(p.store_id)) ctx.storeOfProfile.set(p.id, ctx.storeCode.get(p.store_id)!)
    }
  }
  return ctx
}

export type Page = { rows: Row[]; next_after: string | null; count: number; has_more: boolean; max_cursor: string | null }

function baseQuery(db: Db, orgId: string, def: EntityDef, columns: string[], opts?: { count: 'exact'; head: true }) {
  let q = opts ? db.from(def.table).select(columns.join(', '), opts) : db.from(def.table).select(columns.join(', '))
  if (def.org === 'direct') q = q.eq('org_id', orgId)
  if (def.where) q = q.eq(def.where.column, def.where.value)
  return q
}

/** `after` for the keyset: rows strictly after (cursor, id). Values were checked by decodeCursor, and are quoted for the filter. */
function applyAfter(q: any, def: EntityDef, after: Cursor | null) { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!after) return q
  if (def.compositeKey) {
    const [a, b] = after.id.split(':')
    const [k0, k1] = def.compositeKey
    return q.or(`${k0}.gt."${a}",and(${k0}.eq."${a}",${k1}.gt."${b}")`)
  }
  if (def.cursor === 'id') return q.gt('id', after.id)
  if (after.t === null) return q.gt('id', after.id)
  return q.or(`${def.cursor}.gt."${after.t}",and(${def.cursor}.eq."${after.t}",id.gt."${after.id}")`)
}

/**
 * The database layer may cut an answer short (its own max-rows setting, 1000 by default) without saying so. A short answer is therefore checked against the number of rows that
 * match: when more match than came back the page was cut, and the caller must continue from its last row (never read "fewer than asked" as "that was the end").
 */
async function reachedEnd(count: () => Promise<number | null>, got: number): Promise<boolean> {
  if (got === 0) return true
  const total = await count()
  return total === null || total <= got
}

export async function readPage(db: Db, orgId: string, def: EntityDef, p: { limit: number; since: string | null; after: Cursor | null }): Promise<Page> {
  const filtered = (cols: string[], opts?: { count: 'exact'; head: true }) => {
    let f = baseQuery(db, orgId, def, cols, opts)
    if (p.since && def.cursor !== 'id') f = f.gte(def.cursor, p.since)
    return applyAfter(f, def, p.after)
  }
  let q = filtered(def.compositeKey ? [...def.compositeKey, ...def.select] : [...new Set(['id', def.cursor, ...def.select])])
  q = def.compositeKey ? q.order(def.compositeKey[0], { ascending: true }).order(def.compositeKey[1], { ascending: true })
    : def.cursor === 'id' ? q.order('id', { ascending: true }) : q.order(def.cursor, { ascending: true }).order('id', { ascending: true })
  const raw = must<Row[]>(await q.limit(p.limit + 1), `read ${def.name}`)
  let hasMore = raw.length > p.limit
  const page = hasMore ? raw.slice(0, p.limit) : raw
  if (!hasMore && !(await reachedEnd(async () => (await filtered([keyCols(def)[0]], { count: 'exact', head: true })).count ?? null, raw.length))) hasMore = true
  const last = page[page.length - 1]
  // the next page continues after the last row READ, even when some rows of it are left out below (other organisation)
  const next = hasMore && last ? encodeCursor({ t: def.cursor === 'id' ? null : String(last[def.cursor]), id: rowId(def, last) }) : null
  const kept = def.org === 'direct' ? page : await inOrg(db, orgId, def.org, page)
  const ctx = await buildCtx(db, orgId, def, kept)
  const maxCursor = last ? (def.cursor === 'id' ? null : isoUtc(last[def.cursor])) : null
  return { rows: kept.map((r) => def.map(r, ctx)), next_after: next, count: kept.length, has_more: hasMore, max_cursor: maxCursor }
}

/** Every id (and its change date) of the entity, in pages, so the platform can find what was deleted since it last looked. */
export async function readIds(db: Db, orgId: string, def: EntityDef, p: { limit: number; after: Cursor | null }): Promise<{ rows: { id: string; cursor_value: string | null }[]; next_after: string | null; count: number }> {
  const cols = [...new Set([...keyCols(def), ...(def.compositeKey ? [] : [def.cursor]), ...(def.org === 'direct' ? [] : [def.org[0].column])])]
  const filtered = (opts?: { count: 'exact'; head: true }) => { const f = baseQuery(db, orgId, def, opts ? [keyCols(def)[0]] : cols, opts); return p.after ? (def.compositeKey ? applyAfter(f, def, p.after) : f.gt('id', p.after.id)) : f }
  const ordered = (q: any) => (def.compositeKey ? q.order(def.compositeKey[0], { ascending: true }).order(def.compositeKey[1], { ascending: true }) : q.order('id', { ascending: true })) // eslint-disable-line @typescript-eslint/no-explicit-any
  const raw = must<Row[]>(await ordered(filtered()).limit(p.limit + 1), `read ${def.name} ids`)
  let hasMore = raw.length > p.limit
  const page = hasMore ? raw.slice(0, p.limit) : raw
  if (!hasMore && !(await reachedEnd(async () => (await filtered({ count: 'exact', head: true })).count ?? null, raw.length))) hasMore = true
  const last = page[page.length - 1]
  const kept = def.org === 'direct' ? page : await inOrg(db, orgId, def.org, page)
  return {
    rows: kept.map((r) => ({ id: rowId(def, r), cursor_value: def.cursor === 'id' ? null : isoUtc(r[def.cursor]) })),
    next_after: hasMore && last ? encodeCursor({ t: null, id: rowId(def, last) }) : null,
    count: kept.length,
  }
}

/** Row count and newest change date of each entity, so the platform can check its copy against CKDesk. For a table that has no org_id of its own the count is of the whole table. */
export async function readMeta(db: Db, orgId: string) {
  const out = []
  for (const def of ENTITIES) {
    let cq = db.from(def.table).select(keyCols(def)[0], { count: 'exact', head: true })
    if (def.org === 'direct') cq = cq.eq('org_id', orgId)
    if (def.where) cq = cq.eq(def.where.column, def.where.value)
    const { count, error } = await cq
    if (error) throw new Error(`count ${def.name}: ${error.message}`)
    let maxCursor: string | null = null
    if (def.cursor !== 'id') {
      let mq = db.from(def.table).select(def.cursor)
      if (def.org === 'direct') mq = mq.eq('org_id', orgId)
      if (def.where) mq = mq.eq(def.where.column, def.where.value)
      const { data } = await mq.order(def.cursor, { ascending: false }).limit(1)
      maxCursor = data?.[0] ? isoUtc(data[0][def.cursor]) : null
    }
    out.push({
      name: def.name, description: def.description, mode: def.mode, key: 'id', cursor: def.cursor === 'id' ? null : def.cursor,
      count: count ?? 0, count_scope: def.org === 'direct' ? 'organisation' : 'table', max_cursor: maxCursor, columns: def.columns,
    })
  }
  return out
}
