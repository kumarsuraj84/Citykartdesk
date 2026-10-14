'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Loader2, X } from 'lucide-react'
import { DrilldownModal } from '@/components/executive/DrilldownModal'
import { drawerToDrill, type BridgeEnv, type DrillRequest } from '@/lib/analytics/drill-bridge'
import { joinApprovals, type ApprovalRow } from '@/lib/reporting/executive/engine'
import { loadDrillData, type DrillData } from '@/lib/actions/analytics-drill'
import type { DrawerFilter } from '@/lib/actions/analytics'

type Env = Omit<BridgeEnv, 'now'> & { /** the technicians / requesters picked on a team Dashboard: the tickets for a click are loaded for exactly these */ people?: { techIds?: string[]; requesterIds?: string[] }
  /** when the page's numbers were counted: a new moment means the tickets loaded for an earlier click are old */ asOf?: number }

type Open =
  | { phase: 'loading'; filter: DrawerFilter; title: string }
  | { phase: 'ready'; req: DrillRequest; id: number }

/**
 * Makes a click on a ticket number of the normal Dashboards page open the Smart Dashboard's pop-up (breakdown, store and technician slice,
 * ticket register, one ticket's last leg). `open(filter)` returns false when that number cannot be shown exactly that way (tasks, for example),
 * and the caller then keeps using its own side list. If the ticket data cannot be loaded, `fallback` gets the same click so nothing is lost.
 */
export function useRequestDrill(env: Env, fallback: (f: DrawerFilter) => void): { open: (f: DrawerFilter) => boolean; modal: ReactNode } {
  const [state, setState] = useState<Open | null>(null)
  const [data, setData] = useState<(DrillData & { joined: ApprovalRow[] }) | null>(null)
  // the click handler reads the latest page settings through refs, so `open` itself never changes (the page's widgets depend on it)
  const envRef = useRef(env)
  const fallbackRef = useRef(fallback)
  useEffect(() => { envRef.current = env; fallbackRef.current = fallback })
  const dataRef = useRef<(DrillData & { joined: ApprovalRow[] }) | null>(null)
  const seq = useRef(0)
  // when the page's numbers are counted again (it refreshes itself every minute, or another period is chosen) the tickets loaded for an earlier click are
  // old: forget them, so the next click loads the tickets the new numbers were counted from
  const peopleKey = JSON.stringify(env.people ?? {})
  useEffect(() => { dataRef.current = null }, [env.asOf, env.periodWindow.start, env.periodWindow.end, peopleKey])

  const open = useCallback((f: DrawerFilter): boolean => {
    // can it be shown this way at all? (answered at once, with the clock of this moment)
    if (!drawerToDrill(f, { ...envRef.current, now: Date.now() })) return false

    const show = (d: DrillData) => {
      // the pop-up's own clock is the one the ticket rows were worked out with
      const req = drawerToDrill(f, { ...envRef.current, now: d.now })
      if (!req) { fallbackRef.current(f); setState(null); return }
      seq.current += 1
      setState({ phase: 'ready', req, id: seq.current })
    }

    if (dataRef.current) { show(dataRef.current); return true }
    setState({ phase: 'loading', filter: f, title: f.title })
    loadDrillData(envRef.current.people).then((res) => {
      if ('error' in res) { fallbackRef.current(f); setState(null); return }
      const loaded = { ...res, joined: joinApprovals(res.approvals, res.tickets) }
      dataRef.current = loaded
      setData(loaded)
      show(res)
    }, () => { fallbackRef.current(f); setState(null) })
    return true
  }, [])

  const modal = useMemo<ReactNode>(() => {
    if (!state) return null
    if (state.phase === 'loading') {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setState(null) }}>
          <div role="status" className="flex items-center gap-3 rounded-xl border border-border bg-background px-5 py-4 text-sm shadow-2xl">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span>Opening <strong>{state.title}</strong>...</span>
            <button type="button" onClick={() => setState(null)} aria-label="Cancel" className="rounded p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
          </div>
        </div>
      )
    }
    if (!data) return null
    return (
      <DrilldownModal
        key={state.id} ctx={state.req.ctx} tickets={data.tickets} approvals={data.joined} filters={state.req.filters} now={data.now}
        W={env.periodWindow} periodText={env.periodLabel} onClose={() => setState(null)}
      />
    )
  }, [state, data, env.periodWindow, env.periodLabel])

  return { open, modal }
}
