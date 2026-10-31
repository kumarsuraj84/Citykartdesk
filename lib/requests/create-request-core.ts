import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activity'
import { notify } from '@/lib/notifications'
import { resolveSlaDeadlines } from '@/lib/sla/resolve'
import { resolveServiceFormSections, requesterCanSet, fieldAppliesToCategory } from '@/lib/forms/sections'
import { validateRequesterFormCompletion } from '@/lib/requests/validate-requester-form-completion'
import { resolveSubCategoryForService } from '@/lib/requests/resolve-sub-category'
import { pickTitleField, subjectToTitle } from '@/lib/requests/title-field'
import { notifyRequesterTicketLogged } from '@/lib/requests/notify-requester'
import { isOemKind, type OemKind } from '@/lib/oems/kinds'
import { loadProgram, runProgramRouting, saveProgramRowsForRules } from '@/lib/programs/routing'
import { findSelectedMachine, machineValueOf } from '@/lib/programs/machines'
import type { ProgramRowRecord } from '@/lib/programs/mail'
import type { ProgramRecord } from '@/lib/programs/types'
import { runAutoCvmApproval } from '@/lib/cvm/auto-approval'
import { runMasterOemRouting, saveMasterSnapshot } from '@/lib/requests/master-routing'
import { findSelectedUnit, loadActiveAcUnits, loadCvmEmail, type AcUnitRecord } from '@/lib/masters/resolve'
import { loadCvmCandidates } from '@/lib/cvm/load'
import { sanitizeError } from '@/lib/observability/sanitize-error'
import { logger } from '@/lib/observability/logger'
import type { FormField, RequestPriority } from '@/types'
import { isLocationRuleExempt, isServiceVisibleToLocation } from '@/lib/services/location-visibility'
import { markAutomationFinished, markAutomationStarted, markRulesRan } from '@/lib/automation/rerun'
import { addressWithPincode } from '@/lib/stores/details'
import type { Json } from '@/types/database'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

// Stage 3.1: a conservative bound for a caller-supplied trusted title —
// requests.title itself is a plain unbounded TEXT column (no DB or existing
// UI maximum exists to inherit; confirmed by inspecting the schema), so this
// is a new, deliberately conservative cap, not a discovered constraint.
// Matches the cap generateRequestTitle()'s own AI-title path already uses
// (lib/requests/questionnaire/title.ts) so the two stay consistent.
const MAX_TRUSTED_TITLE_LENGTH = 120

/** Trim + reject empty/whitespace-only + bound-length a caller-supplied
 *  trusted title (see CreateRequestCoreParams.titleOverride). Returns null
 *  for anything unusable, so the caller falls back to the existing
 *  form-derived title instead of ever storing a blank/garbage value. */
function sanitizeTrustedTitle(raw: string | undefined): string | null {
  if (raw == null) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  return trimmed.length > MAX_TRUSTED_TITLE_LENGTH ? trimmed.slice(0, MAX_TRUSTED_TITLE_LENGTH).trimEnd() : trimmed
}

// ── createRequestCore ─────────────────────────────────────────────────────────

export type CreateRequestSource = 'web' | 'email_intake' | 'whatsapp' | 'api'

