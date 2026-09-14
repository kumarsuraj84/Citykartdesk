import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activity'
import { notify } from '@/lib/notifications'
import { resolveSlaDeadlines } from '@/lib/sla/resolve'
import { resolveServiceFormSections } from '@/lib/forms/sections'
import { validateRequesterFormCompletion } from '@/lib/requests/validate-requester-form-completion'
import { resolveSubCategoryForService } from '@/lib/requests/resolve-sub-category'
import { sendEmail } from '@/lib/email/send'
import { escapeHtml } from '@/lib/email/escape'
import { sanitizeError } from '@/lib/observability/sanitize-error'
import type { FormField, RequestPriority } from '@/types'
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

// ── AC Issues-style OEM auto-routing ──────────────────────────────────────────
// Fires once, right after a request is created, only when the service is
// flagged auto_oem_routing AND the requester's store (stores.oem_id) is
// actually mapped to an OEM — an unmapped store's ticket stays a normal
// manual ticket, per the confirmed product decision. Uses the admin client
// throughout since this is a system-triggered action with no interactive
// human actor at ticket-creation time. Channel-agnostic already — moved here
// unchanged from lib/actions/requests.ts as part of the createRequestCore()
// extraction (Stage 1).
async function runOemAutoRouting(params: {
  admin: ReturnType<typeof createAdminClient>
  actorId: string
  orgId: string
  request: { id: string; request_no: string }
  autoOemRouting: boolean | null | undefined
  storeOemId: string | null
  title: string
  description: string
  requesterName: string
  requesterEmail: string
  requesterPhone: string
  storeAddress: string | null
}): Promise<void> {
  const { admin, actorId, orgId, request, autoOemRouting, storeOemId } = params
  if (!autoOemRouting || !storeOemId) return

  // org_id filter: storeOemId already came from an org-scoped stores lookup
  // upstream, but re-checking here keeps this function safe to call with any
  // id, rather than relying on every future caller to have pre-scoped it.
  const { data: oem } = await admin
    .from('oems')
    .select('name, emails, email_subject_template, email_body_template, is_active')
    .eq('id', storeOemId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (!oem || !oem.is_active || !oem.emails || oem.emails.length === 0) return

  const vars: Record<string, string> = {
    ticket_no: request.request_no,
    subject: params.title,
    description: params.description || '(no description provided)',
    requester_name: params.requesterName,
    requester_email: params.requesterEmail,
    requester_phone: params.requesterPhone || '(not provided)',
    store_address: params.storeAddress || '(no address on file)',
  }
  const render = (tpl: string) => tpl.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => vars[key] ?? '')

  const subject = render(oem.email_subject_template || 'New AC Issue Ticket — {{ticket_no}}')
  const bodyText = render(
    oem.email_body_template ||
      'A new AC issue ticket has been raised.\n\nTicket: {{ticket_no}}\nSubject: {{subject}}\nDescription: {{description}}\n\nRequester: {{requester_name}} ({{requester_email}}, {{requester_phone}})\nStore Address: {{store_address}}'
  )
  // D-05: bodyText is built from a {{var}}-substituted template — ticket
  // subject/description/requester fields are all user-controlled — so the
  // HTML rendering (not the parallel plain-text `text` field below) must
  // escape each line before wrapping it in a tag.
  const bodyHtml = bodyText.split('\n').map((line) => `<p>${line ? escapeHtml(line) : '&nbsp;'}</p>`).join('')

  await Promise.all(
    (oem.emails as string[]).map((to) => sendEmail({ to, subject, html: bodyHtml, text: bodyText }))
  )

  await admin.from('request_comments').insert({
    request_id: request.id,
    author_id: actorId,
    body: `Ticket sent to ${oem.name} (${(oem.emails as string[]).join(', ')}) for servicing.`,
    is_internal: false,
  })

  // Conditioned on .eq('status','open') because a Business Rule's "created"
  // trigger runs earlier in createRequestCore() and may have already moved
  // the ticket off 'open' (e.g. auto-set to a different status) — checking
  // the returned row before logging keeps the activity trail honest instead
  // of recording a status change that silently didn't happen.
  const nowIso = new Date().toISOString()
  const { data: statusUpdated } = await admin
    .from('requests')
    .update({ status: 'in_progress', responded_at: nowIso })
    .eq('id', request.id)
    .eq('status', 'open')
    .select('id')
    .maybeSingle()

  if (statusUpdated) {
    await logActivity({
      requestId: request.id,
      actorId,
      action: 'status_changed',
      metadata: { from: 'open', to: 'in_progress', automated: true, oem: oem.name },
    })
  }
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
   *  is always folded in as `created_via`. Omit both this and
   *  intakeMessageId (the web channel does) to leave source_metadata/
   *  intake_message_id unset, exactly matching today's web-created rows. */
  sourceMetadata?: Record<string, unknown>
  /** Whether `client`'s writes should run through it directly, or be forced
   *  through the admin client instead. Required whenever `client` has no RLS
   *  session bound to `requesterId` — the web "book on behalf of" case, and
   *  always true for a channel with no browser session at all. */
  useAdminForWrites?: boolean
  /** Web-only: a plain 'user' role submitting a request for a service
   *  restricted to specific Locations is blocked, matching the catalog
   *  page's own filter — re-checked here as defense-in-depth against a
   *  direct call using a known service_id. Agent-tier actors are exempt.
   *  Pass the ACTING user's role/location (not the requester's — an agent
   *  booking on behalf of someone at a different location is still exempt,
   *  matching the original behavior). Omit for a channel where this
   *  particular check doesn't apply the same way. */
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
  } = params

  const admin = createAdminClient()
  const writeClient: AnyClient = useAdminForWrites ? admin : client
  const parsedFormData: Record<string, unknown> = { ...rawFormData }

  const { data: service, error: serviceError } = await client
    .from('services')
    .select('*, team:teams (*), template:form_templates (form_sections), sla_policy:sla_policies (config)')
    .eq('id', serviceId)
    .eq('org_id', orgId)
    .eq('is_active', true)
    .single()

  if (serviceError || !service) return { error: 'Service not found.' }

  // Location-scoped visibility — see actingUserRoleForLocationCheck's doc comment.
  if (actingUserRoleForLocationCheck === 'user') {
    const { data: locationTags } = await client
      .from('service_location_tags')
      .select('location_id')
      .eq('service_id', serviceId)
    const restrictedTo = (locationTags ?? []).map((t: { location_id: string }) => t.location_id)
    if (restrictedTo.length > 0 && !restrictedTo.includes(actingUserLocationId ?? '')) {
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
  // `.single()` on zero matching rows errors, but only `data` was
  // destructured, so a `requesterId` that doesn't exist (or belongs to a
  // DIFFERENT org than `orgId`, e.g. a compromised/buggy admin-client caller)
  // fell through silently. With `client` as an RLS-scoped session this was
  // low-risk (RLS already constrains what's visible), but createRequestCore()
  // is explicitly designed to also be called with the admin client (no RLS)
  // by a channel with no browser session — for that caller this was a real
  // cross-tenant gap: a request could be inserted with `org_id: orgId` while
  // `requester_id` silently referenced a profile in a different org.
  const { data: requesterProfile, error: requesterProfileError } = await client
    .from('profiles')
    .select('org_id, store_id, full_name')
    .eq('id', requesterId)
    .eq('org_id', orgId)
    .single()

  if (requesterProfileError || !requesterProfile) return { error: 'Requester not found.' }

  let requesterStoreAddress: string | null = null
  let requesterStoreOemId: string | null = null
  if (requesterProfile?.store_id) {
    const { data: store } = await admin
      .from('stores')
      .select('address, oem_id')
      .eq('id', requesterProfile.store_id)
      .eq('org_id', orgId)
      .maybeSingle()
    requesterStoreAddress = store?.address ?? null
    requesterStoreOemId = store?.oem_id ?? null
  }

  // Always system-populated, never trust whatever (if anything) the caller
  // submitted for it.
  for (const field of allFields) {
    if (field.type === 'store_address') {
      parsedFormData[field.id] = requesterStoreAddress ?? ''
    }
  }

  // ── Mandatory-field completion gate — the same check every channel must
  // pass before a ticket can be created (Stage 1C). File-field required-ness
  // stays client-side-only for now (see validateRequesterFormCompletion's
  // own doc comment) — request_attachments.request_id is a NOT NULL FK, so
  // no channel can have a real file value in formData at this point anyway.
  const completion = validateRequesterFormCompletion({ service, formData: parsedFormData })
  if (!completion.valid) {
    const firstIssue = completion.missingFields[0] ?? completion.invalidFields[0]
    const message = completion.missingFields[0]
      ? `${firstIssue.label} is required.`
      : (completion.invalidFields[0]?.message ?? 'Invalid request.')
    return { error: message }
  }
  const requesterFields = completion.requesterFields

  // ── Request title ──────────────────────────────────────────────────────────
  // Priority: text → textarea → select value → radio value → multiselect (joined) → service name
  const titleField =
    requesterFields.find((f) => f.type === 'text') ??
    requesterFields.find((f) => f.type === 'textarea') ??
    requesterFields.find((f) => (f.type === 'select' || f.type === 'radio') && parsedFormData[f.id]) ??
    requesterFields.find((f) => f.type === 'multiselect' && Array.isArray(parsedFormData[f.id]) && (parsedFormData[f.id] as string[]).length > 0)

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
  const title = sanitizeTrustedTitle(titleOverride) ?? (titleValue ? `${service.name}: ${titleValue}` : service.name)

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
    if (!overrideTeam) return { error: 'Selected team not found.' }
    teamId = teamIdOverride
  }

  const mergedSourceMetadata: Record<string, unknown> | undefined =
    sourceMetadata || intakeMessageId
      ? { ...(sourceMetadata ?? {}), created_via: source }
      : undefined

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
      response_due_at: responseDueAt,
      resolution_due_at: resolutionDueAt,
      project_id: projectId,
      intake_message_id: intakeMessageId,
      source_metadata: mergedSourceMetadata as Json | undefined,
    })
    .select('id, request_no')
    .single()

  if (insertError || !request) {
    return { error: sanitizeError(insertError, { route: 'create-request-core.ts#createRequestCore', fallback: 'Failed to create request.' }) }
  }

  // Business Rules: "created" trigger — assign/set priority/set status/notify
  // per whatever rules match this request. Channel-agnostic already; this is
  // the exact call Email Intake previously never made.
  try {
    const { runRulesForTrigger } = await import('@/lib/rules/run')
    await runRulesForTrigger('created', request.id)
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
    console.error('[createRequestCore] Activity log failed for request', request.id)
  }

  // AC Issues-style OEM auto-routing.
  if (service.auto_oem_routing && requesterStoreOemId) {
    try {
      const { data: authUser } = await admin.auth.admin.getUserById(requesterId)
      await runOemAutoRouting({
        admin,
        actorId: actingUserId,
        orgId,
        request,
        autoOemRouting: service.auto_oem_routing,
        storeOemId: requesterStoreOemId,
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
    }).catch(() => {})
  }

  // Notify team members about the new request.
  {
    const { data: teamMembers } = await admin
      .from('team_members')
      .select('user_id')
      .eq('team_id', teamId)
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
        }).catch(() => {})
      }
    }
  }

  // Approvals are initiated manually by the solver via "Send for Approval"
  // (or, for Email Intake's 'approval' payload type, as an explicit
  // follow-up step in lib/actions/intake/work.ts) — never auto-created here.

  return { requestId: request.id, requestNo: request.request_no }
}
