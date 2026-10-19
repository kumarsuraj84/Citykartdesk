/**
 * A store's login renamed: the store NLD (login "NLD", signing in as sm.nld@...) becomes NEG (sm.neg@...). Afterwards its earlier
 * tickets show requester NEG, the store is NEG in the lists and reports, it signs in with the new e-mail only, and the old address is
 * replaced everywhere it was kept. Real database and sign-in service.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { setupD03Fixtures, seedRequestLike, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

const PASSWORD = 'Uat-Desk-003-Test-Pw!'
const caller = { current: { id: '', role: 'admin', org_id: '00000000-0000-0000-0000-000000000001' } }
vi.mock('@/lib/queries/profiles', () => ({ getCurrentProfile: vi.fn(async () => caller.current) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { updateUserEmail, updateUserProfile } from '@/lib/actions/admin/users'

vi.setConfig({ testTimeout: 60_000 })

const signIn = async (email: string) => {
  const anon = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data, error } = await anon.auth.signInWithPassword({ email, password: PASSWORD })
  return !!data.session && !error
}

describe('a store login renamed from NLD to NEG, with its e-mail', () => {
  let fx: D03Fixtures
  const admin = getAdmin()
  const stamp = Date.now()
  const code = `NLD${String(stamp).slice(-6)}`
  const OLD = `sm.nld.${stamp}@example.test`
  const NEW = `sm.neg.${stamp}@example.test`
  const made = { stores: [] as string[], oem: '', report: '', rule: '', thread: '' }

  beforeAll(async () => {
    fx = await setupD03Fixtures()
    caller.current = { id: fx.admin.id, role: 'admin', org_id: fx.orgId }
    await admin.from('requests').update({ status: 'cancelled' }).in('id', [fx.requestA.id, fx.requestB.id])
    // the store, its login (named after the store, signing in as sm.nld@...) and a ticket the store raised
    const store = await admin.from('stores').insert({ org_id: fx.orgId, code, name: code, cluster: 'NC1' }).select('id').single()
    made.stores.push(store.data!.id)
    await admin.auth.admin.updateUserById(fx.requesterA.id, { email: OLD, email_confirm: true })
    await admin.from('profiles').update({ full_name: code, store_id: store.data!.id }).eq('id', fx.requesterA.id)
    await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'in_progress' })

    // copies of the old address kept elsewhere
    const oem = await admin.from('oems').insert({ org_id: fx.orgId, name: `NLD OEM ${stamp}`, emails: ['vendor@example.test', OLD.toUpperCase(), 'other@example.test'], email_body_template: `Please also tell ${OLD}.` }).select('id').single()
    made.oem = oem.data!.id
    await admin.from('teams').update({ notification_email: OLD }).eq('id', fx.teamA.id)
    const report = await admin.from('scheduled_reports').insert({ org_id: fx.orgId, name: `r${stamp}`, report_type: 'requests', recipients: [OLD, 'x@example.test'] } as never).select('id').single()
    made.report = report.data!.id
    const rule = await admin.from('business_rules').insert({ org_id: fx.orgId, name: `rule${stamp}`, trigger: ['created'], conditions: [], actions: [{ type: 'notify', params: { email: OLD } }] } as never).select('id').single()
    made.rule = rule.data!.id
    const channel = (await admin.from('intake_channels').select('id').limit(1).single()).data!.id
    const thread = await admin.from('intake_threads').insert({ org_id: fx.orgId, channel_id: channel, participant_emails: ['a@example.test', OLD] } as never).select('id').single()
    made.thread = thread.data!.id
  }, 120_000)

  afterAll(async () => {
    await admin.from('business_rules').delete().eq('id', made.rule)
    await admin.from('scheduled_reports').delete().eq('id', made.report)
    await admin.from('intake_threads').delete().eq('id', made.thread)
    await admin.from('oems').delete().eq('id', made.oem)
    await admin.from('teams').update({ notification_email: null }).eq('id', fx.teamA.id)
    await admin.from('requests').delete().eq('service_id', fx.teamA.serviceId)
    await admin.from('profiles').update({ store_id: null }).eq('id', fx.requesterA.id)
    if (made.stores.length) await admin.from('stores').delete().in('id', made.stores)
    await fx?.cleanup()
  }, 120_000)

  const store = async () => (await admin.from('stores').select('code, name').eq('id', made.stores[0]).single()).data!
  // the requester and store of the tickets, as every report reads them (through the requester's profile)
  const tickets = async () => {
    const { data } = await admin.from('requests').select('requester:profiles!requests_requester_id_fkey(full_name, store:stores!profiles_store_id_fkey(name))').eq('team_id', fx.teamA.id).in('status', ['open', 'assigned', 'in_progress', 'waiting_user'])
    return ((data ?? []) as unknown as { requester: { full_name: string; store: { name: string } | null } | null }[]).map((r) => [r.requester?.full_name, r.requester?.store?.name])
  }

  it('the new name shows on the previous tickets and in the store lists, because the store is renamed with its login', async () => {
    expect(await tickets()).toEqual([[code, code]])

    const res = await updateUserProfile(fx.requesterA.id, { full_name: 'NEG' })
    expect(res.error).toBeUndefined()
    expect(res.note).toBe(`The store ${code} was renamed NEG, so its tickets and reports show NEG.`)
    expect(await store()).toEqual({ code: 'NEG', name: 'NEG' })
    expect((await admin.from('profiles').select('full_name').eq('id', fx.requesterA.id).single()).data!.full_name).toBe('NEG')
    // the ticket it raised before now shows requester NEG and store NEG
    expect(await tickets()).toEqual([['NEG', 'NEG']])
    // the sign-in account's own copy of the name follows
    expect((await admin.auth.admin.getUserById(fx.requesterA.id)).data.user?.user_metadata?.full_name).toBe('NEG')
  })

  it('the new e-mail signs in, the old one does not, and the old address is replaced everywhere it was kept', async () => {
    expect(await signIn(OLD)).toBe(true)
    const res = await updateUserEmail(fx.requesterA.id, NEW.toUpperCase())
    expect(res.error).toBeUndefined()
    expect(res.warning).toBeUndefined()
    expect(res.email).toBe(NEW)
    expect(res.updated).toBe('1 OEM contact list or template, 1 technician group notification address, 1 scheduled report, 1 e-mail conversation, 1 business rule')
    expect(await signIn(NEW)).toBe(true)
    expect(await signIn(OLD)).toBe(false)
    const user = (await admin.auth.admin.getUserById(fx.requesterA.id)).data.user!
    expect(user.email).toBe(NEW)
    // the sign-in identity carries the new address too: nothing of the old one is left in the account
    expect(user.identities?.every((i) => (i.identity_data as { email?: string })?.email === NEW)).toBe(true)

    const oem = (await admin.from('oems').select('emails, email_body_template').eq('id', made.oem).single()).data!
    expect(oem.emails).toEqual(['vendor@example.test', NEW, 'other@example.test']) // in the same place in the list
    expect(oem.email_body_template).toBe(`Please also tell ${NEW}.`)
    expect((await admin.from('teams').select('notification_email').eq('id', fx.teamA.id).single()).data!.notification_email).toBe(NEW)
    expect((await admin.from('scheduled_reports').select('recipients').eq('id', made.report).single()).data!.recipients).toEqual([NEW, 'x@example.test'])
    expect((await admin.from('intake_threads').select('participant_emails').eq('id', made.thread).single()).data!.participant_emails).toEqual(['a@example.test', NEW])
    const actions = JSON.stringify((await admin.from('business_rules').select('actions').eq('id', made.rule).single()).data!.actions)
    expect(actions).toContain(NEW)
    expect(actions).not.toContain(OLD)
  })

  it('another organisation\'s data is not touched', async () => {
    const { data } = await admin.rpc('replace_user_email', { p_org_id: '00000000-0000-0000-0000-0000000000ff', p_old: NEW, p_new: `x-${stamp}@example.test` })
    expect(Object.values((data ?? {}) as Record<string, number>).every((n) => n === 0)).toBe(true)
    expect((await admin.from('oems').select('emails').eq('id', made.oem).single()).data!.emails).toContain(NEW)
  })

  it('if another store already has the new code, the store is not renamed and the admin is told', async () => {
    const other = await admin.from('stores').insert({ org_id: fx.orgId, code: 'NEW9', name: 'NEW9' }).select('id').single()
    made.stores.push(other.data!.id)
    // the login is NEG now (store code NEG); renaming it to NEW9 collides with the other store
    const res = await updateUserProfile(fx.requesterA.id, { full_name: 'NEW9' })
    expect(res.error).toBeUndefined()
    expect(res.warning).toMatch(/another store already has the code NEW9/)
    expect((await store()).code).toBe('NEG')
    expect((await admin.from('profiles').select('full_name').eq('id', fx.requesterA.id).single()).data!.full_name).toBe('NEW9')
  })

  it('a login whose name is not its store\'s code leaves the store alone (a person, not a store login)', async () => {
    await admin.from('profiles').update({ full_name: 'Some Person' }).eq('id', fx.requesterA.id)
    const res = await updateUserProfile(fx.requesterA.id, { full_name: 'Some Other Name' })
    expect(res).toEqual({})
    expect((await store()).code).toBe('NEG')
  })

  it('a name that stays the same changes nothing', async () => {
    await admin.from('profiles').update({ full_name: 'NEG' }).eq('id', fx.requesterA.id)
    expect(await updateUserProfile(fx.requesterA.id, { full_name: 'neg' })).toEqual({})
    expect((await store()).code).toBe('NEG')
  })
})
