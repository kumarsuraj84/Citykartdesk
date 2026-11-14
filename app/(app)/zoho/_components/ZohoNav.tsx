'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Archive, BarChart3, FileSearch, Table2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const TABS = [
  { href: '/zoho', label: 'Overview', icon: BarChart3, exact: true },
  { href: '/zoho/reports', label: 'Reports', icon: Table2 },
  { href: '/zoho/tickets', label: 'Find a ticket', icon: FileSearch },
]

export function ZohoNav() {
  const path = usePathname()
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
        <Archive className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Zoho data.</span> Everything on these pages comes from the old Zoho (ManageEngine) system, kept in its own
          database. It is read only, it keeps Zoho&apos;s own words for statuses, services, technicians and stores, and it is not joined to CK Desk in any way.
        </p>
      </div>
      <nav className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => {
          const active = t.exact ? path === t.href : path === t.href || path.startsWith(t.href + '/')
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
