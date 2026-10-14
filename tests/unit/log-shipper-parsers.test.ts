// The log shipper's parsers, fed with lines taken from the real PostgREST / Auth / Storage / PostgreSQL containers: only problems become rows,
// ordinary traffic and people's mistakes do not, and nothing sensitive is copied.

import { describe, it, expect } from 'vitest'
import { parsePostgrestLine, parseAuthLine, parseStorageLine, createPostgresParser, createParser, collapseEntries } from '../../scripts/lib/log-parsers.mjs'

type Entry = { source: string; severity: string; action: string; message?: string; errorCode?: string; path?: string; at?: number; detail?: Record<string, unknown>; stack?: string }

describe('PostgREST', () => {
  it('ignores the normal start-up and reload chatter', () => {
    for (const l of [
      '14/Oct/2026:01:26:00 +0000: Schema cache loaded 105 Relations, 94 Relationships, 44 RPCs, 0 Domain Representations, 4 Media Type Handlers, 1196 Timezones',
      '14/Oct/2026:01:26:00 +0000: Received a schema cache reload message on the "pgrst" channel',
      '14/Oct/2026:01:26:00 +0000: Successfully connected to PostgreSQL 17.6 on x86_64-pc-linux-gnu, compiled by gcc (GCC) 15.2.0, 64-bit',
      '14/Oct/2026:01:26:00 +0000: Connection Pool initialized with a maximum size of 10 connections',
      '14/Oct/2026:01:26:00 +0000: Config reloaded',
      '',
    ]) expect(parsePostgrestLine(l)).toBeNull()
  })
  it('turns a failure into a database error with the time from the log line', () => {
    const e = parsePostgrestLine('14/Oct/2026:07:00:00 +0530: Failed to query the database. Retrying.') as Entry
    expect(e).toMatchObject({ source: 'database', severity: 'error', action: 'postgrest.log' })
    expect(e.at).toBe(Date.UTC(2026, 9, 14, 1, 30, 0))
    expect((parsePostgrestLine('14/Oct/2026:01:26:00 +0000: Could not connect to the database: connection refused') as Entry).message).toContain('connection refused')
  })
  it('reads a JSON error object and keeps its PGRST code', () => {
    const e = parsePostgrestLine('{"code":"PGRST002","details":null,"hint":null,"message":"Could not query the database for the schema cache. Retrying."}') as Entry
    expect(e).toMatchObject({ errorCode: 'PGRST002', source: 'database' })
    expect(parsePostgrestLine('{"hello":"world"}')).toBeNull()
  })
})

describe('Supabase Auth', () => {
  it('ignores successful requests and people\'s mistakes (4xx), keeps server faults and error-level lines', () => {
    const ok = '{"component":"api","duration":86523,"level":"info","method":"GET","msg":"request completed","path":"/.well-known/jwks.json","referer":"http://localhost:3310","remote_addr":"172.22.0.1","request_id":"ceaa1ddb-97f2-4449-92a9-b06c5e5c4ffd","status":200,"time":"2026-10-14T01:27:19Z"}'
    expect(parseAuthLine(ok)).toBeNull()
    expect(parseAuthLine(ok.replace('"status":200', '"status":400').replace('"level":"info"', '"level":"error"'))).toBeNull()
    const down = parseAuthLine(ok.replace('"status":200', '"status":500').replace('"msg":"request completed"', '"msg":"500: Database error saving new user"')) as Entry
    expect(down).toMatchObject({ source: 'auth', severity: 'error', errorCode: '500', path: '/.well-known/jwks.json' })
    expect(down.message).toContain('Database error saving new user')
    expect(down.at).toBe(Date.parse('2026-10-14T01:27:19Z'))
    expect(down.detail).not.toHaveProperty('remote_addr')
    expect((parseAuthLine('{"level":"fatal","msg":"could not start","time":"2026-10-14T01:27:19Z"}') as Entry).severity).toBe('critical')
    expect((parseAuthLine('{"level":"warning","msg":"rate limit nearly reached","status":429}') as Entry).severity).toBe('warning')
    expect(parseAuthLine('not json')).toBeNull()
  })
})

