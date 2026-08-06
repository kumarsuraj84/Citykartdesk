'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

type AdminTab = {
  label: string
  href: string
  matches: string[]
  adminOnly?: boolean
}

const tabs: AdminTab[] = [
  {
    label: 'Organization',
    href: '/admin/users',
    matches: ['/admin/users', '/admin/teams', '/admin/org'],
  },
  {
    label: 'Services',
    href: '/admin/services',
    matches: ['/admin/services', '/admin/categories', '/admin/routing'],
    adminOnly: true,
  },
  {
    label: 'Workflow',
    href: '/admin/approvals',
    matches: ['/admin/approvals', '/admin/request-config'],
  },
  {
    label: 'Task Management',
    href: '/admin/task-config',
    matches: ['/admin/task-config'],
  },
  {
    label: 'Platform',
    href: '/admin/settings',
    matches: ['/admin/settings', '/admin/master-data'],
  },
]

interface AdminTabNavProps {
  role: string
}

export function AdminTabNav({ role }: AdminTabNavProps) {
  const pathname = usePathname()
  const isAdmin = role === 'admin'

  const visibleTabs = tabs.filter((t) => !t.adminOnly || isAdmin)

  return (
    <div className="border-b border-border bg-card">
      <nav className="mx-auto max-w-5xl flex gap-1 px-6 overflow-x-auto">
        {visibleTabs.map((tab) => {
          const isActive = tab.matches.some((m) => pathname.startsWith(m))
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'shrink-0 border-b-2 px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap',
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              )}
            >
              {tab.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
