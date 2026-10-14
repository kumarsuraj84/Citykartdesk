'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown, UserRound } from 'lucide-react'

export type PersonOption = { id: string; name: string }

/**
 * Lets a person who has people reporting to them narrow their team Dashboard to some of those people: by technician (tickets assigned to them) or by
 * requester (tickets they raised). Nothing picked (or everybody picked) means "everybody". The choice lives in the page address (?tech=… or ?requester=…),
 * so it survives a refresh and the period links keep it.
 */
export function PeopleFilter({ param, noun, people, selected }: { param: 'tech' | 'requester'; noun: string; people: PersonOption[]; selected: string[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Set<string>>(new Set(selected))
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (people.length < 2) return null

  const label = selected.length === 0 ? `All ${noun} (${people.length})` : `${selected.length} of ${people.length} ${noun}`

  function toggle(id: string) {
    setDraft((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function apply(ids: string[]) {
    const params = new URLSearchParams(searchParams.toString())
    if (ids.length === 0 || ids.length === people.length) params.delete(param)
    else params.set(param, ids.join(','))
    const qs = params.toString()
    setOpen(false)
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => { setDraft(new Set(selected)); setOpen((v) => !v) }}
        aria-haspopup="listbox" aria-expanded={open}
        className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors ${
          selected.length ? 'border-primary/40 bg-primary/5 text-foreground' : 'border-border bg-muted/40 text-foreground hover:bg-muted'
        }`}
      >
        <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
        {label}
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1.5 w-72 rounded-xl border border-border bg-card p-2 shadow-lg" role="listbox" aria-label={`${noun} choices`}>
          <div className="flex items-center justify-between px-2 pb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{noun}</span>
            <button type="button" onClick={() => setDraft(new Set())} className="text-[11px] font-medium text-primary hover:underline">Everybody</button>
          </div>
          <ul className="max-h-64 overflow-auto">
            {people.map((p) => (
              <li key={p.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                  <input type="checkbox" checked={draft.has(p.id)} onChange={() => toggle(p.id)} className="rounded" />
                  <span className="truncate">{p.name}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center justify-between border-t border-border px-2 pt-2">
            <span className="text-[11px] text-muted-foreground">{draft.size === 0 ? 'Everybody' : `${draft.size} selected`}</span>
            <button type="button" onClick={() => apply(people.filter((p) => draft.has(p.id)).map((p) => p.id))} className="btn-gradient px-3 py-1 text-xs">Apply</button>
          </div>
        </div>
      )}
    </div>
  )
}
