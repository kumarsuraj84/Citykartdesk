import Link from 'next/link'
import { PageHeader } from '@/components/ui/PageHeader'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { zohoDbStatus } from '@/lib/zoho/db'
import { NotConnected } from '../_components/NotConnected'
import {
  loadCkCatalogue, loadPeopleDirectory, loadSavedMapping, loadZohoFacts, loadZohoPeople, matchPerson, personKey, savedPeopleMap,
} from '@/lib/zoho/transfer/data'
import { TemplateMapper, type SavedForTemplate } from './TemplateMapper'
import { PeopleMapper, StatusMapper, type PersonRow } from './StatusAndPeopleMappers'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Zoho to CK Desk mapping' }

type Search = { tab?: string; template?: string }
const SEP = '\u0001'

const TABS = [
  { key: 'templates', label: 'Templates, services, categories' },
  { key: 'statuses', label: 'Statuses' },
  { key: 'requesters', label: 'Requesters' },
  { key: 'technicians', label: 'Technicians' },
] as const

export default async function ZohoMappingPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams
  const profile = await getCurrentProfile()
  const status = zohoDbStatus()
  const head = <PageHeader title="Zoho → CK Desk mapping" description="Say once how Zoho's words become CK Desk's words. Nothing is moved from this page." />
  if (!status.ready) return <div className="space-y-4">{head}<NotConnected reason={status.reason} /></div>
  const orgId = profile?.org_id as string | undefined
  if (!orgId) return <div className="space-y-4">{head}<p className="text-sm text-muted-foreground">Your account is not linked to an organisation.</p></div>
  const canEdit = ['admin', 'platform_owner'].includes(profile?.role ?? '')
  const tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as (typeof TABS)[number]['key']) : 'templates'

  // The data is read inside the try; the page is built OUTSIDE it (JSX is never built inside a try/catch).
  type Facts = Awaited<ReturnType<typeof loadZohoFacts>>
  type Cat = Awaited<ReturnType<typeof loadCkCatalogue>>
  type Saved = Awaited<ReturnType<typeof loadSavedMapping>>
  let data: { facts: Facts; cat: Cat; saved: Saved; people?: { kind: 'requester' | 'technician'; rows: PersonRow[]; matched: number; total: number; emailsRead: boolean; options: { id: string; label: string }[] } } | null = null
  let failure: string | null = null
  try {
    const [facts, cat, saved] = await Promise.all([loadZohoFacts(), loadCkCatalogue(orgId), loadSavedMapping(orgId)])
    data = { facts, cat, saved }
    if (tab === 'requesters' || tab === 'technicians') {
      const kind = tab === 'requesters' ? 'requester' : 'technician'
      const [dir, zohoPeople] = await Promise.all([loadPeopleDirectory(orgId), loadZohoPeople(kind)])
      const hand = savedPeopleMap(saved, kind, dir)
      const rows: PersonRow[] = zohoPeople.map((z) => {
        const m = matchPerson(dir, hand, { email: z.email, name: z.name })
        return { key: personKey(z.email, z.name), name: z.name, email: z.email, tickets: z.tickets, how: m.how, ckName: m.profileName ?? null, savedProfileId: hand.get(personKey(z.email, z.name))?.id ?? null }
      })
      data.people = {
        kind, rows: [...rows.filter((r) => r.how === 'none'), ...rows.filter((r) => r.how !== 'none')].slice(0, 400),
        matched: rows.filter((r) => r.how !== 'none').length, total: rows.length, emailsRead: dir.emailsRead,
        options: dir.people.filter((p) => kind === 'requester' || ['agent', 'manager', 'admin', 'platform_owner'].includes(p.role)).sort((x, y) => x.name.localeCompare(y.name))
          .map((p) => ({ id: p.id, label: `${p.name}${p.email ? ` — ${p.email}` : ''}${p.active ? '' : ' (inactive)'}` })),
      }
    }
  } catch (e) {
    failure = e instanceof Error ? e.message : 'The Zoho data could not be read.'
  }

  let body: React.ReactNode = null
  if (failure || !data) {
    body = <NotConnected reason={failure ?? 'The Zoho data could not be read.'} />
  } else {
    const { facts, cat, saved } = data
    const tplMapped = new Set(saved.templates.map((r) => r.zoho_template))
    const statusMapped = new Set(saved.statuses.map((r) => r.zoho_value))
    const progress = (
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Zoho templates mapped" value={`${facts.templates.filter((t) => tplMapped.has(t.template)).length} of ${facts.templates.length}`} />
        <Stat label="Zoho statuses mapped" value={`${facts.statuses.filter((s) => statusMapped.has(s.status)).length} of ${facts.statuses.length}`} />
        <Stat label="Zoho tickets in the copy" value={facts.total.toLocaleString('en-IN')} />
      </div>
    )
    let inner: React.ReactNode = null
    if (tab === 'templates') {
      const chosen = facts.templates.find((t) => t.template === sp.template) ?? facts.templates[0]
      const forTemplate: SavedForTemplate = {
        formTemplateId: saved.templates.find((r) => r.zoho_template === chosen?.template)?.form_template_id ?? null,
        services: Object.fromEntries(saved.services.filter((r) => r.zoho_template === chosen?.template).map((r) => [r.zoho_category, r.service_id])),
        categories: Object.fromEntries(saved.categories.filter((r) => r.zoho_template === chosen?.template).map((r) => [`${r.zoho_category}${SEP}${r.zoho_subcategory}`, r.category_id])),
        items: Object.fromEntries(saved.items.filter((r) => r.zoho_template === chosen?.template).map((r) => [`${r.zoho_category}${SEP}${r.zoho_subcategory}${SEP}${r.zoho_item}`, r.sub_category_id])),
        fields: Object.fromEntries(saved.fields.filter((r) => r.zoho_template === chosen?.template).map((r) => [r.zoho_field, r.ck_field_id])),
      }
      inner = (
        <div className="space-y-3">
          <nav aria-label="Zoho templates" className="flex flex-wrap gap-1.5">
            {facts.templates.map((t) => {
              const active = t.template === chosen?.template
              return (
                <Link key={t.template || '__blank'} href={`/zoho/mapping?tab=templates&template=${encodeURIComponent(t.template)}`} aria-current={active ? 'page' : undefined}
                  className={`rounded-full border px-3 py-1 text-xs ${active ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground hover:bg-muted'}`}>
                  {t.template || '(blank)'} <span className="opacity-70">· {t.tickets.toLocaleString('en-IN')}</span>{tplMapped.has(t.template) && <span aria-label="mapped"> ✓</span>}
                </Link>
              )
            })}
          </nav>
          {chosen && (
            <TemplateMapper key={chosen.template} zohoTemplate={chosen.template} tickets={chosen.tickets}
              tree={facts.tree.filter((r) => r.template === chosen.template).map(({ category, subcategory, item, tickets }) => ({ category, subcategory, item, tickets }))}
              fieldUse={facts.fieldUse.filter((f) => f.template === chosen.template).map(({ field, label, tickets }) => ({ field, label, tickets }))}
              services={cat.services.map((s) => ({ id: s.id, name: s.name, templateId: s.templateId, subCategories: s.subCategories.map(({ id, name, categoryId, categoryName }) => ({ id, name, categoryId, categoryName })) }))}
              templates={cat.templates.map((t) => ({ id: t.id, name: t.name, fields: t.fields }))}
              saved={forTemplate} canEdit={canEdit} />
          )}
        </div>
      )
    } else if (tab === 'statuses') {
      inner = <StatusMapper rows={facts.statuses} saved={Object.fromEntries(saved.statuses.map((r) => [r.zoho_value, r.ck_value]))} canEdit={canEdit} />
    } else if (data.people) {
      const p = data.people
      inner = (
        <div className="space-y-3">
          {!p.emailsRead && <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">CK Desk sign-in accounts could not be read just now, so e-mail matching is off. Matching by name still works.</p>}
          <PeopleMapper kind={p.kind} rows={p.rows} counts={{ total: p.total, matched: p.matched }} canEdit={canEdit} options={p.options} />
        </div>
      )
    }
    body = <div className="space-y-4">{progress}{inner}</div>
  }

  return (
    <div className="space-y-4">
      {head}
      <nav aria-label="Mapping sections" className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <Link key={t.key} href={`/zoho/mapping?tab=${t.key}`} aria-current={tab === t.key ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === t.key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{t.label}</Link>
        ))}
      </nav>
      {body}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums text-foreground">{value}</p>
    </div>
  )
}
