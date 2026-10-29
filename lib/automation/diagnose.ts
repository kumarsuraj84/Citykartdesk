import { findSelectedMachine } from '@/lib/programs/machines'
import { loadActiveProgramRows } from '@/lib/programs/routing'
import { acMailTarget, findSelectedUnit, gensetMailTarget, loadActiveAcUnits, loadCvmEmail, loadGensetsForStore } from '@/lib/masters/resolve'
import { loadCvmCandidates } from '@/lib/cvm/load'
import { splitRecipients } from '@/lib/masters/emails'
import { isOemKind, type OemKind } from '@/lib/oems/kinds'

// "Did the automatic steps of this ticket really happen?" Looks at what EXISTS on the ticket (assigned person, the e-mail sent to the OEM / vendor, the CVM approval), never at
// guesses, so a step that worked is never shown as missing and is never run twice. Used by the "Run automation again" button, the 15-minute automatic retry and the
// Admin > Stuck tickets list. The loaders read many tickets at once; evaluateAutomation() is a pure function (no database), so it can be tested.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = { from: (t: string) => any }

export type StepKey = 'rules' | 'vendor_mail' | 'cvm'
export type StepState = 'done' | 'missing' | 'blocked' | 'not_needed'

export type AutomationStep = {
  key: StepKey
  /** plain words for people: "Given to a technician by the Business Rules" */
  label: string
  state: StepState
  /** plain words: why it is in this state */
  detail: string
  /** true when the automatic retry may run this step by itself (a failure of the first try, never a decision a person may have made) */
  autoSafe: boolean
}

export type AutomationDiagnosis = {
  requestId: string
  requestNo: string
  title: string
  status: string
  createdAt: string
  eligible: boolean
  /** why there is nothing to run (ticket resolved / closed / cancelled) */
  ineligibleReason?: string
  /** the server stopped while this ticket was being made (started but never finished) */
  interrupted: boolean
  gaveUp: boolean
  /** the ticket was made after this feature existed (its automatic steps were recorded); older tickets are judged only by what exists on them and are never retried by themselves */
  tracked: boolean
  steps: AutomationStep[]
  /** 'broken': a step failed or never ran; 'unassigned': only "nobody has it" (a normal queue ticket the rules did not give to anyone); 'ok': nothing to run */
  kind: 'ok' | 'broken' | 'unassigned'
}

export type AutomationState = {
  exists: boolean
  started_at: string | null
  rules_ran_at: string | null
  finished_at: string | null
  auto_attempts: number
  auto_last_at: string | null
  gave_up_at: string | null
  last_rerun_at: string | null
}

export type TicketFacts = {
  id: string
  request_no: string
  org_id: string
  title: string
  description: string
  status: string
  created_at: string
  assigned_to: string | null
  requester_id: string
  category_id: string | null
  categoryName: string | null
  programId: string | null
  programName: string | null
  programActive: boolean
  programRowType: 'store' | 'machine' | null
  oemKind: OemKind | null
  /** the old AC flag of the service (not a category): the ticket is mailed quietly, a store with nothing in the sheet is normal */
  oemQuiet: boolean
  isPms: boolean
  cvmApproval: boolean
  state: AutomationState
  mailSent: boolean
  hasApproval: boolean
  anyCreatedRule: boolean
  storeCode: string | null
  chosenAcValue: string
  chosenMachineValue: string
  /** reasons the automatic steps cannot work (filled by the loader's checks): null = nothing in the way */
  mailProblem: string | null
  cvmProblem: string | null
}

const CLOSED = new Set(['resolved', 'closed', 'cancelled'])
const SENT_PATTERN = 'Ticket sent to the % OEM for servicing.%'
const INTERRUPTED_AFTER_MS = 3 * 60_000
export const AUTO_MAX_ATTEMPTS = 3

const label = {
  rules: 'Given to a technician by the Business Rules',
  vendor_mail: 'Sent to the OEM / vendor by e-mail',
  cvm: 'Sent to the store\'s CVM for approval',
} as const

