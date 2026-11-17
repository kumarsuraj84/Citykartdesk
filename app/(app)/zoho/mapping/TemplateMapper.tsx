'use client'

import { useMemo, useState, useTransition } from 'react'
import { CheckCircle2, Sparkles } from 'lucide-react'
import { saveTemplateMapping } from '@/lib/actions/zohoTransfer'
import { bestMatch } from '@/lib/zoho/transfer/suggest'

export type MapperService = { id: string; name: string; templateId: string | null; subCategories: { id: string; name: string; categoryId: string; categoryName: string }[] }
export type MapperTemplate = { id: string; name: string; fields: { id: string; label: string; type: string }[] }
export type SavedForTemplate = {
  formTemplateId: string | null
  services: Record<string, string>      // category -> service id ('' = the template's default)
  categories: Record<string, string>    // category SEP sub category -> CK category id
  items: Record<string, string>         // category SEP sub category SEP item -> CK sub-category id
  fields: Record<string, string>        // zoho field -> CK field id
}
const SEP = '\u0001'
const sel = 'w-full min-w-[10rem] rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground disabled:opacity-60'

type Props = {
  zohoTemplate: string
  tickets: number
  tree: { category: string; subcategory: string; item: string; tickets: number }[]
  fieldUse: { field: string; label: string; tickets: number }[]
  services: MapperService[]
  templates: MapperTemplate[]
  saved: SavedForTemplate
  canEdit: boolean
}

