'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { tagServiceTemplate, convertServiceFormToTemplate } from '@/lib/actions/admin/form-templates'

interface ServiceTemplateTagProps {
  serviceId: string
  currentTemplate: { id: string; name: string } | null
  templates: { id: string; name: string }[]
  /** Whether the service's own form_sections/form_fields has anything worth
   *  converting — only relevant while untagged. */
  hasOwnForm: boolean
}

// Lets an admin tag a service to a Form Template (the live source of truth for
// its intake form once tagged — see resolveServiceFormSections()), change
// which template it's tagged to, or — for a legacy untagged service that
// still has its own inline form — lift that form into a brand-new template
// via convertServiceFormToTemplate() so nothing has to be rebuilt by hand.

export function ServiceTemplateTag({ serviceId, currentTemplate, templates, hasOwnForm }: ServiceTemplateTagProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [changing, setChanging] = useState(false)
  const [pickedId, setPickedId] = useState(currentTemplate?.id ?? '')
  const [converting, setConverting] = useState(false)
  const [newName, setNewName] = useState('')

  function handleChangeTemplate() {
    setError(null)
    startTransition(async () => {
      const result = await tagServiceTemplate(serviceId, pickedId || null)
      if (result.error) { setError(result.error); return }
      setChanging(false)
      router.refresh()
    })
  }

  function handleConvert() {
    if (!newName.trim()) { setError('Enter a template name.'); return }
    setError(null)
    startTransition(async () => {
      const result = await convertServiceFormToTemplate(serviceId, newName.trim())
      if (result.error) { setError(result.error); return }
      router.refresh()
    })
  }

  const selectCls = 'rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40'
  const btnCls = 'btn-gradient px-3 py-1.5 text-xs disabled:opacity-50'

  if (currentTemplate && !changing) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-3 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Form Template</p>
        <div className="flex items-center justify-between gap-3">
          <Link href={`/admin/form-templates/${currentTemplate.id}`} className="text-sm font-medium text-primary hover:underline">
            {currentTemplate.name} →
          </Link>
          <button type="button" onClick={() => setChanging(true)} className="text-xs text-muted-foreground hover:text-foreground">
            Change template
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          This service&rsquo;s intake form always reflects whatever this template currently says — edit the fields from the template&rsquo;s own page.
        </p>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Form Template</p>

      <div className="flex items-center gap-2">
        <select value={pickedId} onChange={(e) => setPickedId(e.target.value)} className={`flex-1 ${selectCls}`}>
          <option value="">No template — untagged</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleChangeTemplate}
          disabled={isPending || pickedId === (currentTemplate?.id ?? '')}
          className={btnCls}
        >
          {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Tag'}
        </button>
        {changing && (
          <button type="button" onClick={() => { setChanging(false); setPickedId(currentTemplate?.id ?? '') }} className="text-xs text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        )}
      </div>

      {hasOwnForm && !currentTemplate && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-[11px] text-muted-foreground">Or turn this service&rsquo;s current form into a reusable template:</p>
          {converting ? (
            <div className="flex items-center gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Template name"
                className={`flex-1 ${selectCls}`}
              />
              <button type="button" onClick={handleConvert} disabled={isPending} className={btnCls}>
                {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Convert'}
              </button>
              <button type="button" onClick={() => setConverting(false)} className="text-xs text-muted-foreground hover:text-foreground">
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConverting(true)} className="text-xs font-medium text-primary hover:underline">
              Convert to template
            </button>
          )}
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
