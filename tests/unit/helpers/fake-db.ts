// A small in-memory stand-in for the database client, for unit tests that must not touch a database or the network. It understands the query shapes the
// code under test uses (select / insert / update / delete / upsert with eq, neq, in, is, not, gt, gte, lt, lte, ilike, order, limit, range, single,
// maybeSingle) and anything else throws, so a test never passes by accident on a query the fake silently ignored.
//
// Failures are injected per call with `fail`, e.g. fail: (op) => op.table === 'x' && op.kind === 'insert' ? { message: 'boom', code: '23505' } : undefined.

export type Row = Record<string, unknown>
export type DbError = { message: string; code?: string }
export interface Op { table: string; kind: 'select' | 'insert' | 'update' | 'delete' | 'upsert'; payload?: unknown; filters: { col: string; op: string; val: unknown }[] }

export interface FakeDbOptions {
  /** return an error to make this call fail instead of running */
  fail?: (op: Op) => DbError | undefined
  /** called for every rpc(name, args); the return value is used as { data } */
  rpc?: (name: string, args: Record<string, unknown>) => unknown
}

let idCounter = 0

function getPath(row: Row, col: string): unknown {
  // supports "a->>b" (json text) as used by the code under test
  const m = /^(\w+)->>(\w+)$/.exec(col)
  if (m) {
    const obj = row[m[1]] as Row | null | undefined
    const v = obj ? obj[m[2]] : undefined
    return v === undefined || v === null ? null : String(v)
  }
  return row[col]
}

function matches(row: Row, f: { col: string; op: string; val: unknown }): boolean {
  const v = getPath(row, f.col)
  switch (f.op) {
    case 'eq': return v === f.val || (v == null && f.val == null)
    case 'neq': return v !== f.val
    case 'in': return (f.val as unknown[]).includes(v)
    case 'is': return f.val === null ? v == null : v === f.val
    case 'not_is': return f.val === null ? v != null : v !== f.val
    case 'gt': return (v as number | string) > (f.val as number | string)
    case 'gte': return (v as number | string) >= (f.val as number | string)
    case 'lt': return (v as number | string) < (f.val as number | string)
    case 'lte': return (v as number | string) <= (f.val as number | string)
    case 'ilike': {
      const re = new RegExp('^' + String(f.val).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '[\\s\\S]*') + '$', 'i')
      return re.test(String(v ?? ''))
    }
    default: throw new Error('fake-db: unsupported filter ' + f.op)
  }
}