/** Pure: the three steps of one ticket, from the facts about it. */
export function evaluateAutomation(f: TicketFacts, now: Date = new Date()): AutomationDiagnosis {
  const startedMs = f.state.started_at ? new Date(f.state.started_at).getTime() : null
  const interrupted = f.state.exists && !f.state.finished_at && startedMs !== null && now.getTime() - startedMs > INTERRUPTED_AFTER_MS
  const gaveUp = !!f.state.gave_up_at
  const base = { requestId: f.id, requestNo: f.request_no, title: f.title, status: f.status, createdAt: f.created_at, interrupted, gaveUp, tracked: f.state.exists }
  if (CLOSED.has(f.status)) return { ...base, eligible: false, ineligibleReason: 'This ticket is already resolved, closed or cancelled, so there is nothing to run.', steps: [], kind: 'ok' }

  const isOpen = f.status === 'open'
  const steps: AutomationStep[] = []

  // 1. Business Rules: a ticket that is still Open and has nobody
  {
    let state: StepState = 'not_needed'
    let detail = 'The ticket already has a person, or has moved on.'
    let autoSafe = false
    if (isOpen && !f.assigned_to) {
      if (!f.anyCreatedRule) {
        detail = 'There is no Business Rule that gives new tickets to anybody.'
      } else if (f.state.exists && !f.state.rules_ran_at) {
        state = 'missing'; autoSafe = true
        detail = 'The Business Rules did not run when this ticket was made (it was interrupted).'
      } else {
        state = 'missing'
        detail = f.state.exists
          ? 'The Business Rules ran, but nobody was given this ticket. If you have changed the rules or the technicians since, run them again.'
          : 'Nobody has this ticket yet. If the rules or the technicians have been fixed since it came, run the rules again.'
      }
    } else if (f.assigned_to) {
      state = 'done'; detail = 'The ticket has a person.'
    }
    steps.push({ key: 'rules', label: label.rules, state, detail, autoSafe })
  }

  // 2. The e-mail to the OEM / vendor (a Vendor Program, or the old AC / Genset setting)
  {
    const expected = f.programId ? f.programActive : !!f.oemKind && !f.isPms
    let state: StepState = 'not_needed'
    let detail = 'This ticket is not sent to an OEM or vendor by e-mail.'
    let autoSafe = false
    if (f.programId && !f.programActive) {
      detail = 'The vendor program of this category is switched off.'
    } else if (expected) {
      if (f.mailSent) { state = 'done'; detail = 'The e-mail to the OEM / vendor was sent.' }
      else if (f.mailProblem) { state = 'blocked'; detail = f.mailProblem }
      else {
        state = 'missing'; detail = 'The e-mail to the OEM / vendor was not sent (the mail may have failed, or the sheet was not ready then).'
        autoSafe = f.state.exists && isOpen
      }
    }
    steps.push({ key: 'vendor_mail', label: label.vendor_mail, state, detail, autoSafe })
  }

  // 3. The CVM approval of a category that asks for it
  {
    let state: StepState = 'not_needed'
    let detail = 'This category does not ask the store\'s CVM to approve.'
    let autoSafe = false
    if (f.cvmApproval) {
      if (f.hasApproval || f.status === 'pending_approval') { state = 'done'; detail = 'The ticket was sent to the CVM for approval.' }
      else if (!isOpen) { detail = 'The ticket has moved on without the CVM approval; nothing to run.' }
      else if (f.cvmProblem) { state = 'blocked'; detail = f.cvmProblem }
      else { state = 'missing'; detail = 'The ticket was not sent to the CVM for approval.'; autoSafe = f.state.exists }
    }
    steps.push({ key: 'cvm', label: label.cvm, state, detail, autoSafe })
  }

  const missing = steps.filter((s) => s.state === 'missing')
  const onlyQueue = missing.length > 0 && missing.every((s) => s.key === 'rules' && !s.autoSafe)
  const kind: AutomationDiagnosis['kind'] = missing.length === 0 ? 'ok' : onlyQueue ? 'unassigned' : 'broken'
  return { ...base, eligible: true, steps, kind }
}

// ── Loading the facts (many tickets at once) ──────────────────────────────────