export type CreateRequestCoreParams = {
  /** Client used for the catalog/profile reads that historically went through
   *  createRequest()'s RLS-scoped `supabase` client (service lookup, service
   *  location tags, sub-category tags, requester profile). For the web
   *  channel this is the caller's own RLS-scoped session client — RLS keeps
   *  enforcing exactly the same visibility it always has. For a channel with
   *  no browser session (Email Intake, WhatsApp), pass the admin client here
   *  too; this function adds explicit org_id filters to every read that
   *  relied on RLS for tenant scoping, so an admin-client caller can't leak
   *  another org's data through the bypass. */
  client: AnyClient
  orgId: string
  /** Who the ticket is FOR. */
  requesterId: string
  /** Who is actually creating it right now — the activity-log actor and the
   *  "raised on your behalf" notification's sender. Equals requesterId for a
   *  requester creating their own ticket. */
  actingUserId: string
  serviceId: string
  subCategoryId?: string | null
  /** True only for a ticket the SYSTEM makes (the daily AC PMS job). An AC PMS category is refused for every person and every channel except an administrator / platform owner on the web form. */
  systemGenerated?: boolean
  formData: Record<string, unknown>
  projectId?: string | null
  /** Free-text description stored directly on requests.description. The web
   *  channel never sets this (description content lives inside a textarea
   *  form field instead) — kept as an explicit opt-in passthrough solely so
   *  Email Intake's existing requests.description behavior doesn't change. */
  description?: string | null
  source: CreateRequestSource
  /** Reverse link to the inbound message that produced this ticket (Email
   *  Intake, and later WhatsApp) — maps to requests.intake_message_id. */
  intakeMessageId?: string | null
  /** Additional provenance to merge into requests.source_metadata. `source`
   *  is always folded in as `created_via` ('portal' for the web channel). */
  sourceMetadata?: Record<string, unknown>
  /** Whether `client`'s writes should run through it directly, or be forced
   *  through the admin client instead. Required whenever `client` has no RLS
   *  session bound to `requesterId` — the web "book on behalf of" case, and
   *  always true for a channel with no browser session at all. */
  useAdminForWrites?: boolean
  /** Web-only: a person submitting a request for a service restricted to
   *  specific Locations is blocked unless they are exempt — re-checked here as
   *  defense-in-depth against a direct call using a known service_id.
   *  ONLY an administrator and a platform owner are exempt (isLocationRuleExempt
   *  in lib/services/location-visibility.ts, as decided by the product owner); a
   *  technician (agent) or manager is checked like anybody else.
   *  Pass the ACTING user's role/location, also for "book on behalf of": the
   *  rule is about who is sitting at the screen, not about the requester they
   *  book for, so a technician booking for someone at another location is
   *  checked against the TECHNICIAN's own location. Omit for a channel where
   *  this particular check doesn't apply the same way. */
  actingUserRoleForLocationCheck?: string | null
  actingUserLocationId?: string | null
  /** Email Intake lets a reviewer route a converted ticket to a different
   *  team than the service's own default team_id — a real, existing,
   *  intentional capability of that one channel, not something the web form
   *  has ever offered. Validated against `orgId` when provided. */
  teamIdOverride?: string
  /** Trust a caller-supplied priority instead of deriving it from the picked
   *  Sub-Category's sla_priority / the service's default_priority. This must
   *  stay reserved for a channel where the value has already passed through
   *  a review/approval step by a human or trusted process — Email Intake's
   *  `final_priority` is a classifier's suggestion the reviewer explicitly
   *  confirmed or overrode before conversion, not a raw, unreviewed value
   *  from the original message. The web channel never sets this, and
   *  self-serve channels with no review step (a requester's own web
   *  submission, and a future unreviewed WhatsApp flow) must not either —
   *  see the discovery report's Part J: DESK computes priority, a caller
   *  never supplies it directly, except where a human has already vetted the
   *  value the same way an agent manually setting priority would. */
  priorityOverride?: RequestPriority
  /** Stage 3.1: a trusted, precomputed title to store on requests.title
   *  verbatim (after trim/empty/length sanitization — see
   *  sanitizeTrustedTitle()), instead of the derivation below. Channel-
   *  neutral — NOT WhatsApp-specific — but expected to be set only by a
   *  server/domain-layer caller that has already computed a real title (the
   *  Stage 3 questionnaire adapter's own generateRequestTitle() result),
   *  never taken directly from unvalidated browser input. Presentation/
   *  content data only: it has no effect on routing/security decisions
   *  (priority, SLA, assignment, Business Rules, org/service/sub-category
   *  validation are all computed exactly as if this were absent).
   *  Omitted, empty, whitespace-only, or otherwise unusable → falls back to
   *  the existing text/textarea/select/radio/multiselect-derived title
   *  below, unchanged — so no existing caller (web, Email Intake) is
   *  affected by this parameter's mere existence. */
  titleOverride?: string
  /** QA-D004: the ACs to save with the ticket as "the AC it was raised for" even though the requester chose none (the AC PMS ticket of a store: every active AC of the store).
   *  Saved BEFORE the Business Rules run, so a rule can route the ticket by the AC's vendor, brand and region exactly as it routes an AC complaint.
   *  Ignored when the requester chose an AC themselves. */
  acUnitsForRouting?: AcUnitRecord[]
}

export type CreateRequestCoreResult =
  | { requestId: string; requestNo: string; error?: never }
  | { error: string; requestId?: never; requestNo?: never }