describe('Supabase Storage', () => {
  const base = (level: number, status: number, extra = '') => `{"level":${level},"time":"2026-10-13T14:05:48.896Z","type":"request","reqId":"req-2i","req":{"method":"GET","url":"/object/request-attachments/a/b.jpg?token=abc","headers":{"authorization":"Bearer SECRETVALUE","host":"x"}},"res":{"statusCode":${status}},"responseTime":3.8,"error":{"message":"Object not found","errorCode":"NoSuchKey","stack":""},"operation":"storage.object.get"${extra}}`
  it('ignores normal "not found" answers', () => {
    expect(parseStorageLine(base(40, 400))).toBeNull()
    expect(parseStorageLine(base(50, 404))).toBeNull()
    expect(parseStorageLine(base(30, 200))).toBeNull()
  })
  it('records a service failure without copying headers or the query string', () => {
    const e = parseStorageLine(base(50, 500)) as Entry
    expect(e).toMatchObject({ source: 'storage', severity: 'error', errorCode: 'NoSuchKey', path: '/object/request-attachments/a/b.jpg' })
    expect(JSON.stringify(e)).not.toContain('SECRETVALUE')
    expect(JSON.stringify(e)).not.toContain('token=abc')
    expect((parseStorageLine(base(40, 503)) as Entry).source).toBe('storage')
    expect((parseStorageLine(base(60, 500)) as Entry).severity).toBe('critical')
  })
  it('records an error line that has no request attached', () => {
    const e = parseStorageLine('{"level":50,"time":"2026-10-14T00:00:00Z","msg":"S3 bucket unreachable"}') as Entry
    expect(e.message).toBe('S3 bucket unreachable')
  })
})

describe('PostgreSQL', () => {
  const feed = (lines: string[]) => { const p = createPostgresParser(); const out: Entry[] = []; for (const l of lines) out.push(...p.push(l)); out.push(...p.flush()); return out }
  it('turns ERROR lines into rows, with DETAIL and STATEMENT attached, and ignores ordinary LOG lines', () => {
    const out = feed([
      '172.22.0.7 2026-10-14 01:25:01.557 UTC [89360] authenticator@postgres LOG:  connection authorized',
      '172.22.0.7 2026-10-14 01:25:01.557 UTC [89360] authenticator@postgres ERROR:  permission denied for table system_log',
      '172.22.0.7 2026-10-14 01:25:01.557 UTC [89360] authenticator@postgres STATEMENT:  select * from system_log where actor = \'x\'',
      '172.22.0.7 2026-10-14 01:25:05.326 UTC [89454] authenticator@postgres ERROR:  canceling statement due to statement timeout',
    ])
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ source: 'database', severity: 'error', action: 'postgres.error', errorCode: '42501', message: 'permission denied for table system_log' })
    expect(out[0].detail).toMatchObject({ pid: 89360, db_user: 'authenticator', statement: expect.stringContaining('select * from system_log') })
    expect(out[0].at).toBe(Date.UTC(2026, 9, 14, 1, 25, 1, 557))
    expect(out[1].errorCode).toBe('57014')
  })
  it('does not record unique-key clashes (the app relies on them), but records warnings and panics', () => {
    const out = feed([
      '2026-10-14 01:25:01.557 UTC [1] ERROR:  duplicate key value violates unique constraint "requests_pkey"',
      '2026-10-14 01:25:02.000 UTC [1] WARNING:  there is no transaction in progress',
      '2026-10-14 01:25:03.000 UTC [1] PANIC:  could not write to file',
    ])
    expect(out.map((e) => e.severity)).toEqual(['warning', 'critical'])
  })
  it('joins an indented continuation line to the message and survives lines without a client address or user', () => {
    const out = feed(['2026-10-14 06:55:01.000 IST [7] ERROR:  syntax error at or near "selec"', '\tLINE 1: selec 1'])
    expect(out).toHaveLength(1)
    expect(out[0].message).toContain('LINE 1: selec 1')
    expect(out[0].at).toBe(Date.UTC(2026, 9, 14, 1, 25, 1))
    expect(out[0].detail?.db_user).toBeUndefined()
  })
  it('an unknown time-zone name leaves the time to the server', () => {
    expect(feed(['2026-10-14 01:25:01.557 XYZ [7] ERROR:  boom'])[0].at).toBeUndefined()
  })
})

describe('helpers', () => {
  it('createParser rejects an unknown kind and wraps the simple parsers', () => {
    expect(() => createParser('nginx')).toThrow(/Unknown log kind/)
    const p = createParser('postgrest')
    expect(p.push('14/Oct/2026:01:26:00 +0000: Config reloaded')).toEqual([])
    expect(p.push('14/Oct/2026:01:26:00 +0000: connection refused')).toHaveLength(1)
  })
  it('collapses a flood of the same problem into one entry with a count', () => {
    const e = { source: 'database', action: 'postgres.error', errorCode: '57014', message: 'canceling statement due to statement timeout' }
    const out = collapseEntries([{ ...e }, { ...e }, { ...e }, { ...e, message: 'something else' }]) as Entry[]
    expect(out).toHaveLength(2)
    expect(out[0].detail?.repeats).toBe(3)
  })
})
