// The copy of a program's Google Sheet, audit hardening (C-07 / C-09 / C-10 / C-20 / C-21 / C-27), on the isolated audit stack. A fake sheet source stands in for Google. NOT run
// by the author of the change.
//  - a sheet with headings but no data rows is refused while the program holds rows (the last good copy stays);
//  - a heading CK Desk reads that appears in two columns stops the copy (the last good copy stays);
//  - a change of where tickets / quotes go (Ticket Mail To, PO Mail To, Quote Approval Mail To) is reported as a warning, the copy is still applied;
//  - the shown text of the sheet (leading zeros, dates as dates) is what is kept for the machine number and the extra details;
//  - a row that did not change is not rewritten, whatever order the database returns the extra details in.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

process.env.SYSTEM_LOG_IN_TESTS = '1'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { syncPrograms } from '@/lib/programs/sync'
import type { SheetsSource } from '@/lib/masters/google'

vi.setConfig({ testTimeout: 180_000 })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
const tag = `t61${String(Date.now()).slice(-6)}`
let fx: D03Fixtures
const A = `${tag}a`.toUpperCase(), B = `${tag}b`.toUpperCase()
const SHEET = `${tag}-sheet-copy-hardening-0`
const raw: Record<string, unknown[][]> = {}
const shown: Record<string, unknown[][]> = {}
const source: SheetsSource = {
  fetchValues: async (id) => { if (!raw[id]) throw new Error('no such sheet'); return raw[id] },
  fetchDisplayValues: async (id) => { if (!shown[id]) throw new Error('no such sheet'); return shown[id] },
}
let programId = ''
const HEAD = ['Store Code', 'Ticket Mail To', 'Machine No', 'Serial No', 'Opening date']
const sync = async () => (await syncPrograms({ db: db(), orgId: fx.orgId, source, force: true, programId }))[0]
const rows = async () => ((await db().from('program_rows').select('id, store_code, machine_no, serial, emails, extra, removed_at, last_seen_at').eq('program_id', programId).order('sheet_row')).data ?? []) as { id: string; store_code: string; machine_no: string | null; serial: string | null; emails: string[]; extra: Record<string, string>; removed_at: string | null; last_seen_at: string }[]
const issues = async () => ((await db().from('program_issues').select('code, message').eq('program_id', programId)).data ?? []) as { code: string; message: string }[]

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const a = db()
  await a.from('stores').insert([{ org_id: fx.orgId, code: A, name: `${tag} A` }, { org_id: fx.orgId, code: B, name: `${tag} B` }])
  programId = (await a.from('vendor_programs').insert({ org_id: fx.orgId, name: 'Copy hardening', slug: `${tag}-copy`, level: 'mail', row_type: 'machine', is_active: false, spreadsheet_id: SHEET }).select('id').single()).data.id as string
  raw[SHEET] = [HEAD, [A, 'old@oem.test', 7, 1234567890123456, 40831], [B, 'b@oem.test', 8, 'S8', 40832]]
  shown[SHEET] = [HEAD, [A, 'old@oem.test', '007', '1234567890123456', '17/10/2011'], [B, 'b@oem.test', '008', 'S8', '18/10/2011']]
}, 300_000)

afterAll(async () => {
  const a = db()
  await a.from('program_issues').delete().eq('program_id', programId)
  await a.from('program_rows').delete().eq('program_id', programId)
  await a.from('vendor_programs').delete().eq('id', programId)
  await a.from('stores').delete().eq('org_id', fx.orgId).in('code', [A, B])
  await fx?.cleanup()
}, 180_000)

describe('the first copy', () => {
  it('keeps the machine number, serial and extra details as the sheet SHOWS them', async () => {
    expect((await sync()).status).toBe('ok')
    const r = await rows()
    expect(r.map((x) => x.machine_no)).toEqual(['007', '008'])
    expect(r[0].serial).toBe('1234567890123456')
    expect(r[0].extra).toMatchObject({ 'Opening date': '17/10/2011' })
  })
  it('a row that did not change is not rewritten (the extra details come back from the database in another key order)', async () => {
    const before = await rows()
    await sync()
    const after = await rows()
    expect(after.map((x) => x.last_seen_at)).toEqual(before.map((x) => x.last_seen_at))
  })
})

describe('a copy that must not wipe the last good one', () => {
  it('a sheet with headings but no data rows is refused', async () => {
    const keep = raw[SHEET], keepShown = shown[SHEET]
    raw[SHEET] = [HEAD]; shown[SHEET] = [HEAD]
    const r = await sync()
    expect(r.status).toBe('error'); expect(r.message).toMatch(/headings but no data rows/)
    expect((await rows()).filter((x) => !x.removed_at)).toHaveLength(2)
    raw[SHEET] = keep; shown[SHEET] = keepShown
  })
  it('a heading CK Desk reads in two columns stops the copy', async () => {
    const keep = raw[SHEET], keepShown = shown[SHEET]
    raw[SHEET] = [[...HEAD, 'Ticket Mail To'], [A, 'a@x.test', 7, 'S', 40831, 'b@x.test']]; shown[SHEET] = raw[SHEET]
    const r = await sync()
    expect(r.status).toBe('error'); expect(r.message).toMatch(/more than one column/)
    expect((await rows()).filter((x) => !x.removed_at)).toHaveLength(2)
    raw[SHEET] = keep; shown[SHEET] = keepShown
  })
})

describe('where tickets go is checked by people (C-10)', () => {
  it('a changed Ticket Mail To is reported as a warning and still applied', async () => {
    raw[SHEET] = [HEAD, [A, 'new@oem.test', 7, 1234567890123456, 40831], [B, 'b@oem.test', 8, 'S8', 40832]]
    shown[SHEET] = [HEAD, [A, 'new@oem.test', '007', '1234567890123456', '17/10/2011'], [B, 'b@oem.test', '008', 'S8', '18/10/2011']]
    expect((await sync()).status).toBe('ok')
    expect((await rows())[0].emails).toEqual(['new@oem.test'])
    const w = (await issues()).filter((i) => i.code === 'recipients_changed')
    expect(w).toHaveLength(1)
    expect(w[0].message).toMatch(/old@oem.test to new@oem.test/)
  })
})