export function TemplateMapper({ zohoTemplate, tickets, tree, fieldUse, services, templates, saved, canEdit }: Props) {
  const [tpl, setTpl] = useState<string>(saved.formTemplateId ?? '')
  const [svc, setSvc] = useState<Record<string, string>>(saved.services)
  const [cats, setCats] = useState<Record<string, string>>(saved.categories)
  const [items, setItems] = useState<Record<string, string>>(saved.items)
  const [fields, setFields] = useState<Record<string, string>>(saved.fields)
  const [suggested, setSuggested] = useState<Set<string>>(new Set())
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()

  const svcById = useMemo(() => new Map(services.map((s) => [s.id, s])), [services])
  const tplFields = templates.find((t) => t.id === tpl)?.fields ?? []

  // the Zoho categories, each with its sub categories, each with its items
  const zohoCats = useMemo(() => {
    const m = new Map<string, Map<string, { item: string; tickets: number }[]>>()
    for (const r of tree) {
      const subs = m.get(r.category) ?? new Map<string, { item: string; tickets: number }[]>()
      subs.set(r.subcategory, [...(subs.get(r.subcategory) ?? []), { item: r.item, tickets: r.tickets }])
      m.set(r.category, subs)
    }
    return [...m.entries()]
  }, [tree])
  const countOf = (cat: string, sub?: string) => tree.filter((r) => r.category === cat && (sub === undefined || r.subcategory === sub)).reduce((a, r) => a + r.tickets, 0)

  const serviceFor = (cat: string) => svcById.get(svc[cat] || svc[''] || '') ?? null
  const ckCategoriesOf = (s: MapperService | null) => {
    const seen = new Map<string, { id: string; name: string }>()
    for (const x of s?.subCategories ?? []) if (!seen.has(x.categoryId)) seen.set(x.categoryId, { id: x.categoryId, name: x.categoryName })
    return [...seen.values()]
  }
  const sortedServices = useMemo(() => [...services].sort((a, b) => Number(b.templateId === tpl) - Number(a.templateId === tpl) || a.name.localeCompare(b.name)), [services, tpl])

  const markHand = (key: string) => setSuggested((p) => { if (!p.has(key)) return p; const n = new Set(p); n.delete(key); return n })

  function suggestAll() {
    const mark = new Set<string>()
    const nextTpl = tpl || bestMatch(zohoTemplate, templates)?.id || ''
    if (!tpl && nextTpl) { setTpl(nextTpl); mark.add('tpl') }
    const usable = services.filter((s) => s.templateId === nextTpl)
    const nSvc = { ...svc }
    const wanted = ['', ...zohoCats.map(([c]) => c).filter((c) => c !== '')]
    for (const c of wanted) {
      if (nSvc[c]) continue
      const pick = (c !== '' ? bestMatch(c, usable) ?? bestMatch(c, services) : null) ?? (c === '' && usable.length === 1 ? usable[0] : null)
      if (pick) { nSvc[c] = pick.id; mark.add(`svc${SEP}${c}`) }
    }
    setSvc(nSvc)
    const nCats = { ...cats }, nItems = { ...items }
    for (const [c, subs] of zohoCats) {
      const s = svcById.get(nSvc[c] || nSvc[''] || '') ?? null
      const ckCats = ckCategoriesOf(s)
      for (const [sub, its] of subs) {
        const ck = `${c}${SEP}${sub}`
        if (!nCats[ck]) { const pick = bestMatch(sub, ckCats) ?? (ckCats.length === 1 ? ckCats[0] : null); if (pick) { nCats[ck] = pick.id; mark.add(`cat${SEP}${ck}`) } }
        const subsOf = (s?.subCategories ?? []).filter((x) => x.categoryId === nCats[ck])
        for (const it of its) {
          const ik = `${ck}${SEP}${it.item}`
          if (!nItems[ik]) { const pick = bestMatch(it.item, subsOf) ?? (subsOf.length === 1 ? subsOf[0] : null); if (pick) { nItems[ik] = pick.id; mark.add(`item${SEP}${ik}`) } }
        }
      }
    }
    setCats(nCats); setItems(nItems)
    const nFields = { ...fields }
    const tf = templates.find((t) => t.id === nextTpl)?.fields ?? []
    for (const f of fieldUse) {
      if (nFields[f.field]) continue
      const pick = bestMatch(f.label, tf.map((x) => ({ id: x.id, name: x.label })))
      if (pick) { nFields[f.field] = pick.id; mark.add(`fld${SEP}${f.field}`) }
    }
    setFields(nFields)
    setSuggested(mark)
    setMsg({ ok: true, text: mark.size ? `${mark.size} suggestions filled in (shown in yellow). Check them, change any that are wrong, then Save.` : 'Nothing more to suggest. Choose the rest by hand.' })
  }

  function save() {
    setMsg(null)
    start(async () => {
      const res = await saveTemplateMapping({
        zohoTemplate,
        formTemplateId: tpl || null,
        services: Object.entries(svc).map(([category, serviceId]) => ({ category, serviceId: serviceId || null })),
        categories: Object.entries(cats).map(([k, categoryId]) => { const [category, subcategory] = k.split(SEP); return { category, subcategory, categoryId: categoryId || null } }),
        items: Object.entries(items).map(([k, subCategoryId]) => { const [category, subcategory, item] = k.split(SEP); return { category, subcategory, item, subCategoryId: subCategoryId || null } }),
        fields: Object.entries(fields).map(([zohoField, ckFieldId]) => ({ zohoField, ckFieldId: ckFieldId || null })),
      })
      if (res.error) setMsg({ ok: false, text: res.error })
      else { setSuggested(new Set()); setMsg({ ok: true, text: `Saved (${res.saved ?? 0} choices).` }) }
    })
  }

  const hint = (k: string) => (suggested.has(k) ? ' bg-yellow-100 dark:bg-yellow-950/40' : '')
  const label = (t: string) => (t === '' ? '(blank in Zoho)' : t)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Zoho template: {label(zohoTemplate)}</h2>
          <p className="text-xs text-muted-foreground">{tickets.toLocaleString('en-IN')} Zoho tickets use it.</p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button type="button" onClick={suggestAll} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
              <Sparkles className="h-3.5 w-3.5" /> Suggest the blanks
            </button>
            <button type="button" onClick={save} disabled={pending} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60">
              {pending ? 'Saving…' : 'Save this template'}
            </button>
          </div>
        )}
      </div>
      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={`flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs ${msg.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300' : 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300'}`}>
          {msg.ok && <CheckCircle2 className="h-3.5 w-3.5" />}{msg.text}
        </p>
      )}
      {!canEdit && <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">You can look at the mapping. Only an administrator can change it.</p>}

      {/* 1. template */}
      <section className="rounded-lg border border-border bg-card p-3">
        <h3 className="text-sm font-semibold text-foreground">1. Zoho Template → CK Desk Form Template</h3>
        <p className="mb-2 text-[11px] text-muted-foreground">The form template decides which CK Desk fields the Zoho fields can fill (step 5), and the service chosen in step 2 must use it.</p>
        <select aria-label={`CK Desk form template for the Zoho template ${label(zohoTemplate)}`} className={sel + hint('tpl')} value={tpl} disabled={!canEdit} onChange={(e) => { setTpl(e.target.value); markHand('tpl') }}>
          <option value="">— not mapped —</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </section>

      {/* 2. category -> service */}
      <section className="rounded-lg border border-border bg-card p-3">
        <h3 className="text-sm font-semibold text-foreground">2. Zoho Category → CK Desk Service</h3>
        <p className="mb-2 text-[11px] text-muted-foreground">The first row is the default for any Zoho category not listed. Services that use the form template chosen above are shown first.</p>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Zoho category to CK Desk service">
          <table className="w-full text-left text-xs">
            <thead><tr className="border-b border-border text-muted-foreground"><th className="py-1 pr-3 font-medium">Zoho category</th><th className="py-1 pr-3 font-medium">Tickets</th><th className="py-1 font-medium">CK Desk service</th></tr></thead>
            <tbody>
              {['', ...zohoCats.map(([c]) => c).filter((c) => c !== '')].map((c) => (
                <tr key={c || '__default'} className="border-b border-border/60">
                  <td className="py-1 pr-3 text-foreground">{c === '' ? <em>Any other category (template default)</em> : c}</td>
                  <td className="py-1 pr-3 tabular-nums text-muted-foreground">{c === '' ? tickets.toLocaleString('en-IN') : countOf(c).toLocaleString('en-IN')}</td>
                  <td className="py-1">
                    <select aria-label={`CK Desk service for Zoho category ${c || 'default'}`} className={sel + hint(`svc${SEP}${c}`)} value={svc[c] ?? ''} disabled={!canEdit}
                      onChange={(e) => { setSvc((p) => ({ ...p, [c]: e.target.value })); markHand(`svc${SEP}${c}`) }}>
                      <option value="">— not mapped —</option>
                      {sortedServices.map((s) => <option key={s.id} value={s.id}>{s.name}{s.templateId === tpl && tpl ? ' ✓' : ''}</option>)}
                    </select>
                    {svc[c] && tpl && svcById.get(svc[c])?.templateId !== tpl && <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-400">This service does not use the form template chosen in step 1.</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 3 + 4. sub category -> category, item -> sub-category */}
      <section className="rounded-lg border border-border bg-card p-3">
        <h3 className="text-sm font-semibold text-foreground">3. Zoho Sub Category → CK Desk Category &nbsp;·&nbsp; 4. Zoho Item → CK Desk Sub Category</h3>
        <p className="mb-2 text-[11px] text-muted-foreground">Only the categories and sub-categories of the CK Desk service chosen in step 2 are offered. A CK Desk service with no categories needs nothing here.</p>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Zoho sub category and item to CK Desk category and sub category">
          <table className="w-full text-left text-xs">
            <thead><tr className="border-b border-border text-muted-foreground"><th className="py-1 pr-3 font-medium">Zoho (category › sub category › item)</th><th className="py-1 pr-3 font-medium">Tickets</th><th className="py-1 font-medium">CK Desk</th></tr></thead>
            <tbody>
              {zohoCats.flatMap(([c, subs]) => [...subs.entries()].flatMap(([sub, its]) => {
                const s = serviceFor(c)
                const ckCats = ckCategoriesOf(s)
                const ck = `${c}${SEP}${sub}`
                const subsOf = (s?.subCategories ?? []).filter((x) => x.categoryId === cats[ck])
                return [
                  <tr key={ck} className="border-b border-border/60 bg-muted/30">
                    <td className="py-1 pr-3 font-medium text-foreground">{label(c)} › {label(sub)}</td>
                    <td className="py-1 pr-3 tabular-nums text-muted-foreground">{countOf(c, sub).toLocaleString('en-IN')}</td>
                    <td className="py-1">
                      {ckCats.length === 0
                        ? <span className="text-muted-foreground">{s ? 'This CK Desk service has no categories.' : 'Choose the service in step 2 first.'}</span>
                        : <select aria-label={`CK Desk category for Zoho sub category ${sub || 'blank'} of ${c || 'default'}`} className={sel + hint(`cat${SEP}${ck}`)} value={cats[ck] ?? ''} disabled={!canEdit}
                            onChange={(e) => { setCats((p) => ({ ...p, [ck]: e.target.value })); markHand(`cat${SEP}${ck}`) }}>
                            <option value="">— not mapped —</option>
                            {ckCats.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                          </select>}
                    </td>
                  </tr>,
                  ...its.map((it) => {
                    const ik = `${ck}${SEP}${it.item}`
                    return (
                      <tr key={ik} className="border-b border-border/40">
                        <td className="py-1 pl-6 pr-3 text-foreground">{label(it.item)}</td>
                        <td className="py-1 pr-3 tabular-nums text-muted-foreground">{it.tickets.toLocaleString('en-IN')}</td>
                        <td className="py-1">
                          {subsOf.length === 0
                            ? <span className="text-muted-foreground">{cats[ck] ? 'No sub-categories.' : '—'}</span>
                            : <select aria-label={`CK Desk sub category for Zoho item ${it.item || 'blank'}`} className={sel + hint(`item${SEP}${ik}`)} value={items[ik] ?? ''} disabled={!canEdit}
                                onChange={(e) => { setItems((p) => ({ ...p, [ik]: e.target.value })); markHand(`item${SEP}${ik}`) }}>
                                <option value="">{subsOf.length === 1 ? `${subsOf[0].name} (the only one)` : '— not mapped —'}</option>
                                {subsOf.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                              </select>}
                        </td>
                      </tr>
                    )
                  }),
                ]
              }))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 5. fields */}
      <section className="rounded-lg border border-border bg-card p-3">
        <h3 className="text-sm font-semibold text-foreground">5. Zoho fields → CK Desk form fields</h3>
        <p className="mb-2 text-[11px] text-muted-foreground">Only Zoho fields that hold a value on tickets of this template are listed. The subject and the message are carried over by themselves. A Zoho field left unmapped is kept in the ticket history and is not lost.</p>
        {fieldUse.length === 0 ? <p className="text-xs text-muted-foreground">No extra Zoho fields are used by this template.</p> : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Zoho fields to CK Desk form fields">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-border text-muted-foreground"><th className="py-1 pr-3 font-medium">Zoho field</th><th className="py-1 pr-3 font-medium">Tickets with a value</th><th className="py-1 font-medium">CK Desk form field</th></tr></thead>
              <tbody>
                {fieldUse.map((f) => (
                  <tr key={f.field} className="border-b border-border/60">
                    <td className="py-1 pr-3 text-foreground">{f.label}</td>
                    <td className="py-1 pr-3 tabular-nums text-muted-foreground">{f.tickets.toLocaleString('en-IN')}</td>
                    <td className="py-1">
                      <select aria-label={`CK Desk form field for the Zoho field ${f.label}`} className={sel + hint(`fld${SEP}${f.field}`)} value={fields[f.field] ?? ''} disabled={!canEdit || !tpl}
                        onChange={(e) => { setFields((p) => ({ ...p, [f.field]: e.target.value })); markHand(`fld${SEP}${f.field}`) }}>
                        <option value="">{tpl ? '— not mapped —' : 'Choose the form template in step 1 first'}</option>
                        {tplFields.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