type Chunked = <T>(ids: string[], size: number, fn: (part: string[]) => Promise<T[]>) => Promise<T[]>
const chunked: Chunked = async (ids, size, fn) => {
  const out: Awaited<ReturnType<typeof fn>> = []
  for (let i = 0; i < ids.length; i += size) out.push(...(await fn(ids.slice(i, i + size))))
  return out
}

type FieldLike = { id: string; options_source?: string }

export function chosenValues(sectionsSnapshot: unknown, formData: unknown): { ac: string; machine: string } {
  const sections = (Array.isArray(sectionsSnapshot) ? sectionsSnapshot : []) as { fields?: FieldLike[] }[]
  const fields = sections.flatMap((s) => s.fields ?? [])
  const data = (formData && typeof formData === 'object' ? formData : {}) as Record<string, unknown>
  const ac = fields.find((f) => f.options_source === 'ac_units')
  const machine = fields.find((f) => f.options_source === 'program_machines')
  return { ac: ac ? String(data[ac.id] ?? '').trim() : '', machine: machine ? String(data[machine.id] ?? '').trim() : '' }
}

const emptyState = (): AutomationState => ({ exists: false, started_at: null, rules_ran_at: null, finished_at: null, auto_attempts: 0, auto_last_at: null, gave_up_at: null, last_rerun_at: null })