export function fakeDb(seed: Record<string, Row[]> = {}, options: FakeDbOptions = {}) {
  const tables: Record<string, Row[]> = {}
  for (const [t, rows] of Object.entries(seed)) tables[t] = rows.map((r) => ({ ...r }))
  const log: Op[] = []
  const rows = (t: string) => (tables[t] ??= [])

  function builder(table: string) {
    const op: Op = { table, kind: 'select', filters: [] }
    let returning = false
    let single: 'single' | 'maybe' | null = null
    let orderBy: { col: string; asc: boolean } | null = null
    let limitN: number | null = null
    let range: [number, number] | null = null
    let head = false
    let count = false
    let onConflict: string[] | null = null

    const exec = (): { data: unknown; error: DbError | null; count?: number } => {
      log.push({ ...op, filters: [...op.filters] })
      const injected = options.fail?.(op)
      if (injected) return { data: null, error: injected }
      const all = rows(table)
      const hit = () => all.filter((r) => op.filters.every((f) => matches(r, f)))
      let result: Row[] = []
      if (op.kind === 'insert') {
        const payload = (Array.isArray(op.payload) ? op.payload : [op.payload]) as Row[]
        for (const p of payload) {
          result.push({ id: `fake-${++idCounter}`, ...p })
          all.push(result[result.length - 1])
        }
      } else if (op.kind === 'upsert') {
        const payload = (Array.isArray(op.payload) ? op.payload : [op.payload]) as Row[]
        for (const p of payload) {
          const existing = onConflict ? all.find((r) => onConflict!.every((c) => r[c] === p[c])) : undefined
          if (existing) { Object.assign(existing, p); result.push(existing) } else { const n = { id: `fake-${++idCounter}`, ...p }; all.push(n); result.push(n) }
        }
      } else if (op.kind === 'update') {
        result = hit()
        for (const r of result) Object.assign(r, op.payload as Row)
      } else if (op.kind === 'delete') {
        result = hit()
        tables[table] = all.filter((r) => !result.includes(r))
      } else {
        result = hit()
      }
      if (op.kind === 'select' || returning) {
        if (orderBy) { const { col, asc } = orderBy; result = [...result].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1)) }
        if (range) result = result.slice(range[0], range[1] + 1)
        if (limitN != null) result = result.slice(0, limitN)
      }
      const total = result.length
      const out = (op.kind === 'select' || returning) ? result.map((r) => ({ ...r })) : null
      if (single === 'single') {
        if (!out || out.length !== 1) return { data: null, error: { message: 'single row expected', code: 'PGRST116' } }
        return { data: out[0], error: null }
      }
      if (single === 'maybe') return { data: out && out.length > 0 ? out[0] : null, error: null }
      if (head) return { data: null, error: null, count: total }
      return { data: out, error: null, ...(count ? { count: total } : {}) }
    }

    const b: Record<string, unknown> = {
      select: (_cols?: string, o?: { count?: string; head?: boolean }) => { if (op.kind !== 'select') returning = true; if (o?.head) head = true; if (o?.count) count = true; return b },
      insert: (payload: unknown) => { op.kind = 'insert'; op.payload = payload; return b },
      upsert: (payload: unknown, o?: { onConflict?: string }) => { op.kind = 'upsert'; op.payload = payload; onConflict = o?.onConflict ? o.onConflict.split(',').map((s) => s.trim()) : null; return b },
      update: (payload: unknown) => { op.kind = 'update'; op.payload = payload; return b },
      delete: () => { op.kind = 'delete'; return b },
      eq: (col: string, val: unknown) => { op.filters.push({ col, op: 'eq', val }); return b },
      neq: (col: string, val: unknown) => { op.filters.push({ col, op: 'neq', val }); return b },
      in: (col: string, val: unknown[]) => { op.filters.push({ col, op: 'in', val }); return b },
      is: (col: string, val: unknown) => { op.filters.push({ col, op: 'is', val }); return b },
      not: (col: string, o: string, val: unknown) => { if (o !== 'is') throw new Error('fake-db: unsupported not ' + o); op.filters.push({ col, op: 'not_is', val }); return b },
      gt: (col: string, val: unknown) => { op.filters.push({ col, op: 'gt', val }); return b },
      gte: (col: string, val: unknown) => { op.filters.push({ col, op: 'gte', val }); return b },
      lt: (col: string, val: unknown) => { op.filters.push({ col, op: 'lt', val }); return b },
      lte: (col: string, val: unknown) => { op.filters.push({ col, op: 'lte', val }); return b },
      ilike: (col: string, val: unknown) => { op.filters.push({ col, op: 'ilike', val }); return b },
      filter: (col: string, o: string, val: unknown) => { op.filters.push({ col, op: o, val }); return b },
      order: (col: string, o?: { ascending?: boolean }) => { orderBy = orderBy ?? { col, asc: o?.ascending !== false }; return b },
      limit: (n: number) => { limitN = n; return b },
      range: (a: number, z: number) => { range = [a, z]; return b },
      single: () => { single = 'single'; return b },
      maybeSingle: () => { single = 'maybe'; return b },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        try { return Promise.resolve(exec()).then(resolve, reject) } catch (e) { return Promise.reject(e).then(resolve, reject) }
      },
    }
    return b
  }

  return {
    from: (table: string) => builder(table),
    rpc: (name: string, args: Record<string, unknown>) => Promise.resolve({ data: options.rpc ? options.rpc(name, args) : null, error: null }),
    auth: { admin: { listUsers: async () => ({ data: { users: [] } }), getUserById: async () => ({ data: { user: null } }) } },
    tables,
    log,
  }
}

export type FakeDb = ReturnType<typeof fakeDb>
