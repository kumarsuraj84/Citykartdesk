// QA-D021: a real-size AC sheet (2,316 rows) copied twice. The second copy must change nothing. It used to add every row beyond the first 1,000 a second time, because the
// stored units were read in ONE request and the data service cuts a single answer at 1,000 rows without an error; the next copy added them again, and so on every update.
// Isolated audit stack, synthetic rows, nothing goes to Google.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, getAdmin, type D03Fixtures } from '../../tests/setup/fixtures-d03'

process.env.SYSTEM_LOG_IN_TESTS = '1'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { syncMasters } from '@/lib/masters/sync'
import type { SheetsSource } from '@/lib/masters/google'

vi.setConfig({ testTimeout: 600_000 })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
const tag = `t21${String(Date.now()).slice(-5)}`
let fx: D03Fixtures

const AC_HEAD = ['Store Code', 'AC Floor', 'AC Type', 'AC Tonnage', 'AC Brand', 'AC CKDESK SERIAL NO', 'AC Serial No', 'AC-AMC vendor', 'AC-AMC Brand', 'Zenatix (yes/No)', 'Store Priority list', 'Festival', 'Region', 'Cluster', 'Opening date', 'City', 'State', 'Address', 'pincode', 'Status', 'Mail ID']
const acRow = (store: string, no: number | string, serial: string) =>
  [store, 'GF', 'Ductable', '5.5 TR', 'BLUESTAR', no, serial, 'BLUESTAR', 'STAR COOLING', 'NO', 'ROS', 'PUJA', 'R6', 'NE', 46250, 'Pakur', 'JH', 'Khata 490 Pakur', 816107, 'Active', 'oem-one@oem.test']
const SHEET = { ac: `${tag}-sheet-ac-0000000000`, genset: `${tag}-sheet-gs-0000000000`, cvm: `${tag}-sheet-cv-0000000000`, pms: `${tag}-sheet-pm-0000000000` }
const sheets: Record<string, unknown[][]> = {}
const source: SheetsSource = { fetchValues: async (id) => { if (!sheets[id]) throw new Error('no such sheet'); return sheets[id] } }
const sync = () => syncMasters({ db: db(), orgId: fx.orgId, source, force: true })
const clear = async () => { for (const t of ['master_issues', 'master_ac_units', 'master_gensets', 'master_store_cvm', 'master_pms_dates', 'master_sources', 'master_mail_templates']) await db().from(t).delete().eq('org_id', fx.orgId) }
const count = async () => ((await db().from('master_ac_units').select('id', { count: 'exact', head: true }).eq('org_id', fx.orgId)).count ?? 0) as number
const countActive = async () => ((await db().from('master_ac_units').select('id', { count: 'exact', head: true }).eq('org_id', fx.orgId).is('removed_at', null)).count ?? 0) as number

const ROWS = 2316
beforeAll(async () => {
  fx = await setupD03Fixtures()
  await clear()
  for (const [kind, id] of Object.entries(SHEET)) await db().from('master_sources').insert({ org_id: fx.orgId, kind, spreadsheet_id: id })
  // 2,316 rows over 330 stores; some stores repeat a CKDESK number (as the real sheet does), some serials are the same text twice
  const rows: unknown[][] = [AC_HEAD]
  for (let i = 0; i < ROWS; i++) {
    const store = `${tag}S${String(i % 330).padStart(3, '0')}`.toUpperCase()
    const no = i % 17 === 0 ? 1 : Math.floor(i / 330) + 1          // every 17th row repeats number 1 of its store
    const serial = i % 29 === 0 ? 'NO SERIAL' : `SER-${tag}-${i}`
    rows.push(acRow(store, no, serial))
  }
  sheets[SHEET.ac] = rows
  sheets[SHEET.genset] = [['Store Code', 'Genset Brand', 'Genset KVA', 'Genset Serial No', 'CPCB Group', 'Mail ID']]
  sheets[SHEET.cvm] = [['Store Code', 'CVM EMAIL ID']]
  sheets[SHEET.pms] = [['Store Code', 'AC PMS Date']]
}, 300_000)
afterAll(async () => { await clear(); await fx?.cleanup() }, 300_000)

describe('a real-size AC sheet copied again and again', () => {
  it('first copy holds exactly the sheet rows; further copies add nothing and lose nothing', async () => {
    const r1 = await sync()
    expect(r1.ac.status).toBe('ok')
    expect(await count()).toBe(ROWS)
    for (let i = 0; i < 3; i++) {
      const r = await sync()
      expect(r.ac.status, `copy ${i + 2}`).toBe('ok')
      expect(await count(), `after copy ${i + 2}`).toBe(ROWS)
      expect(await countActive(), `active after copy ${i + 2}`).toBe(ROWS)
    }
  })

  it('a changed row in the sheet changes that unit only, even far beyond the first 1,000', async () => {
    const rows = sheets[SHEET.ac]
    const idx = 2100
    const before = await count()
    rows[idx] = [...rows[idx]]; rows[idx][4] = 'DAIKIN'
    await sync()
    expect(await count()).toBe(before)
    const changed = (await db().from('master_ac_units').select('brand').eq('org_id', fx.orgId).eq('sheet_row', idx + 1)).data ?? []
    expect(changed).toHaveLength(1)
    expect(changed[0].brand).toBe('DAIKIN')
  })
})