/** Loads everything evaluateAutomation() needs for the given tickets (any number; read only). `check` also looks at the sheets to say WHY a mail or approval cannot go. */
export async function loadAutomationFacts(db: Db, requestIds: string[], opts: { check: boolean } = { check: true }): Promise<TicketFacts[]> {
  const ids = [...new Set(requestIds)]
  if (ids.length === 0) return []
  const reqs = await chunked(ids, 100, async (part) => {
    const { data } = await db.from('requests').select('id, request_no, org_id, title, description, status, created_at, assigned_to, requester_id, category_id, service_id, form_data, form_sections_snapshot').in('id', part)
    return (data ?? []) as Record<string, unknown>[]
  })
  if (reqs.length === 0) return []
  const str = (v: unknown) => (v == null ? '' : String(v))
  const unique = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))]

  const catIds = unique(reqs.map((r) => r.category_id as string | null))
  const svcIds = unique(reqs.map((r) => r.service_id as string | null))
  const reqIds = reqs.map((r) => str(r.id))
  const orgIds = unique(reqs.map((r) => str(r.org_id)))
  const requesterIds = unique(reqs.map((r) => str(r.requester_id)))

  const [cats, svcs, states, sent, approvals, rules, profiles] = await Promise.all([
    catIds.length ? db.from('service_categories').select('id, name, program_id, auto_oem_kind, is_pms, auto_cvm_approval').in('id', catIds) : Promise.resolve({ data: [] }),
    svcIds.length ? db.from('services').select('id, auto_oem_routing').in('id', svcIds) : Promise.resolve({ data: [] }),
    chunked(reqIds, 100, async (part) => ((await db.from('request_automation_state').select('request_id, started_at, rules_ran_at, finished_at, auto_attempts, auto_last_at, gave_up_at, last_rerun_at').in('request_id', part)).data ?? []) as Record<string, unknown>[]),
    chunked(reqIds, 100, async (part) => ((await db.from('request_comments').select('request_id').in('request_id', part).eq('is_internal', false).like('body', SENT_PATTERN)).data ?? []) as Record<string, unknown>[]),
    chunked(reqIds, 100, async (part) => ((await db.from('approvals').select('request_id').in('request_id', part)).data ?? []) as Record<string, unknown>[]),
    db.from('business_rules').select('org_id').in('org_id', orgIds).eq('is_active', true).contains('trigger', ['created']),
    chunked(requesterIds, 100, async (part) => ((await db.from('profiles').select('id, store_id').in('id', part)).data ?? []) as Record<string, unknown>[]),
  ])
  const catById = new Map(((cats.data ?? []) as Record<string, unknown>[]).map((c) => [str(c.id), c]))
  const svcById = new Map(((svcs.data ?? []) as Record<string, unknown>[]).map((s) => [str(s.id), s]))
  const stateById = new Map(states.map((s) => [str(s.request_id), s]))
  const sentSet = new Set(sent.map((s) => str(s.request_id)))
  const approvalSet = new Set(approvals.map((a) => str(a.request_id)))
  const ruleOrgs = new Set(((rules.data ?? []) as Record<string, unknown>[]).map((r) => str(r.org_id)))
  const storeIdByProfile = new Map(profiles.map((p) => [str(p.id), p.store_id as string | null]))
  const storeIds = unique([...storeIdByProfile.values()])
  const { data: stores } = storeIds.length ? await db.from('stores').select('id, code').in('id', storeIds) : { data: [] }
  const codeByStore = new Map(((stores ?? []) as Record<string, unknown>[]).map((s) => [str(s.id), s.code ? str(s.code).toUpperCase() : null]))

  const programIds = unique([...catById.values()].map((c) => c.program_id as string | null))
  const { data: progs } = programIds.length ? await db.from('vendor_programs').select('id, name, is_active, row_type').in('id', programIds) : { data: [] }
  const progById = new Map(((progs ?? []) as Record<string, unknown>[]).map((p) => [str(p.id), p]))

  const facts: TicketFacts[] = reqs.map((r) => {
    const cat = r.category_id ? catById.get(str(r.category_id)) : undefined
    const svc = r.service_id ? svcById.get(str(r.service_id)) : undefined
    const prog = cat?.program_id ? progById.get(str(cat.program_id)) : undefined
    const st = stateById.get(str(r.id))
    const oemFromCat = isOemKind(cat?.auto_oem_kind) ? (cat!.auto_oem_kind as OemKind) : null
    const programId = (cat?.program_id as string | null | undefined) ?? null
    const chosen = chosenValues(r.form_sections_snapshot, r.form_data)
    const storeId = storeIdByProfile.get(str(r.requester_id)) ?? null
    return {
      id: str(r.id), request_no: str(r.request_no), org_id: str(r.org_id), title: str(r.title), description: str(r.description), status: str(r.status), created_at: str(r.created_at),
      assigned_to: (r.assigned_to as string | null) ?? null, requester_id: str(r.requester_id), category_id: (r.category_id as string | null) ?? null, categoryName: cat ? str(cat.name) : null,
      programId, programName: prog ? str(prog.name) : null, programActive: prog?.is_active === true, programRowType: prog ? (prog.row_type === 'machine' ? 'machine' : 'store') : null,
      oemKind: programId ? null : (oemFromCat ?? (svc?.auto_oem_routing ? 'ac' : null)), oemQuiet: !programId && !oemFromCat && !!svc?.auto_oem_routing,
      isPms: cat?.is_pms === true, cvmApproval: cat?.auto_cvm_approval === true,
      state: st ? { exists: true, started_at: str(st.started_at), rules_ran_at: (st.rules_ran_at as string | null) ?? null, finished_at: (st.finished_at as string | null) ?? null, auto_attempts: Number(st.auto_attempts ?? 0), auto_last_at: (st.auto_last_at as string | null) ?? null, gave_up_at: (st.gave_up_at as string | null) ?? null, last_rerun_at: (st.last_rerun_at as string | null) ?? null } : emptyState(),
      mailSent: sentSet.has(str(r.id)), hasApproval: approvalSet.has(str(r.id)), anyCreatedRule: ruleOrgs.has(str(r.org_id)),
      storeCode: storeId ? codeByStore.get(storeId) ?? null : null, chosenAcValue: chosen.ac, chosenMachineValue: chosen.machine, mailProblem: null, cvmProblem: null,
    }
  })
  if (opts.check) await addProblems(db, facts)
  return facts
}