export async function createRequestCore(params: CreateRequestCoreParams): Promise<CreateRequestCoreResult> {
  const {
    client,
    orgId,
    requesterId,
    actingUserId,
    serviceId,
    subCategoryId = null,
    formData: rawFormData,
    projectId = null,
    description = null,
    source,
    intakeMessageId = null,
    sourceMetadata,
    useAdminForWrites = false,
    actingUserRoleForLocationCheck = null,
    actingUserLocationId = null,
    teamIdOverride,
    priorityOverride,
    titleOverride,
    acUnitsForRouting,
    systemGenerated = false,
  } = params

  const admin = createAdminClient()
  const writeClient: AnyClient = useAdminForWrites ? admin : client
  const parsedFormData: Record<string, unknown> = { ...rawFormData }

  // maybeSingle() (not single()): single() errors on zero matching rows,
  // which made "not found" and "the query itself failed" indistinguishable
  // by error-presence alone - confirmed on Main under target-scale load
  // testing, where a burst of EADDRINUSE-driven fetch failures surfaced as
  // real "Service not found." errors for services that unquestionably
  // existed, alongside every legitimate zero-row case (wrong org, inactive
  // service) hitting the exact same code path. maybeSingle() returns
  // data: null with no error for zero rows, so the two are now genuinely
  // separable below.
  const { data: service, error: serviceError } = await client
    .from('services')
    .select('*, team:teams (*), template:form_templates (form_sections), sla_policy:sla_policies (config)')
    .eq('id', serviceId)
    .eq('org_id', orgId)
    .eq('is_active', true)
    .maybeSingle()

  if (serviceError) {
    return { error: sanitizeError(serviceError, { route: 'create-request-core.ts#createRequestCore', context: { lookup: 'service', serviceId }, fallback: 'Unable to verify the selected service. Please try again.' }) }
  }
  if (!service) return { error: 'Service not found.' }

  // Location-scoped visibility — see actingUserRoleForLocationCheck's doc comment.
  if (actingUserRoleForLocationCheck && !isLocationRuleExempt(actingUserRoleForLocationCheck)) {
    const { data: locationTags } = await client
      .from('service_location_tags')
      .select('location_id')
      .eq('service_id', serviceId)
    const restrictedTo = (locationTags ?? []).map((t: { location_id: string }) => t.location_id)
    // a service with no location ticked is for administrators and platform owners only (lib/services/location-visibility.ts)
    if (!isServiceVisibleToLocation(restrictedTo, actingUserLocationId)) {
      return { error: 'Service not found.' }
    }
  }

  // ── Category / Sub-category — only sub_category_id is accepted; the
  // category is derived server-side from it so the two can never disagree.
  // Validated against this service's tagged set — defense-in-depth beyond
  // whatever picker/questionnaire the channel presented. Shared with the
  // Stage 3 questionnaire engine's own revalidation step (see
  // lib/requests/resolve-sub-category.ts) so the two can never drift apart.
  const subCategoryResolution = await resolveSubCategoryForService({ client, serviceId, subCategoryId })
  if (!subCategoryResolution.ok) return { error: subCategoryResolution.error }

  const categoryId = subCategoryResolution.categoryId
  // AC PMS tickets are made by the daily job from the PMS sheet. By hand only an administrator (or platform owner) may raise one; a store, a technician or a manager cannot, and no mail / WhatsApp channel can.
  if (categoryId && !systemGenerated && actingUserRoleForLocationCheck !== 'admin' && actingUserRoleForLocationCheck !== 'platform_owner') {
    const { data: pmsCat } = await admin.from('service_categories').select('is_pms').eq('id', categoryId).maybeSingle()
    if (pmsCat?.is_pms === true) return { error: 'AC PMS tickets are made automatically from the AC PMS sheet and cannot be raised by hand (only an administrator can).' }
  }
  const resolvedSubCategoryId = subCategoryResolution.subCategoryId

  // ── Resolve the form: template (if tagged) is the live source of truth,
  // otherwise the service's own sections/legacy flat fields.
  const sections = resolveServiceFormSections(service)
  const allFields: FormField[] = [...sections]
    .sort((a, b) => a.order - b.order)
    .flatMap((s) => [...s.fields].sort((a, b) => a.order - b.order))

  // ── Requester's org + store master record — store_id (if the requester is
  // a store-tier user) drives both the store_address auto-fill and the OEM
  // auto-routing further down. Looked up by requesterId (not the acting
  // user) so a "book on behalf of"/intake/WhatsApp-resolved requester
  // correctly gets their OWN store, never the acting user's.
  //
  // Stage 1.1 security fix: this lookup's failure was previously ignored —
  // only `data` was destructured, so a `requesterId` that doesn't exist (or
  // belongs to a DIFFERENT org than `orgId`, e.g. a compromised/buggy
  // admin-client caller) fell through silently. With `client` as an
  // RLS-scoped session this was low-risk (RLS already constrains what's
  // visible), but createRequestCore() is explicitly designed to also be
  // called with the admin client (no RLS) by a channel with no browser
  // session — for that caller this was a real cross-tenant gap: a request
  // could be inserted with `org_id: orgId` while `requester_id` silently
  // referenced a profile in a different org. The `!requesterProfile` check
  // below still rejects that case; see the service lookup above for why
  // maybeSingle() (not single()) is what makes a real query failure
  // separable from a genuine zero-row "not found."
  const { data: requesterProfile, error: requesterProfileError } = await client
    .from('profiles')
    .select('org_id, store_id, full_name')
    .eq('id', requesterId)
    .eq('org_id', orgId)
    .maybeSingle()

  if (requesterProfileError) {
    return { error: sanitizeError(requesterProfileError, { route: 'create-request-core.ts#createRequestCore', context: { lookup: 'requester', requesterId }, fallback: 'Unable to verify the requester. Please try again.' }) }
  }
  if (!requesterProfile) return { error: 'Requester not found.' }

  let requesterStoreAddress: string | null = null
  // The store code ties the requester to the master sheets (AC units, Genset, CVM).
  let requesterStoreCode: string | null = null
  if (requesterProfile?.store_id) {
    const { data: store } = await admin
      .from('stores')
      .select('address, pincode, code')
      .eq('id', requesterProfile.store_id)
      .eq('org_id', orgId)
      .maybeSingle()
    requesterStoreAddress = addressWithPincode(store?.address, store?.pincode) || null
    requesterStoreCode = store?.code ? String(store.code).toUpperCase() : null
  }

  // A field limited to certain categories (for example Qty for fixtures) belongs only to those categories: for any other category its answer is dropped, so it is
  // neither required nor stored.
  for (const f of allFields) if (!fieldAppliesToCategory(f, categoryId)) delete parsedFormData[f.id]

  // A plain requester answers only the questions a requester may answer. Anything else they send (a technician-only box, an id that is not on the form)
  // is dropped: otherwise a pre-filled technician field would pass the technician's "must fill before moving on" gate, and a hidden field could pick
  // a field-level SLA tier (VAPT VA-TKT-08).
  if (actingUserRoleForLocationCheck === 'user') {
    const settable = new Set(allFields.filter((f) => requesterCanSet(f)).map((f) => f.id))
    for (const key of Object.keys(parsedFormData)) if (!settable.has(key)) delete parsedFormData[key]
  }

  // Always system-populated, never trust whatever (if anything) the caller
  // submitted for it.
  for (const field of allFields) {
    if (field.type === 'store_address') {
      parsedFormData[field.id] = requesterStoreAddress ?? ''
    }
  }

  // A dropdown whose choices come from the AC sheet: the AC chosen must be one of the Active ACs of the requester's own store (checked here, not only in the
  // browser). Other channels (e-mail intake, WhatsApp) have no such list to choose from, so their value is kept as given.
  const acField = allFields.find((f) => f.options_source === 'ac_units')
  const chosenAcValue = acField ? String(parsedFormData[acField.id] ?? '').trim() : ''
  if (acField && chosenAcValue && requesterStoreCode && source === 'web') {
    const activeUnits = await loadActiveAcUnits(admin, orgId, requesterStoreCode)
    if (activeUnits.length > 0 && !findSelectedUnit(activeUnits, chosenAcValue)) {
      return { error: `The AC "${chosenAcValue}" is not an active AC of your store. Please choose one from the list.` }
    }
  }

  // A box "machines of a Vendor Program" (one row per machine): for a category of such a program the machine chosen must be one of the store's active machines of that program (checked
  // here, not only in the browser), and it is compulsory when the store has machines. Other channels have no list to choose from, so their value is kept as given.
  let chosenMachineValue = ''
  const programMachinesField = allFields.find((f) => f.options_source === 'program_machines')
  // The AC form already has a dropdown of the store's ACs (the CKDESK number). When a category of that form is moved onto a Vendor Program with one row per machine (AC cut-over), the
  // SAME dropdown chooses the machine, so the form does not have to be changed and the requester still sees one box. In that case the choice is optional exactly as it is for the old
  // AC setting (no choice = the store's machines are all mailed), and a value the program does not know is ignored, never an error (the old AC list decided what could be chosen).
  const machineField = programMachinesField ?? undefined
  const aliasField = !programMachinesField && chosenAcValue ? acField : undefined
  if (aliasField && subCategoryResolution.categoryId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdb = admin as unknown as { from: (t: string) => any }
    const { data: mc } = await admin.from('service_categories').select('program_id').eq('id', subCategoryResolution.categoryId).eq('org_id', orgId).maybeSingle()
    const aliasProgramId = (mc as { program_id?: string | null } | null)?.program_id ?? null
    if (aliasProgramId && requesterStoreCode) {
      const { data: mp } = await pdb.from('vendor_programs').select('is_active, row_type').eq('id', aliasProgramId).eq('org_id', orgId).maybeSingle()
      const prog = mp as { is_active: boolean; row_type: string } | null
      if (prog?.is_active && prog.row_type === 'machine') {
        const { data: mrows } = await pdb.from('program_rows').select('id, machine_no, serial').eq('program_id', aliasProgramId).eq('store_code', requesterStoreCode.toUpperCase()).eq('is_active', true).is('removed_at', null)
        const found = findSelectedMachine((mrows ?? []) as ProgramRowRecord[], chosenAcValue)
        if (found) chosenMachineValue = machineValueOf(found)
      }
    }
  }
  if (machineField && subCategoryResolution.categoryId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdb = admin as unknown as { from: (t: string) => any }   // the program tables are read through the untyped client, as everywhere else
    const { data: mc } = await admin.from('service_categories').select('program_id').eq('id', subCategoryResolution.categoryId).eq('org_id', orgId).maybeSingle()
    const machineProgramId = (mc as { program_id?: string | null } | null)?.program_id ?? null
    if (machineProgramId) {
      const { data: mp } = await pdb.from('vendor_programs').select('is_active, row_type').eq('id', machineProgramId).eq('org_id', orgId).maybeSingle()
      const prog = mp as { is_active: boolean; row_type: string } | null
      if (prog?.is_active && prog.row_type === 'machine') {
        chosenMachineValue = String(parsedFormData[machineField.id] ?? '').trim()
        if (requesterStoreCode && source === 'web') {
          const { data: mrows } = await pdb.from('program_rows').select('id, machine_no, serial').eq('program_id', machineProgramId).eq('store_code', requesterStoreCode.toUpperCase()).eq('is_active', true).is('removed_at', null)
          const machines = (mrows ?? []) as ProgramRowRecord[]
          if (machines.length > 0 && !chosenMachineValue) return { error: `Please choose the machine (${machineField.label}).` }
          if (machines.length > 0 && chosenMachineValue && !findSelectedMachine(machines, chosenMachineValue)) {
            return { error: `The machine "${chosenMachineValue}" is not an active machine of your store. Please choose one from the list.` }
          }
          if (chosenMachineValue && machines.length > 0) chosenMachineValue = machineValueOf(findSelectedMachine(machines, chosenMachineValue)!)
        }
      }
    }
  }

  // ── Mandatory-field completion gate — the same check every channel must
  // pass before a ticket can be created (Stage 1C).
  // A REQUIRED FILE FIELD cannot be checked here (B-16): request_attachments.request_id is a NOT NULL
  // foreign key, so a file can only be stored AFTER this ticket exists, and the web form uploads
  // its files in a second step once createRequest() has returned the new id. At this point
  // there is nothing to count, on any channel. The check belongs to the step that finishes the upload
  // (see validateRequesterFormCompletion's own doc comment). For the web form that step is confirmRequiredFiles()
  // (lib/actions/attachments.ts, called by the "Request created" screen once the files were sent): when the form asked for a file and the ticket
  // has none, it leaves one internal note "A required file was not attached" and the screen tells the requester. The other channels (e-mail, WhatsApp,
  // intake) do not use it: WhatsApp asks for the file before the ticket is made (lib/conversations), and the others keep their files with the message.
  // Any attachment on the ticket counts (a file is not tied to one field).
  const completion = validateRequesterFormCompletion({ service, formData: parsedFormData, categoryId })
  if (!completion.valid) {
    const firstIssue = completion.missingFields[0] ?? completion.invalidFields[0]
    const message = completion.missingFields[0]
      ? `${firstIssue.label} is required.`
      : (completion.invalidFields[0]?.message ?? 'Invalid request.')
    return { error: message }
  }
  const requesterFields = completion.requesterFields

  // ── Request title ──────────────────────────────────────────────────────────
  // The field labelled "Subject" is the title, whatever its position in the form. Only when a
  // template has no Subject does it fall back to: text → textarea → select → radio → multiselect
  // → service name (see lib/requests/title-field.ts).
  const { field: titleField, isSubject: titleIsSubject } = pickTitleField(requesterFields, parsedFormData)

  let titleValue: string | undefined
  if (titleField) {
    if (titleField.type === 'multiselect') {
      const vals = parsedFormData[titleField.id] as string[]
      const labels = vals.map((v) => titleField.options?.find((o) => o.value === v)?.label ?? v)
      titleValue = labels.join(', ')
    } else if (titleField.type === 'select' || titleField.type === 'radio') {
      const raw = String(parsedFormData[titleField.id] ?? '')
      titleValue = titleField.options?.find((o) => o.value === raw)?.label ?? raw
    } else {
      titleValue = String(parsedFormData[titleField.id] ?? '').trim()
    }
  }

  // Stage 3.1: a sanitized titleOverride wins outright — stored verbatim,
  // with no service-name prefix — so "the same title shown at Review is the
  // title on the created ticket" holds exactly. Falls back to the existing
  // form-derived title when absent/unusable, unchanged from before this
  // parameter existed.
  // Both forms are one line and at most 200 characters (B-28): a long or multi-line answer used as the title ("Service: <answer>") was stored as typed.
  const title =
    sanitizeTrustedTitle(titleOverride) ??
    (titleValue ? subjectToTitle(titleIsSubject ? titleValue : `${service.name}: ${titleValue}`) : service.name)

  // For the OEM auto-routing email — pulled straight from whichever fields
  // this template happens to have, since there's no fixed
  // "description"/"phone" field id across services.
  const descriptionField = allFields.find((f) => f.type === 'textarea')
  const oemDescription = description ?? (descriptionField ? String(parsedFormData[descriptionField.id] ?? '').trim() : '')
  const phoneField = allFields.find((f) => f.type === 'phone')
  const requesterPhone = phoneField ? String(parsedFormData[phoneField.id] ?? '').trim() : ''
  const emailField = allFields.find((f) => f.type === 'email')
  const formRequesterEmail = emailField ? String(parsedFormData[emailField.id] ?? '').trim() : ''

  // Priority is auto-set from the picked sub-category's assigned SLA tier
  // when it has one, falling back to the service's own default otherwise —
  // never accepted from an unreviewed caller. `priorityOverride` is the one
  // documented exception, reserved for a channel where the value has already
  // passed human review (see its own doc comment).
  const priority = (priorityOverride ?? subCategoryResolution.slaPriority ?? service.default_priority) as RequestPriority
  const now = new Date()

  // A-13: the project the ticket is filed under. The insert is made with the server's key (no row security), so a project id of ANOTHER organisation - or one the person
  // may not see - would be stored as given. It must belong to this organisation, and on the web channel the person at the screen must be allowed to see it
  // (can_view_project uses their own session). An invalid one is ignored: the ticket is raised without a project.
  let validProjectId: string | null = null
  if (projectId) {
    const { data: proj } = await admin.from('projects').select('id').eq('id', projectId).eq('org_id', orgId).maybeSingle()
    if (proj) {
      if (source === 'web') {
        const rpc = (client as unknown as { rpc?: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown }> }).rpc
        const { data: canView } = typeof rpc === 'function' ? await rpc.call(client, 'can_view_project', { p_project_id: projectId }) : { data: false }
        validProjectId = canView === true ? projectId : null
      } else {
        validProjectId = projectId
      }
    }
    if (!validProjectId) {
      logger.warn({ event: 'create_request.project_ignored', message: 'The project given with a new ticket is not in this organisation or not visible to the person; the ticket was raised without it', route: 'create-request-core.ts#createRequestCore', actorId: actingUserId, orgId })
    }
  }

  const servicePolicy = service.sla_policy as unknown as { config: import('@/types').SLAConfig } | null
  const { responseDueAt, resolutionDueAt } = await resolveSlaDeadlines(client, {
    serviceId,
    priority,
    servicePolicyConfig: servicePolicy?.config ?? null,
    allFields,
    formData: parsedFormData,
    from: now,
  })

  // Team routing: the service's own team by default; Email Intake may
  // explicitly override it to whatever team the reviewer picked — validated
  // against this org before being trusted.
  let teamId = service.team_id as string
  if (teamIdOverride) {
    const { data: overrideTeam } = await admin
      .from('teams')
      .select('id')
      .eq('id', teamIdOverride)
      .eq('org_id', orgId)
      .maybeSingle()
    if (!overrideTeam) return { error: 'Selected technician group not found.' }
    teamId = teamIdOverride
  }

  // Every ticket records where it came from so technicians can see it (web,
  // WhatsApp, ...). The web channel's value is 'portal' — the name the Source
  // column, reports and Business Rules already use for it.
  const mergedSourceMetadata: Record<string, unknown> = {
    ...(sourceMetadata ?? {}),
    created_via: source === 'web' ? 'portal' : source,
  }

  const { data: request, error: insertError } = await writeClient
    .from('requests')
    .insert({
      request_no: '',
      service_id: serviceId,
      category_id: categoryId,
      sub_category_id: resolvedSubCategoryId,
      team_id: teamId,
      requester_id: requesterId,
      org_id: orgId,
      title,
      description,
      priority,
      form_data: parsedFormData as Json,
      // Legacy flat snapshot (always present for backward compat) — always
      // read off the service's own column, never the template.
      form_schema_snapshot: service.form_fields as Json,
      // Section snapshot — the resolved form actually shown/asked to the
      // requester (template's sections if tagged, else the service's own).
      form_sections_snapshot: sections as Json,
      // The database (migration 157, D-008) refuses SLA deadlines in an insert made as the signed-in user, so a requester cannot choose their own deadline.
      // With the server's key (every channel today) they go IN the insert (B-26), so a ticket never exists without them; otherwise they are written right after, below.
      ...(useAdminForWrites ? { response_due_at: responseDueAt, resolution_due_at: resolutionDueAt } : {}),
      project_id: validProjectId,
      intake_message_id: intakeMessageId,
      source_metadata: mergedSourceMetadata as Json | undefined,
    })
    .select('id, request_no')
    .single()

  if (insertError || !request) {
    return { error: sanitizeError(insertError, { route: 'create-request-core.ts#createRequestCore', fallback: 'Failed to create request.' }) }
  }

  // Remember that the automatic steps of this ticket have started (and, below, how far they got): if the server stops now, the ticket shows as interrupted and can be finished
  // from the ticket ("Run automation again") or by the 15-minute retry. Never fails the ticket.
  await markAutomationStarted(admin as never, orgId, request.id)

  // B-26: if the deadlines could not be put in the insert, or the policy has hours for this priority but no deadline came out (the business-hours calendar could not be
  // read: already logged and alerted at its source), the ticket exists WITHOUT an SLA. That is logged as an error with the ticket id, and the ticket is NOT marked as
  // "automation finished", so it stays visible as interrupted instead of looking complete.
  let slaIncomplete = false
  if (!useAdminForWrites && (responseDueAt || resolutionDueAt)) {
    let slaError: unknown = null
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await admin
        .from('requests')
        .update({ response_due_at: responseDueAt, resolution_due_at: resolutionDueAt })
        .eq('id', request.id)
      slaError = res.error
      if (!slaError) break
    }
    if (slaError) slaIncomplete = true
  }
  const policyTier = servicePolicy?.config?.[priority]
  if ((policyTier?.response_hours != null && !responseDueAt) || (policyTier?.resolution_hours != null && !resolutionDueAt)) slaIncomplete = true
  if (slaIncomplete) {
    logger.error({
      event: 'create_request.sla_missing',
      message: 'The ticket was created without (all of) its SLA deadlines',
      route: 'create-request-core.ts#createRequestCore',
      requestId: request.id,
      orgId,
      errorCode: 'sla_deadlines_missing',
      context: { priority, hadResponse: !!responseDueAt, hadResolution: !!resolutionDueAt },
    })
  }

  // The AC the requester chose (if the form has the AC-number field) is saved with the ticket as it was at this moment (before the rules run, so a rule can route by the AC's vendor, brand and region).
  if (acField && chosenAcValue && requesterStoreCode) {
    try {
      const activeUnits = await loadActiveAcUnits(admin, orgId, requesterStoreCode)
      const chosen = findSelectedUnit(activeUnits, chosenAcValue)
      if (chosen) await saveMasterSnapshot(admin, { requestId: request.id, kind: 'ac', units: [chosen] })
    } catch (e) {
      console.error('[createRequestCore] AC snapshot failed', e)
    }
  }

  if (!(acField && chosenAcValue) && acUnitsForRouting && acUnitsForRouting.length > 0) {
    try { await saveMasterSnapshot(admin, { requestId: request.id, kind: 'ac', units: acUnitsForRouting }) } catch (e) { console.error('[createRequestCore] AC snapshot (routing) failed', e) }
  }

  // A ticket of a Vendor Program has its sheet row saved BEFORE the rules run, so a rule that routes by the AC vendor / brand / place sees it (as it did with the old AC setting).
  try {
    await saveProgramRowsForRules(admin, { orgId, requestId: request.id, categoryId, storeCode: requesterStoreCode, machineValue: chosenMachineValue || (chosenAcValue || undefined) })
  } catch (e) {
    console.error('[createRequestCore] saving the program row before the rules failed', e)
  }

  // Business Rules: "created" trigger — assign/set priority/set status/notify
  // per whatever rules match this request. Channel-agnostic already; this is
  // the exact call Email Intake previously never made.
  try {
    const { runRulesForTrigger } = await import('@/lib/rules/run')
    await runRulesForTrigger('created', request.id)
    await markRulesRan(admin as never, request.id)
  } catch (e) {
    console.error('[createRequestCore] Business rules (created) failed', e)
  }

  // Activity log — creation must be recorded; surface failure to caller.
  const activityResult = await logActivity({
    requestId: request.id,
    actorId: actingUserId,
    action: 'created',
  })
  if (activityResult.error) {
    logger.error({ event: 'create_request.activity_missing', message: 'The ticket was created but its "created" history entry could not be written', route: 'create-request-core.ts#createRequestCore', requestId: request.id, orgId, errorCode: 'activity_insert_failed' })
  }

  // OEM auto-routing from the master sheets: a category set to "auto-send to the AC / Genset OEM" mails the ticket to the addresses of the store's rows in that
  // sheet; otherwise the AC Issues service (auto_oem_routing) does the same for AC, quietly when the store has nothing in the AC sheet.
  let categoryOemKind: OemKind | null = null
  let categoryName: string | null = null
  let categoryCvmApproval = false
  let categoryProgramId: string | null = null
  if (categoryId) {
    const { data: cat } = await admin.from('service_categories').select('name, auto_oem_kind, auto_cvm_approval, program_id').eq('id', categoryId).eq('org_id', orgId).maybeSingle()
    categoryName = cat?.name ?? null
    categoryOemKind = isOemKind(cat?.auto_oem_kind) ? cat.auto_oem_kind : null
    categoryCvmApproval = cat?.auto_cvm_approval === true
    categoryProgramId = (cat as { program_id?: string | null } | null)?.program_id ?? null
  }
  // A Vendor Program (Admin -> Vendor Programs) takes over a category it covers: its own sheet, mail and status, instead of the AC service flag. A program that is switched off
  // does nothing, and the ticket is a normal ticket.
  let program: ProgramRecord | null = null
  if (categoryProgramId) {
    try { program = await loadProgram(admin as never, orgId, categoryProgramId) } catch (e) { console.error('[createRequestCore] program lookup failed', e) }
  }
  const oemKind: OemKind | null = categoryProgramId ? null : (categoryOemKind ?? (service.auto_oem_routing ? 'ac' : null))
  if (program?.is_active) {
    try {
      const { data: authUser } = await admin.auth.admin.getUserById(requesterId)
      await runProgramRouting({
        admin, actorId: actingUserId, orgId, request, program, storeCode: requesterStoreCode, categoryName, title, description: oemDescription,
        requesterName: requesterProfile?.full_name ?? '', requesterEmail: formRequesterEmail || authUser?.user?.email || '', requesterPhone, storeAddress: requesterStoreAddress,
        machineValue: chosenMachineValue || undefined,
      })
    } catch (e) {
      console.error('[createRequestCore] program routing failed', e)
    }
  }
  if (oemKind) {
    try {
      const { data: authUser } = await admin.auth.admin.getUserById(requesterId)
      await runMasterOemRouting({
        admin,
        actorId: actingUserId,
        orgId,
        request,
        kind: oemKind,
        storeCode: requesterStoreCode,
        chosenAcValue,
        quiet: !categoryOemKind,
        categoryName,
        title,
        description: oemDescription,
        requesterName: requesterProfile?.full_name ?? '',
        requesterEmail: formRequesterEmail || authUser?.user?.email || '',
        requesterPhone,
        storeAddress: requesterStoreAddress,
      })
    } catch (e) {
      console.error('[createRequestCore] OEM auto-routing failed', e)
    }
  }

  // Automatic approval by the store's CVM (a category set to it, for example Fixture / Hangers / Fixture Attachments): In Process, sent to the CVM, on hold until the CVM decides.
  if (categoryCvmApproval) {
    // The CVM of the store comes from the CVM sheet (by e-mail) and must be an active staff member of CK Desk.
    let cvmId: string | null = null
    let cvmEmail: string | null = null
    if (requesterStoreCode) {
      cvmEmail = await loadCvmEmail(admin, orgId, requesterStoreCode)
      if (cvmEmail) cvmId = (await loadCvmCandidates(orgId)).byEmail.get(cvmEmail) ?? null
    }
    await runAutoCvmApproval({
      admin,
      orgId,
      request: { id: request.id, request_no: request.request_no ?? null, title },
      requesterId,
      actorId: actingUserId,
      hasStore: !!requesterProfile?.store_id,
      storeCvmId: cvmId,
      cvmEmailInSheet: cvmEmail,
    })
  }

  // The requester always gets a confirmation with the ticket number (unless an agent booked it
  // on their behalf, which has its own message just below).
  if (requesterId === actingUserId) {
    notifyRequesterTicketLogged({
      requesterId, actorId: actingUserId, requestId: request.id,
      requestNo: request.request_no ?? null, title, serviceName: service?.name ?? null,
    }).catch(() => {})
  }

  // Booked on behalf of someone else — let them know a request now exists for them.
  if (requesterId !== actingUserId) {
    notify({
      recipientId: requesterId,
      actorId: actingUserId,
      type: 'request_created',
      title: `A request was raised on your behalf: ${title}`,
      body: 'An agent submitted this request for you.',
      requestId: request.id,
      link: `/requests/${request.id}`,
      metadata: { audience: 'requester', requestNo: request.request_no ?? '', requestTitle: title, serviceName: service?.name ?? '' },
    }).catch(() => {})
  }

  // Notify team members about the new request. The Business Rules ("created") may have moved the ticket to another team (set_team), so the team is read again:
  // the pre-rule team would be told about a ticket that is no longer theirs, and the real one would hear nothing (B-26).
  {
    const { data: nowRow } = await admin.from('requests').select('team_id').eq('id', request.id).maybeSingle()
    const notifyTeamId = (nowRow?.team_id as string | undefined) ?? teamId
    const { data: teamMembers } = await admin
      .from('team_members')
      .select('user_id')
      .eq('team_id', notifyTeamId)
    for (const member of (teamMembers ?? []) as { user_id: string }[]) {
      if (member.user_id !== actingUserId && member.user_id !== requesterId) {
        notify({
          recipientId: member.user_id,
          actorId: actingUserId,
          type: 'request_created',
          title: `New request: ${title}`,
          body: 'A new request has been submitted that needs attention.',
          requestId: request.id,
          link: `/requests/${request.id}`,
          // In-app only — whoever it ends up assigned to gets their own "assigned to
          // you" email; a queue-broadcast email to every other team member too is noise.
          metadata: { audience: 'team' },
        }).catch(() => {})
      }
    }
  }

  // Approvals are initiated manually by the solver via "Send for Approval"
  // (or, for Email Intake's 'approval' payload type, as an explicit
  // follow-up step in lib/actions/intake/work.ts) — never auto-created here.

  if (!slaIncomplete) await markAutomationFinished(admin as never, request.id)
  return { requestId: request.id, requestNo: request.request_no }
}
