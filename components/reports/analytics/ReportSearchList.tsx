'use client'

import { useState } from 'react'
import Link from 'next/link'
import { FileBarChart, ChevronRight, Folder, Search, X } from 'lucide-react'

/** Every word typed must be in the report's name; capitals do not matter. */
export function matchesReportSearch(title: string, query: string): boolean {
  const t = title.toLowerCase()
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => t.includes(w))
}

/** The predefined reports in their folder, with a box to find a report by its name. */
export function ReportSearchList({ folder, reports }: { folder: string; reports: { slug: string; title: string }[] }) {
  const [search, setSearch] = useState('')
  const shown = reports.filter((r) => matchesReportSearch(r.title, search))
  const searching = search.trim().length > 0

  return (
    <div className="space-y-3">
      <div className="relative w-full max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search reports" placeholder="Search reports by name…"
          className="w-full rounded-lg border border-border bg-card py-1.5 pl-8 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        />
        {searching && (
          <button type="button" onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <details open className="group overflow-hidden rounded-xl border border-border bg-card">
        <summary className="flex cursor-pointer list-none items-center gap-3 bg-muted/40 px-4 py-2.5 text-sm font-semibold text-foreground [&::-webkit-details-marker]:hidden">
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
          <Folder className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate">{folder}</span>
          <span className="rounded-full bg-background px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
            {searching ? `${shown.length} of ${reports.length}` : reports.length}
          </span>
        </summary>
        {shown.length === 0 ? (
          <p className="border-t border-border px-4 py-8 text-center text-sm text-muted-foreground">No report matches “{search.trim()}”.</p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {shown.map((def) => (
              <li key={def.slug}>
                <Link href={`/reports/analytics/${def.slug}`} className="flex items-center gap-3 py-2.5 pl-12 pr-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/50">
                  <FileBarChart className="h-4 w-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate">{def.title}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  )
}