/** Fills mailProblem / cvmProblem: the reasons a step cannot work right now (store not in the sheet, no address, no CVM ...). Only for tickets whose step is not already done. */
async function addProblems(db: Db, facts: TicketFacts[]) {
  const progRows = new Map<string, Awaited<ReturnType<typeof loadActiveProgramRows>>>()
  const acUnits = new Map<string, Awaited<ReturnType<typeof loadActiveAcUnits>>>()
  const gensets = new Map<string, Awaited<ReturnType<typeof loadGensetsForStore>>>()
  const cvmEmail = new Map<string, string | null>()
  const cvmCands = new Map<string, Awaited<ReturnType<typeof loadCvmCandidates>>>()
  const cached = async <T,>(m: Map<string, T>, key: string, load: () => Promise<T>) => { if (!m.has(key)) m.set(key, await load()); return m.get(key) as T }

  for (const f of facts) {
    if (CLOSED.has(f.status)) continue
    // the e-mail to the OEM / vendor
    const mailExpected = f.programId ? f.programActive : !!f.oemKind && !f.isPms
    if (mailExpected && !f.mailSent) {
      try {
        if (!f.storeCode) { f.mailProblem = 'The requester is not linked to a store, so there is no sheet row to send to.'; }
        else if (f.programId) {
          const rows = await cached(progRows, `${f.programId}|${f.storeCode}`, () => loadActiveProgramRows(db, f.org_id, f.programId as string, f.storeCode as string))
          const name = f.programName ?? 'program'
          if (rows.length === 0) f.mailProblem = `Store ${f.storeCode} has no active row in the ${name} sheet.`
          else {
            const chosen = f.programRowType === 'machine' && f.chosenMachineValue ? findSelectedMachine(rows, f.chosenMachineValue) : null
            const pool = chosen && chosen.emails.length > 0 ? chosen.emails : rows.flatMap((r) => r.emails)
            if (splitRecipients(pool).to.length + splitRecipients(pool).cc.length === 0) f.mailProblem = `The ${name} sheet has no e-mail address for store ${f.storeCode}.`
          }
        } else if (f.oemKind === 'ac') {
          const active = await cached(acUnits, `${f.org_id}|${f.storeCode}`, () => loadActiveAcUnits(db, f.org_id, f.storeCode as string))
          if (active.length === 0) f.mailProblem = `Store ${f.storeCode} has no active AC in the AC sheet.`
          else if (!acMailTarget(active, findSelectedUnit(active, f.chosenAcValue))) f.mailProblem = `The AC sheet has no e-mail address for store ${f.storeCode}.`
        } else if (f.oemKind === 'genset') {
          const list = await cached(gensets, `${f.org_id}|${f.storeCode}`, () => loadGensetsForStore(db, f.org_id, f.storeCode as string))
          if (list.length === 0) f.mailProblem = `Store ${f.storeCode} is not in the Genset sheet.`
          else if (!gensetMailTarget(list)) f.mailProblem = `The Genset sheet has no e-mail address for store ${f.storeCode}.`
        }
      } catch (e) {
        console.error('[automation] mail check failed', f.id, e)
      }
    }
    // the CVM approval
    if (f.cvmApproval && !f.hasApproval && f.status === 'open') {
      try {
        if (!f.storeCode) f.cvmProblem = 'The requester is not linked to a store, so no CVM can be found.'
        else {
          const email = await cached(cvmEmail, `${f.org_id}|${f.storeCode}`, () => loadCvmEmail(db, f.org_id, f.storeCode as string))
          if (!email) f.cvmProblem = `No CVM is listed for store ${f.storeCode} in the CVM sheet.`
          else {
            const cands = await cached(cvmCands, f.org_id, () => loadCvmCandidates(f.org_id))
            if (!cands.byEmail.get(email)) f.cvmProblem = `The CVM listed for store ${f.storeCode} (${email}) is not an active staff member in CK Desk.`
          }
        }
      } catch (e) {
        console.error('[automation] CVM check failed', f.id, e)
      }
    }
  }
}

export async function diagnoseTickets(db: Db, requestIds: string[], opts: { check: boolean } = { check: true }, now: Date = new Date()): Promise<AutomationDiagnosis[]> {
  return (await loadAutomationFacts(db, requestIds, opts)).map((f) => evaluateAutomation(f, now))
}

export async function diagnoseTicket(db: Db, requestId: string): Promise<AutomationDiagnosis | null> {
  return (await diagnoseTickets(db, [requestId]))[0] ?? null
}
