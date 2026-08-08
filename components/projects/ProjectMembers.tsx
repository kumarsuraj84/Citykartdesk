'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus, X } from 'lucide-react'
import { addProjectMember, removeProjectMember } from '@/lib/actions/projects'
import type { ProjectMemberWithProfile } from '@/types'

function AvatarInitial({ name }: { name: string }) {
  const initials = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
      {initials}
    </span>
  )
}

export function ProjectMembers({
  projectId,
  members,
  allProfiles,
}: {
  projectId: string
  members: ProjectMemberWithProfile[]
  allProfiles: { id: string; full_name: string }[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const memberIds = new Set(members.map((m) => m.user_id))
  const available = allProfiles.filter((p) => !memberIds.has(p.id))

  function add(userId: string) {
    setOpen(false)
    startTransition(async () => {
      await addProjectMember(projectId, userId)
      router.refresh()
    })
  }

  function remove(userId: string) {
    startTransition(async () => {
      await removeProjectMember(projectId, userId)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {members.map((m) => (
        <span
          key={m.user_id}
          className="group inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 py-0.5 pl-0.5 pr-2 text-xs text-foreground"
        >
          <AvatarInitial name={m.user.full_name} />
          {m.user.full_name}
          <button
            onClick={() => remove(m.user_id)}
            disabled={isPending}
            className="text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
            title="Remove from project"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}

      {available.length > 0 && (
        <div className="relative" ref={ref}>
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
          >
            <UserPlus className="h-3 w-3" />
            Add member
          </button>
          {open && (
            <div className="absolute left-0 top-full z-50 mt-1 max-h-56 w-48 overflow-y-auto rounded-xl border border-border bg-card shadow-lg py-1">
              {available.map((p) => (
                <button
                  key={p.id}
                  onClick={() => add(p.id)}
                  className="w-full text-left px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                >
                  {p.full_name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
