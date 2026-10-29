'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cn, formatDateTime } from '@/lib/utils'
import { createProgram } from '@/lib/actions/admin/programs'
import type { ProgramListItem } from '@/lib/programs/admin-data'
import type { BuiltInListItem } from '@/lib/programs/builtin'

function StatusPill({ p }: { p: ProgramListItem }) {
  const text = p.is_active ? 'On' : 'Off'
  return <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', p.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-muted text-muted-foreground')}>{text}</span>
}

export function ProgramsClient({ programs, builtIn = [] }: { programs: ProgramListItem[]; builtIn?: BuiltInListItem[] }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [rowType, setRowType] = useState<'store' | 'machine'>('store')
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-1 text-sm font-semibold text-foreground">New program</h2>
        <p className="mb-3 text-xs text-muted-foreground">A new program starts switched off. You set it up on the next screen and switch it on when the check list is green.</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[14rem] flex-1 text-xs font-medium text-foreground">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="For example: RO Water Purifier" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm" />
          </label>
          <label className="text-xs font-medium text-foreground">
            What does one row of its sheet mean?
            <select value={rowType} onChange={(e) => setRowType(e.target.value as 'store' | 'machine')} className="mt-1 block rounded-lg border border-border bg-background px-3 py-1.5 text-sm">
              <option value="store">One row per store</option>
              <option value="machine">One row per machine</option>
            </select>
          </label>
          <button
            type="button"
            disabled={pending || name.trim().length < 2}
            onClick={() => start(async () => {
              setMsg(null)
              const r = await createProgram(name, rowType)
              if (r.error || !r.id) { setMsg(r.error ?? 'Could not create the program.'); return }
              router.push(`/admin/programs/${r.id}`)
            })}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Create
          </button>
        </div>
        {msg && <p role="alert" className="mt-2 text-xs text-red-600">{msg}</p>}
      </section>

      <section className="rounded-xl border border-border bg-card">
        <h2 className="border-b border-border px-4 py-2.5 text-sm font-semibold text-foreground">Programs</h2>
        <ul className="divide-y divide-border">
          {builtIn.map((b) => (
            <li key={b.kind}>
              <Link href={`/admin/programs/built-in/${b.kind}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-muted/40">
                <span className="min-w-[10rem] flex-1 text-sm font-medium text-foreground">{b.name} <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-normal text-muted-foreground">built in</span></span>
                <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', b.categories > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-muted text-muted-foreground')}>{b.categories > 0 ? 'On' : 'Off'}</span>
                <span className="text-xs text-muted-foreground">{b.categories} categor{b.categories === 1 ? 'y' : 'ies'}</span>
                <span className="text-xs text-muted-foreground">{b.rows} {b.rowType === 'machine' ? 'machine' : 'genset'}{b.rows === 1 ? '' : 's'} in the sheet</span>
                <span className={cn('text-xs', b.last_status === 'error' ? 'text-red-600' : 'text-muted-foreground')}>
                  {b.last_status === 'error' ? 'Sheet problem' : b.last_checked_at ? `Checked ${formatDateTime(b.last_checked_at)}` : 'Sheet not read yet'}
                </span>
                {b.problems > 0 && <span className="text-xs text-amber-700">{b.problems} to look at</span>}
              </Link>
            </li>
          ))}
        </ul>
        {programs.length === 0 ? (
          <p className="border-t border-border px-4 py-6 text-center text-sm text-muted-foreground">No other program yet. Create one above (for example RO Water Purifier).</p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {programs.map((p) => (
              <li key={p.id}>
                <Link href={`/admin/programs/${p.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-muted/40">
                  <span className="min-w-[10rem] flex-1 text-sm font-medium text-foreground">{p.name}</span>
                  <StatusPill p={p} />
                  <span className="text-xs text-muted-foreground">{p.categories} categor{p.categories === 1 ? 'y' : 'ies'}</span>
                  <span className="text-xs text-muted-foreground">{p.rows} row{p.rows === 1 ? '' : 's'} in the sheet</span>
                  <span className={cn('text-xs', p.last_status === 'error' ? 'text-red-600' : 'text-muted-foreground')}>
                    {p.last_status === 'error' ? 'Sheet problem' : p.last_checked_at ? `Checked ${formatDateTime(p.last_checked_at)}` : 'Sheet not read yet'}
                  </span>
                  {p.problems > 0 && <span className="text-xs text-amber-700">{p.problems} to look at</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
