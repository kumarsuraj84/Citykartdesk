'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown, Users2 } from 'lucide-react'

export type GroupOption = { id: string; name: string }

/**
 * Lets a person with more than one technician group choose which of them the dashboard shows.
 * Nothing picked (or every group picked) means "all my groups". The choice lives in the page
 * address (?groups=…) so it survives a refresh and the period / tab links keep it.
 */
export function GroupFilter({ groups, selected }: { groups: GroupOption[]; selected: string[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Set<string>>(new Set(selected.length ? selected : groups.map((g) => g.id)))
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (groups.length < 2) return null

  const allPicked = draft.size === groups.length
  const label = selected.length === 0 ? `All groups (${groups.length})` : `${selected.length} of ${groups.length} groups`

  function toggle(id: string) {
    setDraft((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function apply() {
    const params = new URLSearchParams(searchParams.toString())
    if (draft.size === 0 || allPicked) params.delete('groups')
    else params.set('groups', groups.filter((g) => draft.has(g.id)).map((g) => g.id).join(','))
    const qs = params.toString()
    setOpen(false)
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => {
          setDraft(new Set(selected.length ? selected : groups.map((g) => g.id)))
          setOpen((v) => !v)
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors ${
          selected.length ? 'border-primary/40 bg-primary/5 text-foreground' : 'border-border bg-muted/40 text-foreground hover:bg-muted'
        }`}
      >
        <Users2 className="h-3.5 w-3.5 text-muted-foreground" />
        {label}
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1.5 w-72 rounded-xl border border-border bg-card p-2 shadow-lg">
          <div className="flex items-center justify-between px-2 pb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Technician groups</span>
            <button
              type="button"
              onClick={() => setDraft(new Set(allPicked ? [] : groups.map((g) => g.id)))}
              className="text-[11px] font-medium text-primary hover:underline"
            >
              {allPicked ? 'Clear all' : 'Select all'}
            </button>
          </div>
          <ul className="max-h-64 overflow-auto">
            {groups.map((g) => (
              <li key={g.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                  <input type="checkbox" checked={draft.has(g.id)} onChange={() => toggle(g.id)} className="rounded" />
                  <span className="truncate">{g.name}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center justify-between border-t border-border px-2 pt-2">
            <span className="text-[11px] text-muted-foreground">
              {draft.size === 0 ? 'Pick at least one group' : `${draft.size} selected`}
            </span>
            <button
              type="button"
              onClick={apply}
              disabled={draft.size === 0}
              className="btn-gradient px-3 py-1 text-xs disabled:opacity-40"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
