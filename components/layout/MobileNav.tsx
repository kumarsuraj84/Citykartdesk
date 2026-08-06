'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, LayoutGrid, Inbox, ListTodo, CheckCircle, Bell, Settings, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NavVisibility } from '@/types'

interface MobileNavProps {
  navVisibility: NavVisibility
}

type MobileNavItem = {
  label: string
  href: string
  icon: React.ElementType
  show: boolean
}

export function MobileNav({ navVisibility }: MobileNavProps) {
  const pathname = usePathname()
  const { isAdmin, isManager, isAgent, enabledModules } = navVisibility
  const has = (m: string) => enabledModules.includes(m as never)

  const items: MobileNavItem[] = [
    { label: 'Home',          href: '/home',          icon: Home,        show: true },
    { label: 'New Request',   href: '/services',      icon: LayoutGrid,  show: has('services') },
    { label: 'Requests',      href: '/requests',      icon: Inbox,       show: has('requests') },
    { label: 'Tasks',         href: '/tasks',         icon: ListTodo,    show: has('tasks') },
    { label: 'Intake',        href: '/intake',        icon: Sparkles,    show: has('intake') && (isAgent || isManager || isAdmin) },
    { label: 'Approvals',     href: '/approvals',     icon: CheckCircle, show: has('approvals') && (isAgent || isManager || isAdmin) },
    { label: 'Notifications', href: '/notifications', icon: Bell,        show: true },
    { label: 'Admin',         href: '/admin/users',   icon: Settings,    show: isAdmin },
  ]

  const visible = items.filter((i) => i.show)

  return (
    <nav className="flex shrink-0 border-t border-border bg-card lg:hidden overflow-x-auto">
      {visible.map((item) => {
        const Icon = item.icon
        const isActive =
          item.href === '/home'
            ? pathname === '/home'
            : pathname.startsWith(item.href)

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex flex-1 min-w-[60px] flex-col items-center gap-1 py-3 text-[11px] font-medium transition-colors',
              isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon
              className={cn(
                'h-5 w-5',
                isActive ? 'text-primary' : 'text-muted-foreground'
              )}
            />
            <span>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
