'use client'

import { useMemo, useState, useTransition } from 'react'
import { CheckCircle2, Sparkles } from 'lucide-react'
import { savePersonMapping, saveStatusMapping } from '@/lib/actions/zohoTransfer'
import { CK_STATUSES, suggestStatus } from '@/lib/zoho/transfer/suggest'

const sel = 'w-full min-w-[10rem] rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground disabled:opacity-60'

export function StatusMapper({ rows, saved, canEdit }: { rows: { status: string; tickets: number }[]; saved: Record<string, string>; canEdit: boolean }) {
  const [map, setMap] = useState<Record<string, string>>(saved)
  const [hinted, setHinted] = useState<Set<string>>(new Set())
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()

  function suggest() {
    const next = { ...map }, h = new Set<string>()
    for (const r of rows) if (!next[r.status]) { const s = suggestStatus(r.status); if (s) { next[r.status] = s; h.add(r.status) } }
    setMap(next); setHinted(h)
    setMsg({ ok: true, text: h.size ? `${h.size} suggestions filled in (yellow). Check them, then Save.` : 'Nothing more to suggest.' })
  }
  function save() {
    setMsg(null)
    start(async () => {
      const res = await saveStatusMapping(rows.map((r) => ({ zohoValue: r.status, ckValue: map[r.status] || null })))
      if (res.error) setMsg({ ok: false, text: res.error }); else { setHinted(new Set()); setMsg({ ok: true, text: `Saved (${res.saved ?? 0} statuses).` }) }
    })
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Zoho Status → CK Desk Status</h2>
          <p className="text-xs text-muted-foreground">Every status Zoho has used, with how many tickets have it. A ticket whose status is not mapped cannot be moved.</p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button type="button" onClick={suggest} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"><Sparkles className="h-3.5 w-3.5" /> Suggest the blanks</button>
            <button type="button" onClick={save} disabled={pending} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60">{pending ? 'Saving…' : 'Save statuses'}</button>
          </div>
        )}
      </div>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs ${msg.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300' : 'border-red-200 bg-red-50 text-red-800'}`}>{msg.ok && <CheckCircle2 className="h-3.5 w-3.5" />}{msg.text}</p>}
      <div className="overflow-x-auto rounded-lg border border-border bg-card p-3" tabIndex={0} role="region" aria-label="Zoho status to CK Desk status">
        <table className="w-full text-left text-xs">
          <thead><tr className="border-b border-border text-muted-foreground"><th className="py-1 pr-3 font-medium">Zoho status</th><th className="py-1 pr-3 font-medium">Tickets</th><th className="py-1 font-medium">CK Desk status</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.status} className="border-b border-border/60">
                <td className="py-1 pr-3 text-foreground">{r.status || '(blank in Zoho)'}</td>
                <td className="py-1 pr-3 tabular-nums text-muted-foreground">{r.tickets.toLocaleString('en-IN')}</td>
                <td className="py-1">
                  <select aria-label={`CK Desk status for the Zoho status ${r.status || 'blank'}`} className={sel + (hinted.has(r.status) ? ' bg-yellow-100 dark:bg-yellow-950/40' : '')} value={map[r.status] ?? ''} disabled={!canEdit}
                    onChange={(e) => { setMap((p) => ({ ...p, [r.status]: e.target.value })); setHinted((p) => { const n = new Set(p); n.delete(r.status); return n }) }}>
                    <option value="">— not mapped —</option>
                    {CK_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export type PersonRow = { key: string; name: string | null; email: string | null; tickets: number; how: 'saved' | 'email' | 'name' | 'none'; ckName: string | null; savedProfileId: string | null }
export type PersonOption = { id: string; label: string }

export function PeopleMapper({ kind, rows, options, counts, canEdit }: { kind: 'requester' | 'technician'; rows: PersonRow[]; options: PersonOption[]; counts: { total: number; matched: number }; canEdit: boolean }) {
  const [q, setQ] = useState('')
  const [onlyOpen, setOnlyOpen] = useState(true)
  const [choice, setChoice] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<Record<string, { ok: boolean; text: string }>>({})
  const [pending, start] = useTransition()
  const byLabel = useMemo(() => new Map(options.map((o) => [o.label, o.id])), [options])
  const listId = `ck-people-${kind}`
  const shown = rows.filter((r) => (!onlyOpen || r.how === 'none') && (!q || `${r.name ?? ''} ${r.email ?? ''}`.toLowerCase().includes(q.toLowerCase())))

  function save(r: PersonRow, profileId: string | null) {
    start(async () => {
      const res = await savePersonMapping({ kind, zohoKey: r.key, zohoName: r.name, profileId })
      setMsg((p) => ({ ...p, [r.key]: res.error ? { ok: false, text: res.error } : { ok: true, text: profileId ? 'Saved.' : 'Match removed.' } }))
    })
  }
  const word = kind === 'requester' ? 'requesters' : 'technicians'
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-card p-3">
        <h2 className="text-sm font-semibold text-foreground">Zoho {kind === 'requester' ? 'Requester' : 'Technician'} → CK Desk {kind === 'requester' ? 'Requester' : 'Technician'}</h2>
        <p className="text-xs text-muted-foreground">
          People are matched by themselves first — by e-mail, then by exact full name. <strong>{counts.matched.toLocaleString('en-IN')}</strong> of <strong>{counts.total.toLocaleString('en-IN')}</strong> Zoho {word} are matched. Match the rest by hand below.
          {kind === 'requester'
            ? ' A requester who still has no CK Desk person is created as an inactive profile when the ticket is moved (they cannot sign in).'
            : ' Open tickets are given to a technician by CK Desk\'s own rules; this match is used to show who worked on the ticket and who resolved a closed one.'}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <input aria-label={`Search Zoho ${word}`} value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${word}…`} className="w-64 rounded-md border border-input bg-background px-2 py-1 text-xs" />
          <label className="flex items-center gap-1.5 text-xs text-foreground"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> Only the ones not matched yet</label>
          <span className="text-[11px] text-muted-foreground">{shown.length.toLocaleString('en-IN')} shown{rows.length < counts.total ? ` (the ${rows.length.toLocaleString('en-IN')} with most tickets are listed)` : ''}</span>
        </div>
      </div>
      <datalist id={listId}>{options.map((o) => <option key={o.id} value={o.label} />)}</datalist>
      <div className="overflow-x-auto rounded-lg border border-border bg-card p-3" tabIndex={0} role="region" aria-label={`Zoho ${word} and their CK Desk match`}>
        <table className="w-full text-left text-xs">
          <thead><tr className="border-b border-border text-muted-foreground"><th className="py-1 pr-3 font-medium">Zoho {kind}</th><th className="py-1 pr-3 font-medium">Tickets</th><th className="py-1 pr-3 font-medium">Matched to</th><th className="py-1 font-medium">Match by hand</th></tr></thead>
          <tbody>
            {shown.slice(0, 200).map((r) => {
              const typed = choice[r.key] ?? ''
              const id = byLabel.get(typed) ?? null
              return (
                <tr key={r.key} className="border-b border-border/60 align-top">
                  <td className="py-1 pr-3"><span className="text-foreground">{r.name || '(no name)'}</span>{r.email && <span className="block text-[11px] text-muted-foreground">{r.email}</span>}</td>
                  <td className="py-1 pr-3 tabular-nums text-muted-foreground">{r.tickets.toLocaleString('en-IN')}</td>
                  <td className="py-1 pr-3">
                    {r.how === 'none' ? <span className="text-amber-700 dark:text-amber-400">not matched</span> : <span className="text-foreground">{r.ckName} <span className="text-[11px] text-muted-foreground">({r.how === 'saved' ? 'by hand' : r.how === 'email' ? 'by e-mail' : 'by name'})</span></span>}
                  </td>
                  <td className="py-1">
                    {canEdit ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <input aria-label={`CK Desk person for the Zoho ${kind} ${r.name ?? r.email ?? ''}`} list={listId} value={typed} onChange={(e) => setChoice((p) => ({ ...p, [r.key]: e.target.value }))} placeholder="Type a name…" className="w-56 rounded-md border border-input bg-background px-2 py-1 text-xs" />
                        <button type="button" disabled={!id || pending} onClick={() => id && save(r, id)} className="rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground disabled:opacity-50">Save</button>
                        {r.savedProfileId && <button type="button" disabled={pending} onClick={() => save(r, null)} className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted">Remove hand match</button>}
                        {msg[r.key] && <span role="status" className={`text-[11px] ${msg[r.key].ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>{msg[r.key].text}</span>}
                      </div>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                </tr>
              )
            })}
            {shown.length === 0 && <tr><td colSpan={4} className="py-3 text-center text-muted-foreground">Nothing to show.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
