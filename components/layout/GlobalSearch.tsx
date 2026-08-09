'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search, Loader2, FileText, CheckSquare, FolderKanban, LayoutGrid, User2,
  ClipboardCheck, X,
} from 'lucide-react'
import { globalSearch, type SearchResult, type GroupedSearchResults } from '@/lib/actions/search'

const GROUP_ORDER: Array<keyof GroupedSearchResults> = ['requests', 'tasks', 'projects', 'services', 'users', 'approvals']

const EMPTY_RESULTS: GroupedSearchResults = {
  requests: [], tasks: [], projects: [], services: [], users: [], approvals: [],
}

function ResultIcon({ type }: { type: SearchResult['type'] }) {
  const cls = 'h-3.5 w-3.5 shrink-0 text-muted-foreground'
  switch (type) {
    case 'request':  return <FileText className={cls} />
    case 'task':     return <CheckSquare className={cls} />
    case 'project':  return <FolderKanban className={cls} />
    case 'service':  return <LayoutGrid className={cls} />
    case 'user':     return <User2 className={cls} />
    case 'approval': return <ClipboardCheck className={cls} />
  }
}

function flattenResults(grouped: GroupedSearchResults): SearchResult[] {
  return GROUP_ORDER.flatMap((k) => grouped[k])
}

export function GlobalSearch({ dark = false }: { dark?: boolean }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [grouped, setGrouped] = useState<GroupedSearchResults>(EMPTY_RESULTS)
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  const flat = useMemo(() => flattenResults(grouped), [grouped])
  const hasResults = flat.length > 0

  // Global keyboard shortcut ⌘K
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Reset search state whenever the panel transitions to closed. Adjusting state during
  // render (React's documented pattern) instead of an effect, since this mirrors the
  // `open` flag rather than syncing with anything external.
  const [prevOpen, setPrevOpen] = useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (!open) {
      setQuery('')
      setGrouped(EMPTY_RESULTS)
      setActiveIdx(-1)
    }
  }

  // Debounced search
  useEffect(() => {
    if (query.trim().length < 2) {
      // Part of the debounced network-search effect below (cleared via setTimeout/cleanup),
      // not a plain prop mirror — clearing stale results when the query is too short.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGrouped(EMPTY_RESULTS)
      setLoading(false)
      setActiveIdx(-1)
      return
    }
    setLoading(true)
    setActiveIdx(-1)
    const timer = setTimeout(async () => {
      try {
        const res = await globalSearch(query)
        setGrouped(res)
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  const closeAndNavigate = useCallback(
    (href: string) => {
      router.push(href)
      setOpen(false)
      inputRef.current?.blur()
    },
    [router]
  )

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); return }
    if (!hasResults) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, flat.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault()
      const item = flat[activeIdx]
      if (item) closeAndNavigate(item.href)
    }
  }

  const showDropdown = open && (hasResults || loading || query.trim().length >= 2)

  return (
    <div ref={wrapperRef} className="relative">
      {/* Search input */}
      {dark ? (
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/10 px-2.5 h-9 w-64 transition-all focus-within:border-white/30 focus-within:bg-white/15">
          <Search className="h-3.5 w-3.5 shrink-0 text-white/50" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder="Search requests, services…"
            aria-label="Global search"
            autoComplete="off"
            className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder:text-white/50 outline-none"
          />
          {loading
            ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-white/50" />
            : query.length > 0
              ? <button type="button" onClick={() => { setQuery(''); setGrouped(EMPTY_RESULTS) }} className="text-white/50 hover:text-white"><X className="h-3 w-3" /></button>
              : <kbd className="hidden sm:inline-flex rounded bg-white/10 border border-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-white/70">⌘K</kbd>
          }
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-2.5 py-1.5 w-48 transition-all focus-within:w-64 focus-within:border-ring/40 focus-within:bg-background">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder="Search…"
            aria-label="Global search"
            autoComplete="off"
            className="flex-1 min-w-0 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
          />
          {loading
            ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
            : query.length > 0
              ? <button type="button" onClick={() => { setQuery(''); setGrouped(EMPTY_RESULTS) }} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
              : <kbd className="hidden sm:inline-flex rounded bg-background border border-border px-1 text-[9px] font-medium text-muted-foreground">⌘K</kbd>
          }
        </div>
      )}

      {/* Dropdown results */}
      {showDropdown && (
        <div className="absolute left-0 top-full mt-1.5 z-50 w-80 rounded-xl border border-border bg-card shadow-xl overflow-hidden">
          {/* Loading */}
          {loading && !hasResults && (
            <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Searching…
            </div>
          )}

          {/* No results */}
          {!loading && !hasResults && query.trim().length >= 2 && (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              No results for <span className="font-medium text-foreground">&ldquo;{query}&rdquo;</span>
            </div>
          )}

          {/* Results */}
          {hasResults && (
            <div className="max-h-72 overflow-y-auto p-1.5 space-y-0.5">
              {GROUP_ORDER.map((groupKey) => {
                const items = grouped[groupKey]
                if (items.length === 0) return null
                const groupLabel = { requests: 'Requests', tasks: 'Tasks', projects: 'Projects', services: 'Services', users: 'People', approvals: 'Approvals' }[groupKey]
                let offset = 0
                for (const k of GROUP_ORDER) { if (k === groupKey) break; offset += grouped[k].length }
                return (
                  <div key={groupKey}>
                    <p className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{groupLabel}</p>
                    {items.map((result, i) => {
                      const idx = offset + i
                      const isActive = idx === activeIdx
                      return (
                        <button
                          key={result.id}
                          type="button"
                          data-idx={idx}
                          onClick={() => closeAndNavigate(result.href)}
                          onMouseEnter={() => setActiveIdx(idx)}
                          className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors ${isActive ? 'bg-muted' : 'hover:bg-muted/60'}`}
                        >
                          <ResultIcon type={result.type} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              {result.badge && (
                                <span className="shrink-0 rounded bg-muted px-1 py-px text-[9px] font-mono text-muted-foreground">{result.badge}</span>
                              )}
                              <p className="truncate text-xs font-medium text-foreground">{result.title}</p>
                            </div>
                            {(result.subtitle || result.meta) && (
                              <p className="truncate text-[10px] text-muted-foreground mt-0.5">
                                {[result.subtitle, result.meta].filter(Boolean).join(' · ')}
                              </p>
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}

          {/* Footer */}
          {hasResults && (
            <div className="border-t border-border px-3 py-1.5 flex gap-3 text-[9px] text-muted-foreground">
              <span><kbd>↑↓</kbd> navigate</span>
              <span><kbd>↵</kbd> open</span>
              <span><kbd>Esc</kbd> close</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
