'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { Inbox, PenLine, Mail, Phone, Globe, ChevronDown, Check, Loader2, type LucideIcon } from 'lucide-react'
import { updateTaskSource } from '@/lib/actions/tasks'
import { updateRequestSource } from '@/lib/actions/requests'
import { WORK_SOURCES, sourceLabel } from '@/lib/sources'

const ICONS: Record<string, LucideIcon> = {
  intake: Inbox,
  manual: PenLine,
  email: Mail,
  phone: Phone,
  portal: Globe,
}

// Editable "Source" cell — shows the current source as a chip and opens a
// dropdown to change it. Works for both tasks and requests; the matching server
// action is chosen from `entity`. Renders inside table rows / <Link> wrappers,
// so it stops click propagation and uses a fixed-position portal to avoid clip.
export function SourceCell({ entity, id, value }: {
  entity: 'task' | 'request'
  id: string
  value: string | null
}) {
  const [current, setCurrent] = useState<string | null>(value)
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [pos, setPos] = useState({ top: 0, left: 0, openUp: false })
  const triggerRef = useRef<HTMLSpanElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Re-sync local state when the underlying value prop changes.
  // Adjusting state during render (React's documented pattern) instead of an effect.
  const [prevValue, setPrevValue] = useState(value)
  if (prevValue !== value) {
    setPrevValue(value)
    setCurrent(value)
  }

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (triggerRef.current?.contains(e.target as Node) || dropdownRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function toggle(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      const openUp = rect.bottom > window.innerHeight * 0.65
      setPos({
        top: openUp ? rect.top + window.scrollY : rect.bottom + window.scrollY,
        left: rect.left,
        openUp,
      })
    }
    setOpen((v) => !v)
  }

  function pick(next: string | null, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setOpen(false)
    if (next === current) return
    const prev = current
    setCurrent(next)
    startTransition(async () => {
      const action = entity === 'task' ? updateTaskSource : updateRequestSource
      const r = await action(id, next)
      if (r?.error) setCurrent(prev) // rollback on failure
    })
  }

  const Icon = current ? ICONS[current] : null
  const label = sourceLabel(current)

  return (
    <>
      <span
        ref={triggerRef}
        role="button"
        tabIndex={0}
        onClick={toggle}
        title={label ? `Source: ${label} — click to change` : 'Set source'}
        className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold transition-colors hover:opacity-80 cursor-pointer ${
          current
            ? 'border-primary/20 bg-primary/10 text-primary'
            : 'border-transparent text-muted-foreground/40 hover:text-muted-foreground'
        }`}
      >
        {pending ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
          : Icon ? <Icon className="h-2.5 w-2.5" /> : null}
        <span>{label ?? '—'}</span>
        <ChevronDown className="h-2.5 w-2.5 opacity-60" />
      </span>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: pos.openUp ? undefined : pos.top - window.scrollY,
            bottom: pos.openUp ? window.innerHeight - (pos.top - window.scrollY) : undefined,
            left: pos.left,
            zIndex: 9999,
          }}
          className="min-w-[150px] rounded-xl border border-border bg-card p-1 shadow-2xl"
        >
          {WORK_SOURCES.map((s) => {
            const SIcon = ICONS[s.key]
            return (
              <button
                key={s.key}
                onClick={(e) => pick(s.key, e)}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors hover:bg-muted"
              >
                <SIcon className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-medium text-foreground">{s.label}</span>
                {current === s.key && <Check className="ml-auto h-3 w-3 text-primary" />}
              </button>
            )
          })}
          <div className="my-1 border-t border-border" />
          <button
            onClick={(e) => pick(null, e)}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted"
          >
            <span className="h-3.5 w-3.5 text-center">—</span>
            <span>None</span>
            {current === null && <Check className="ml-auto h-3 w-3 text-primary" />}
          </button>
        </div>,
        document.body,
      )}
    </>
  )
}
