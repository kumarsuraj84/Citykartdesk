'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, LayoutGrid, Inbox, ListTodo, CheckCircle, Bell, Sparkles, FolderKanban, Menu } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Sidebar } from './Sidebar'
import type { NavVisibility, ProfileWithTeams } from '@/types'
import type { NavCounts } from '@/lib/queries/profiles'

interface MobileNavProps {
  profile: ProfileWithTeams
  navVisibility: NavVisibility
  navCounts: NavCounts
}

type MobileNavItem = {
  label: string
  href: string
  icon: React.ElementType
  show: boolean
}

export function MobileNav({ profile, navVisibility, navCounts }: MobileNavProps) {
  const pathname = usePathname()
  const { isAdmin, isManager, isAgent, enabledModules } = navVisibility
  const has = (m: string) => enabledModules.includes(m as never)

  // Same ordering as the desktop Sidebar's Workspace section — this is the
  // primary bottom bar, everything else lives behind "More".
  const items: MobileNavItem[] = [
    { label: 'Home',          href: '/home',          icon: Home,        show: true },
    { label: 'Projects',      href: '/projects',      icon: FolderKanban, show: has('projects') },
    { label: 'New Request',   href: '/services',      icon: LayoutGrid,  show: has('services') },
    { label: 'Requests',      href: '/requests',      icon: Inbox,       show: has('requests') },
    { label: 'Tasks',         href: '/tasks',         icon: ListTodo,    show: has('tasks') },
    { label: 'Intake',        href: '/intake',        icon: Sparkles,    show: has('intake') && (isAgent || isManager || isAdmin) },
    { label: 'Approvals',     href: '/approvals',     icon: CheckCircle, show: has('approvals') && (isAgent || isManager || isAdmin) },
    { label: 'Notifications', href: '/notifications', icon: Bell,        show: true },
  ]

  const visible = items.filter((i) => i.show)
  const showMore = isManager || isAdmin

  return (
    <div className="flex shrink-0 border-t border-border bg-card lg:hidden">
      {/* Primary shortcuts — scrolls horizontally on its own if it doesn't fit,
          but never pushes "More" (the full-nav escape hatch) off-screen. */}
      <nav className="flex flex-1 overflow-x-auto min-w-0">
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

      {showMore && (
        <Sheet>
          <SheetTrigger
            render={
              <button
                type="button"
                className="flex shrink-0 w-[64px] flex-col items-center gap-1 py-3 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors border-l border-border"
              />
            }
          >
            <Menu className="h-5 w-5 text-muted-foreground" />
            <span>More</span>
          </SheetTrigger>
          <SheetContent side="left" className="w-[260px] p-0">
            <SheetHeader className="p-3 pb-0">
              <SheetTitle>Navigation</SheetTitle>
            </SheetHeader>
            <div className="flex flex-1 min-h-0">
              <Sidebar
                profile={profile}
                navVisibility={navVisibility}
                navCounts={navCounts}
                forceExpanded
                className="flex w-full border-r-0"
              />
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  )
}
