'use client'

import { Search } from 'lucide-react'

/**
 * Two plain forms, each a normal GET to this same page. No server action and no state: the ticket number (or the words) is simply
 * in the address, so a found ticket can be shared as a link or kept as a bookmark.
 */
export function TicketSearchForm({ defaultNo, defaultText }: { defaultNo: string; defaultText: string }) {
  return (
    <div className="grid gap-3 rounded-lg border border-border bg-card p-3 sm:grid-cols-2">
      <form method="GET" action="/zoho/tickets" className="space-y-1.5">
        <label htmlFor="zoho-no" className="text-xs font-medium text-foreground">Zoho ticket number</label>
        <div className="flex gap-2">
          <input
            id="zoho-no"
            name="no"
            defaultValue={defaultNo}
            inputMode="numeric"
            autoComplete="off"
            placeholder="129571"
            className="h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <button type="submit" className="h-9 shrink-0 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground hover:opacity-90">
            Open
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">Digits only, as the old system wrote it.</p>
      </form>

      <form method="GET" action="/zoho/tickets" className="space-y-1.5">
        <label htmlFor="zoho-q" className="text-xs font-medium text-foreground">Or search by words</label>
        <div className="flex gap-2">
          <input
            id="zoho-q"
            name="q"
            defaultValue={defaultText}
            autoComplete="off"
            placeholder="subject, store code or technician"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <button type="submit" className="flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm font-semibold text-foreground hover:bg-muted">
            <Search className="h-4 w-4" /> Search
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">At least 3 letters. Shows the newest 25 matches.</p>
      </form>
    </div>
  )
}
