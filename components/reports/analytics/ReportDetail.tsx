'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'
import { shortDate, type ReportTicket } from '@/lib/reporting/analytics/report-table'

type By = 'sub' | 'cat' | 'tech' | 'store' | 'cluster'
const BY_LABEL: Record<By, string> = { sub: 'Sub category', cat: 'Category', tech: 'Technician', store: 'Store', cluster: 'Cluster' }
const SHOWN = 200

/**
 * The pop-up behind any number of a fixed report: what the number is made of (by sub category, category, technician, store or cluster: the choice opens on
 * the first one that actually splits the tickets) and the tickets themselves, oldest first. Clicking a line of the breakdown narrows the tickets to it.
 */
export function ReportDetail({ tickets, title, subtitle, onClose }: { tickets: ReportTicket[]; title: string; subtitle: string; onClose: () => void }) {
  const kinds = useMemo(() => (Object.keys(BY_LABEL) as By[]).filter((k) => new Set(tickets.map((t) => t[k])).size > 1), [tickets])
  const [by, setBy] = useState<By | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const active: By | null = by && kinds.includes(by) ? by : kinds[0] ?? null
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const parts = useMemo(() => {
    if (!active) return []
    const m = new Map<string, number>()
    for (const t of tickets) m.set(t[active], (m.get(t[active]) ?? 0) + 1)
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { numeric: true }))
  }, [tickets, active])
  const list = useMemo(() => {
    const rows = focus === null || !active ? tickets : tickets.filter((t) => t[active] === focus)
    return [...rows].sort((a, b) => b.age - a.age || a.no.localeCompare(b.no))
  }, [tickets, active, focus])
  const max = Math.max(1, ...parts.map((p) => p[1]))

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label={`${title} - ${subtitle}`} className="w-full max-w-4xl rounded-xl border border-border bg-card shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold text-foreground">{subtitle}</h2>
            <p className="text-xs text-muted-foreground">{title} · <span className="font-semibold text-foreground">{tickets.length}</span> ticket{tickets.length === 1 ? '' : 's'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-3 p-4">
          {active && parts.length > 1 && (
            <div>
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">By</span>
                <div className="flex gap-0.5 rounded-lg border border-border bg-muted/50 p-0.5" role="group" aria-label="Break down by">
                  {kinds.map((k) => (
                    <button key={k} type="button" onClick={() => { setBy(k); setFocus(null) }} aria-pressed={active === k}
                      className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${active === k ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{BY_LABEL[k]}</button>
                  ))}
                </div>
                <span className="text-[11px] text-muted-foreground">click a line to narrow the tickets</span>
              </div>
              <ul className="grid max-h-40 gap-x-4 gap-y-0.5 overflow-auto sm:grid-cols-2">
                {parts.map(([name, n]) => (
                  <li key={name}>
                    <button type="button" onClick={() => setFocus(focus === name ? null : name)} aria-pressed={focus === name}
                      className={`flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left text-xs hover:bg-muted ${focus === name ? 'bg-primary/10 font-semibold' : ''}`}>
                      <span className="min-w-0 flex-1 truncate">{name}</span>
                      <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:block"><span className="block h-full rounded-full bg-primary/60" style={{ width: `${(n / max) * 100}%` }} /></span>
                      <span className="w-6 text-right tabular-nums">{n}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="max-h-[50vh] overflow-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-muted text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5">Ticket</th><th className="px-2 py-1.5">Subject</th><th className="px-2 py-1.5">Category</th>
                  <th className="px-2 py-1.5">Store</th><th className="px-2 py-1.5">Technician</th><th className="px-2 py-1.5">Status</th>
                  <th className="px-2 py-1.5">Created</th><th className="px-2 py-1.5 text-right">Age</th>
                </tr>
              </thead>
              <tbody>
                {list.slice(0, SHOWN).map((t) => (
                  <tr key={t.id} className="border-t border-border/60 hover:bg-muted/40">
                    <td className="whitespace-nowrap px-2 py-1 font-medium"><Link href={`/requests/${t.id}`} className="text-primary hover:underline">{t.no}</Link></td>
                    <td className="max-w-[14rem] truncate px-2 py-1" title={t.subject}>{t.subject}</td>
                    <td className="max-w-[11rem] truncate px-2 py-1 text-muted-foreground" title={`${t.cat} / ${t.sub}`}>{t.cat} / {t.sub}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-muted-foreground">{t.store} · {t.cluster}</td>
                    <td className="max-w-[8rem] truncate px-2 py-1 text-muted-foreground" title={t.tech}>{t.tech}</td>
                    <td className="whitespace-nowrap px-2 py-1">{t.status}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-muted-foreground">{shortDate(t.created)}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{t.age}d</td>
                  </tr>
                ))}
                {list.length === 0 && <tr><td colSpan={8} className="px-2 py-4 text-center text-muted-foreground">No tickets.</td></tr>}
              </tbody>
            </table>
          </div>
          {list.length > SHOWN && <p className="text-[11px] text-muted-foreground">Showing the oldest {SHOWN} of {list.length}. Narrow it with the breakdown above.</p>}
        </div>
      </div>
    </div>
  )
}
