'use client'

import { useState, useTransition, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { Check, ChevronDown } from 'lucide-react'
import { setCustomFieldValue } from '@/lib/actions/tasks'
import type { CustomField, CustomFieldValue } from '@/types'

interface Props {
  taskId: string
  field: CustomField
  value: CustomFieldValue['value']
  onUpdate: (fieldId: string, value: CustomFieldValue['value']) => void
}

// ── Portaled dropdown picker ──────────────────────────────────────────────────

function DropdownPicker({
  options,
  selected,
  multi,
  anchorRect,
  onSelect,
  onClose,
}: {
  options: { value: string; color?: string }[]
  selected: string | string[]
  multi: boolean
  anchorRect: DOMRect
  onSelect: (val: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const top = anchorRect.bottom + window.scrollY + 4
  const left = anchorRect.left + window.scrollX

  return createPortal(
    <div
      ref={ref}
      style={{ position: 'absolute', top, left, minWidth: Math.max(anchorRect.width, 160), zIndex: 9999 }}
      className="rounded-xl border border-border bg-card shadow-xl py-1 overflow-hidden"
    >
      {options.map(opt => {
        const isSelected = multi
          ? (Array.isArray(selected) && selected.includes(opt.value))
          : selected === opt.value
        return (
          <button
            key={opt.value}
            onMouseDown={(e) => { e.preventDefault(); onSelect(opt.value) }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left transition-colors hover:bg-muted/60 ${isSelected ? 'bg-muted/40' : ''}`}
          >
            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: opt.color ?? '#6366f1' }} />
            <span className={`flex-1 ${isSelected ? 'font-semibold text-foreground' : 'text-foreground/80'}`}>{opt.value}</span>
            {isSelected && <Check className="h-3 w-3 text-primary shrink-0" />}
          </button>
        )
      })}
    </div>,
    document.body
  )
}

// ── Main cell component ───────────────────────────────────────────────────────

export function CustomFieldCell({ taskId, field, value, onUpdate }: Props) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [localVal, setLocalVal] = useState(value)
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
  const [, startTransition] = useTransition()
  const cellRef = useRef<HTMLTableCellElement>(null)

  // Re-sync local edit state when the underlying field value prop changes.
  // Adjusting state during render (React's documented pattern) instead of an effect.
  const [prevValue, setPrevValue] = useState(value)
  if (prevValue !== value) {
    setPrevValue(value)
    setLocalVal(value)
  }

  function save(newVal: CustomFieldValue['value']) {
    const prev = localVal
    setLocalVal(newVal)
    onUpdate(field.id, newVal)
    startTransition(async () => {
      const result = await setCustomFieldValue(taskId, field.id, newVal)
      if (result?.error) {
        toast.error(result.error)
        setLocalVal(prev)
        onUpdate(field.id, prev)
      }
    })
  }

  const openPicker = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (cellRef.current) setAnchorRect(cellRef.current.getBoundingClientRect())
    setOpen(true)
  }, [])

  // ── Checkbox ──────────────────────────────────────────────────────────────
  if (field.field_type === 'checkbox') {
    const checked = Boolean(localVal)
    return (
      <td
        ref={cellRef}
        className="px-3 py-2.5 text-center group/cell hover:bg-muted/30 transition-colors"
        onClick={(e) => { e.stopPropagation(); save(!checked) }}
      >
        <button
          className={`inline-flex h-4 w-4 items-center justify-center rounded border transition-colors ${
            checked ? 'bg-primary border-primary' : 'border-border group-hover/cell:border-primary/40'
          }`}
        >
          {checked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
        </button>
      </td>
    )
  }

  // ── Dropdown / multi-select ───────────────────────────────────────────────
  if (field.field_type === 'dropdown' || field.field_type === 'multi_select') {
    const options = field.options ?? []
    const isMulti = field.field_type === 'multi_select'
    const selected = isMulti
      ? (Array.isArray(localVal) ? (localVal as string[]) : [])
      : (typeof localVal === 'string' ? localVal : '')

    const selectedOptions = isMulti
      ? options.filter(o => (selected as string[]).includes(o.value))
      : options.filter(o => o.value === selected)

    function handleSelect(optVal: string) {
      if (isMulti) {
        const cur = Array.isArray(selected) ? selected as string[] : []
        const next = cur.includes(optVal) ? cur.filter(v => v !== optVal) : [...cur, optVal]
        save(next.length ? next : null)
      } else {
        save(selected === optVal ? null : optVal)
        setOpen(false)
      }
    }

    return (
      <>
        <td
          ref={cellRef}
          className="px-2 py-1.5 cursor-pointer group/cell hover:bg-muted/30 transition-colors"
          onClick={openPicker}
        >
          {selectedOptions.length > 0 ? (
            <div className="flex flex-wrap gap-1 items-center">
              {selectedOptions.map(opt => (
                <span
                  key={opt.value}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold text-white leading-tight"
                  style={{ background: opt.color ?? '#6366f1' }}
                >
                  {opt.value}
                  {!isMulti && <ChevronDown className="h-2.5 w-2.5 opacity-70 shrink-0" />}
                </span>
              ))}
              {isMulti && <ChevronDown className="h-3 w-3 text-muted-foreground/50 shrink-0 ml-0.5" />}
            </div>
          ) : (
            <div className="inline-flex items-center gap-1 rounded-md border border-dashed border-border/60 bg-muted/20 px-2 py-0.5 text-[11px] text-muted-foreground/50 group-hover/cell:border-primary/30 group-hover/cell:text-muted-foreground transition-colors">
              Select
              <ChevronDown className="h-2.5 w-2.5" />
            </div>
          )}
        </td>
        {open && anchorRect && (
          <DropdownPicker
            options={options}
            selected={selected}
            multi={isMulti}
            anchorRect={anchorRect}
            onSelect={handleSelect}
            onClose={() => setOpen(false)}
          />
        )}
      </>
    )
  }

  // ── Date ──────────────────────────────────────────────────────────────────
  if (field.field_type === 'date') {
    const dateVal = typeof localVal === 'string' ? localVal : ''
    if (!editing) {
      const label = dateVal
        ? new Date(dateVal + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : null
      return (
        <td
          ref={cellRef}
          className="px-3 py-2.5 cursor-pointer group/cell hover:bg-muted/30 transition-colors"
          onClick={(e) => { e.stopPropagation(); setEditing(true) }}
        >
          <span className={`text-xs ${label ? 'text-foreground' : 'text-muted-foreground/40 group-hover/cell:text-muted-foreground/70'}`}>
            {label ?? '—'}
          </span>
        </td>
      )
    }
    return (
      <td ref={cellRef} className="px-2 py-1.5">
        <input
          type="date"
          value={dateVal.slice(0, 10)}
          onChange={(e) => { save(e.target.value || null); setEditing(false) }}
          onBlur={() => setEditing(false)}
          onClick={(e) => e.stopPropagation()}
          autoFocus
          className="rounded-lg border border-ring bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </td>
    )
  }

  // ── Number ────────────────────────────────────────────────────────────────
  if (field.field_type === 'number') {
    if (!editing) {
      const hasVal = localVal !== null && localVal !== undefined
      return (
        <td
          ref={cellRef}
          className="px-3 py-2.5 cursor-pointer group/cell hover:bg-muted/30 transition-colors"
          onClick={(e) => { e.stopPropagation(); setEditing(true) }}
        >
          <span className={`text-xs ${hasVal ? 'text-foreground tabular-nums' : 'text-muted-foreground/40 group-hover/cell:text-muted-foreground/70'}`}>
            {hasVal ? String(localVal) : '—'}
          </span>
        </td>
      )
    }
    return (
      <td ref={cellRef} className="px-2 py-1.5">
        <input
          type="number"
          defaultValue={typeof localVal === 'number' ? localVal : ''}
          onBlur={(e) => { save(e.target.value === '' ? null : Number(e.target.value)); setEditing(false) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') setEditing(false)
          }}
          onClick={(e) => e.stopPropagation()}
          autoFocus
          className="w-full rounded-lg border border-ring bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </td>
    )
  }

  // ── Text ──────────────────────────────────────────────────────────────────
  if (!editing) {
    return (
      <td
        ref={cellRef}
        className="px-3 py-2.5 cursor-pointer max-w-[160px] group/cell hover:bg-muted/30 transition-colors"
        onClick={(e) => { e.stopPropagation(); setEditing(true) }}
      >
        <span className={`truncate block text-xs ${localVal ? 'text-foreground' : 'text-muted-foreground/40 group-hover/cell:text-muted-foreground/70'}`}>
          {localVal ? String(localVal) : '—'}
        </span>
      </td>
    )
  }
  return (
    <td ref={cellRef} className="px-2 py-1.5 min-w-[140px]">
      <input
        defaultValue={typeof localVal === 'string' ? localVal : ''}
        onBlur={(e) => { save(e.target.value || null); setEditing(false) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') setEditing(false)
        }}
        onClick={(e) => e.stopPropagation()}
        autoFocus
        className="w-full rounded-lg border border-ring bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </td>
  )
}
