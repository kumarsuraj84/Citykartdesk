/**
 * What moving one Zoho ticket into CK Desk WOULD do - worked out from the saved mapping, with nothing written anywhere.
 * Pure (no database, no server-only import) so it can be tested on its own and used by the preview screen.
 *
 * The owner's basic mapping (Zoho -> CK Desk):
 *     Template -> Form Template               Template + Category -> Service    Sub Category -> Category    Item -> Sub Category
 *     Requester -> Requester                  Technician -> Technician          Status -> Status
 */
import { zohoRequestNo } from './number'
import { ckStatusLabel } from './suggest'

export type CkSubCategory = { id: string; name: string; categoryId: string; categoryName: string; slaPriority: string | null }
export type CkService = { id: string; name: string; defaultPriority: string; templateId: string | null; subCategories: CkSubCategory[] }
export type CkTemplate = { id: string; name: string }

export type Mappings = {
  /** Zoho template -> CK Desk form template id */
  templates: Map<string, string>
  /** `${template}|${category}` -> CK Desk service id ('' category = the template's default) */
  services: Map<string, string>
  /** `${template}|${category}|${subcategory}` -> CK Desk category id */
  categories: Map<string, string>
  /** `${template}|${category}|${subcategory}|${item}` -> CK Desk sub-category id */
  items: Map<string, string>
  /** `${template}|${zohoField}` -> CK Desk form field id */
  fields: Map<string, string>
  /** Zoho status -> CK Desk status */
  statuses: Map<string, string>
}

export type ZohoTicketForPlan = {
  displayId: number
  template: string | null
  category: string | null
  subcategory: string | null
  item: string | null
  status: string | null
  priority: string | null
  subject: string | null
  createdAt: string | null
  resolvedAt: string | null
  requesterName: string | null
  requesterEmail: string | null
  technicianName: string | null
  /** every Zoho field that holds a value on this ticket: key (column name, or `udf:<name>`) -> text */
  fields: Record<string, string>
}

/** How a person in Zoho was matched to a person in CK Desk. 'none' = no CK Desk person was found. */
export type PersonMatch = { how: 'saved' | 'email' | 'name' | 'none'; profileName?: string }

export type PlanProblemCode =
  | 'already_moved' | 'bad_number' | 'no_created_time'
  | 'template_unmapped' | 'service_template_mismatch' | 'service_unmapped' | 'category_unmapped' | 'sub_category_unmapped' | 'sub_category_wrong'
  | 'status_unmapped'
export type PlanProblem = { code: PlanProblemCode; text: string }

export type TicketPlan = {
  zohoNo: number
  newNo: string | null
  createdAt: string | null
  zoho: { template: string | null; category: string | null; subcategory: string | null; item: string | null; status: string | null; priority: string | null; requester: string | null; technician: string | null }
  template: { id: string; name: string } | null
  service: { id: string; name: string } | null
  category: { id: string; name: string } | null
  subCategory: { id: string; name: string } | null
  status: string | null
  statusLabel: string | null
  /** CK Desk's own priority rule: the sub-category's SLA priority, otherwise the service's default */
  priority: string | null
  requester: { name: string | null; email: string | null; how: PersonMatch['how'] | 'new-inactive' }
  technician: { zohoName: string | null; ckName: string | null; how: PersonMatch['how'] }
  mappedFields: { zohoField: string; ckFieldId: string; value: string }[]
  unmappedFields: string[]
  problems: PlanProblem[]
  /** true when nothing blocks the move */
  ready: boolean
}

export const serviceKey = (template: string, category: string) => `${template}|${category}`
export const categoryKey = (template: string, category: string, subcategory: string) => `${template}|${category}|${subcategory}`
export const itemKey = (template: string, category: string, subcategory: string, item: string) => `${template}|${category}|${subcategory}|${item}`
export const fieldKey = (template: string, zohoField: string) => `${template}|${zohoField}`

const s = (v: string | null | undefined) => String(v ?? '').trim()

