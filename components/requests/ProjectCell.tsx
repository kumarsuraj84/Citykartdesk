'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { ChevronDown, FolderKanban, Loader2 } from 'lucide-react'
import { attachToProject } from '@/lib/actions/projects'

// Editable "Project" cell for the request details tab — shows the currently
// linked project (if any) and opens a dropdown to attach/change/clear it.
export function ProjectCell({
  requestId,
  value,
  allProjects,
}: {
  requestId: string
  value: { id: string; name: string } | null
  allProjects: { id: string; name: string }[]
}) {
  const [current, setCurrent] = useState(value)
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function pick(project: { id: string; name: string } | null) {
    setOpen(false)
    if (project?.id === current?.id) return
    const prev = current
    setCurrent(project)
    startTransition(async () => {
      const r = await attachToProject('request', requestId, project?.id ?? null)
      if (r?.error) setCurrent(prev)
    })
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
      >
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderKanban className="h-3 w-3" />}
        {current?.name ?? 'No project'}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[180px] rounded-xl border border-border bg-card shadow-lg py-1">
          <button
            onClick={() => pick(null)}
            className="w-full text-left px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/50"
          >
            No project
          </button>
          {allProjects.map((p) => (
            <button
              key={p.id}
              onClick={() => pick(p)}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 ${p.id === current?.id ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
