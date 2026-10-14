import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
const recorded: Record<string, unknown>[] = []
vi.mock('@/lib/syslog/record', () => ({
  recordSystemLog: vi.fn(async (i: Record<string, unknown>) => { recorded.push(i) }),
  flushSystemLog: vi.fn(async () => {}),
}))

import { describeConsoleArgs, installConsoleTap, addressForLog, reportFailedCall } from '@/lib/syslog/process'

describe('describeConsoleArgs', () => {
  it('joins the arguments, keeps an Error\'s stack, and ignores lines the structured logger already recorded', () => {
    const err = new Error('auto-close failed')
    const d = describeConsoleArgs(['[csat/run] failed', err, { id: 7 }])!
    expect(d.message).toBe('[csat/run] failed auto-close failed {"id":7}')
    expect(d.stack).toContain('auto-close failed')
    expect(describeConsoleArgs(['{"ts":"2026-10-14T00:00:00Z","level":"error","event":"x"}'])).toBeNull()
    expect(describeConsoleArgs(['{"level":"error","event":"system_log.dropped"}'])).toBeNull()
    expect(describeConsoleArgs([''])).toBeNull()
  })
})

describe('console tap', () => {
  beforeEach(() => { recorded.length = 0 })
  it('stores console.error output in the System Log without changing what is printed, once, and without looping', async () => {
    const printed: unknown[][] = []
    const real = console.error
    console.error = (...a: unknown[]) => { printed.push(a) }
    try {
      installConsoleTap()
      installConsoleTap()                                   // installing twice does not double-record
      console.error('[x] something swallowed', new Error('db down'))
      console.error('{"ts":"t","level":"error","event":"already.logged"}')
    } finally { /* the tap wraps the stub; leave it in place for the assertions */ }
    expect(printed).toHaveLength(2)
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({ category: 'error', source: 'app_server', action: 'console.error' })
    expect(String(recorded[0].message)).toContain('something swallowed db down')
    console.error = real
  })
})

describe('failed calls', () => {
  beforeEach(() => { recorded.length = 0 })
  it('log the address without its query string', () => {
    expect(addressForLog('http://127.0.0.1:55421/rest/v1/requests?select=id&apikey=SECRETKEY')).toBe('127.0.0.1:55421/rest/v1/requests')
    expect(addressForLog('not a url?x=1')).toBe('not a url')
  })
  it('a 500 from the database is recorded, a 200 and an expected "no row" are not', () => {
    reportFailedCall({ url: 'http://h/rest/v1/requests?x=1', method: 'get', status: 500, body: '{"code":"57014","message":"canceling statement due to statement timeout"}' })
    reportFailedCall({ url: 'http://h/rest/v1/requests', method: 'GET', status: 406, body: '{"code":"PGRST116","message":"no rows"}' })
    reportFailedCall({ url: 'http://h/rest/v1/system_log', method: 'POST', status: 500, body: '{}' })
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({ source: 'database', errorCode: '57014', severity: 'error', action: 'database.http_500' })
    expect(String(recorded[0].message)).toBe('GET h/rest/v1/requests -> 500: canceling statement due to statement timeout')
  })
})