export function planTicket(args: {
  ticket: ZohoTicketForPlan
  maps: Mappings
  services: Map<string, CkService>
  templates: Map<string, CkTemplate>
  requester: PersonMatch
  technician: PersonMatch
  alreadyMoved: boolean
}): TicketPlan {
  const { ticket: t, maps, services, templates, requester, technician, alreadyMoved } = args
  const problems: PlanProblem[] = []
  const template = s(t.template), cat = s(t.category), sub = s(t.subcategory), item = s(t.item)

  const newNo = zohoRequestNo(t.displayId)
  if (!newNo) problems.push({ code: 'bad_number', text: 'The Zoho ticket number is not a plain number.' })
  if (alreadyMoved) problems.push({ code: 'already_moved', text: 'This ticket has already been moved to CK Desk.' })
  if (!t.createdAt) problems.push({ code: 'no_created_time', text: 'Zoho has no created time for this ticket.' })

  // ── Template -> Form Template ────────────────────────────────────────────────────────────────────────────────────────
  const templateId = maps.templates.get(template) ?? null
  const ckTemplate = templateId ? templates.get(templateId) ?? null : null
  if (!ckTemplate) problems.push({ code: 'template_unmapped', text: `Zoho template "${template || '(none)'}" is not mapped to a CK Desk form template yet.` })

  // ── Template + Category -> Service ───────────────────────────────────────────────────────────────────────────────────
  const serviceId = maps.services.get(serviceKey(template, cat)) ?? maps.services.get(serviceKey(template, '')) ?? null
  const service = serviceId ? services.get(serviceId) ?? null : null
  if (!service) {
    problems.push({ code: 'service_unmapped', text: `Zoho service "${template || '(none)'}" with category "${cat || '(none)'}" is not mapped to a CK Desk service yet.` })
  }

  if (service && ckTemplate && service.templateId !== ckTemplate.id) {
    problems.push({ code: 'service_template_mismatch', text: `CK Desk service "${service.name}" does not use the form template "${ckTemplate.name}" that this Zoho template is mapped to, so the answers would not fit its form.` })
  }

  // ── Sub Category -> Category,  Item -> Sub Category ──────────────────────────────────────────────────────────────────
  let category: { id: string; name: string } | null = null
  let subCategory: CkSubCategory | null = null
  if (service) {
    const needsCategory = service.subCategories.length > 0
    const categoryId = maps.categories.get(categoryKey(template, cat, sub)) ?? maps.categories.get(categoryKey(template, cat, '')) ?? null
    const inCategory = categoryId ? service.subCategories.filter((x) => x.categoryId === categoryId) : []
    if (categoryId && inCategory.length > 0) category = { id: categoryId, name: inCategory[0].categoryName }
    else if (categoryId && needsCategory) problems.push({ code: 'category_unmapped', text: `The mapped CK Desk category is not one of "${service.name}" categories any more. Fix the mapping.` })
    else if (!categoryId && needsCategory) problems.push({ code: 'category_unmapped', text: `Zoho sub category "${sub || '(none)'}" is not mapped to a CK Desk category of "${service.name}" yet.` })

    if (category) {
      const itemId = maps.items.get(itemKey(template, cat, sub, item)) ?? maps.items.get(itemKey(template, cat, sub, '')) ?? null
      if (itemId) {
        subCategory = inCategory.find((x) => x.id === itemId) ?? null
        if (!subCategory) problems.push({ code: 'sub_category_wrong', text: 'The mapped CK Desk sub-category is not in the mapped category any more. Fix the mapping.' })
      } else if (inCategory.length === 1) {
        subCategory = inCategory[0] // the category has only one sub-category: no choice to make
      } else {
        problems.push({ code: 'sub_category_unmapped', text: `Zoho item "${item || '(none)'}" is not mapped to a CK Desk sub-category of "${category.name}" yet.` })
      }
    }
  }

  // ── Status ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  const status = maps.statuses.get(s(t.status)) ?? null
  if (!status) problems.push({ code: 'status_unmapped', text: `The Zoho status "${s(t.status) || '(none)'}" is not mapped to a CK Desk status yet.` })

  // ── Zoho fields -> CK Desk form fields (extra) ──────────────────────────────────────────────────────────────────────
  const mappedFields: TicketPlan['mappedFields'] = []
  const unmappedFields: string[] = []
  for (const [zohoField, value] of Object.entries(t.fields)) {
    const ck = maps.fields.get(fieldKey(template, zohoField))
    if (ck) mappedFields.push({ zohoField, ckFieldId: ck, value })
    else unmappedFields.push(zohoField)
  }

  return {
    zohoNo: t.displayId,
    newNo,
    createdAt: t.createdAt,
    zoho: { template: template || null, category: cat || null, subcategory: sub || null, item: item || null, status: s(t.status) || null, priority: s(t.priority) || null, requester: s(t.requesterName) || null, technician: s(t.technicianName) || null },
    template: ckTemplate ? { id: ckTemplate.id, name: ckTemplate.name } : null,
    service: service ? { id: service.id, name: service.name } : null,
    category,
    subCategory: subCategory ? { id: subCategory.id, name: subCategory.name } : null,
    status,
    statusLabel: status ? ckStatusLabel(status) : null,
    priority: service ? subCategory?.slaPriority ?? service.defaultPriority : null,
    requester: { name: requester.profileName ?? (s(t.requesterName) || null), email: s(t.requesterEmail) || null, how: requester.how === 'none' ? 'new-inactive' : requester.how },
    technician: { zohoName: s(t.technicianName) || null, ckName: technician.profileName ?? null, how: technician.how },
    mappedFields,
    unmappedFields,
    problems,
    ready: problems.length === 0,
  }
}

/** The short reason text shown in the "why can't it move" summary. */
export const PROBLEM_TITLES: Record<PlanProblemCode, string> = {
  already_moved: 'Already moved',
  bad_number: 'Ticket number not a plain number',
  no_created_time: 'No created time in Zoho',
  template_unmapped: 'Zoho template not mapped',
  service_template_mismatch: 'Service does not use the mapped form template',
  service_unmapped: 'Zoho service + category not mapped',
  category_unmapped: 'Zoho sub category not mapped',
  sub_category_unmapped: 'Zoho item not mapped',
  sub_category_wrong: 'Mapped sub-category no longer valid',
  status_unmapped: 'Zoho status not mapped',
}
