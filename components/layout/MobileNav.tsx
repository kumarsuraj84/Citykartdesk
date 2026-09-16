'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, LayoutGrid, Inbox, ListTodo, CheckCircle, Bell, Sparkles, FolderKanban, Menu, Headset } from 'lucide-react'
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
    // Tasks/Projects aren't fully built out yet — Admin/Owner only until
    // that work ships, then reopened to everyone.
    { label: 'Projects',      href: '/projects',      icon: FolderKanban, show: has('projects') && isAdmin },
    { label: 'New Request',   href: '/services',      icon: LayoutGrid,  show: has('services') },
    { label: 'Requests',      href: '/requests',      icon: Inbox,       show: has('requests') },
    { label: 'Agent Requests', href: '/requests/queue', icon: Headset,   show: has('requests') && (isAgent || isManager || isAdmin) },
    { label: 'Tasks',         href: '/tasks',         icon: ListTodo,    show: has('tasks') && isAdmin },
    { label: 'Intake',        href: '/intake',        icon: Sparkles,    show: has('intake') && (isAgent || isManager || isAdmin) },
    // Any active user can be sent an ad-hoc approval, not just agent-tier roles.
    { label: 'Approvals',     href: '/approvals',     icon: CheckCircle, show: has('approvals') },
    { label: 'Notifications', href: '/notifications', icon: Bell,        show: true },
  ]

  const visible = items.filter((i) => i.show)

  // DESK-UI-004: this bar used to render every visible item (up to 8, at
  // min-w-[60px] each — ~544px minimum, wider than any phone) inside an
  // `overflow-x-auto` row with zero scroll affordance. A bottom tab bar
  // isn't a UI surface users expect to swipe — nothing signals there's more
  // to the right — so items past what fit were, in effect, invisible/
  // half-clipped. MAX_PRIMARY caps the bar to a count that provably fits at
  // every tested width down to 320px (4 items × 60px = 240px, comfortably
  // under a 320px screen's ~256px after the fixed 64px "More" button),
  // instead of a width-dependent scroll. `items` is already ordered by
  // priority per role (see the comment above), so capping it keeps the
  // most relevant items primary and folds the rest into "More" — nothing is
  // removed, just relocated, preserving role-specific items exactly as
  // before within the Sidebar rendered inside the sheet.
  const MAX_PRIMARY = 4
  const primary = visible.slice(0, MAX_PRIMARY)
  const overflowCount = visible.length - primary.length

  // Mirrors Sidebar.tsx's Analytics section: Dashboards/Audit Logs stay
  // manager/admin-only, but Report Builder is available to any role with
  // the Requests module enabled — so "More" must open for them too, or that
  // link would be reachable on desktop but not on mobile. Also always shown
  // whenever items overflow the primary bar, so nothing capped above becomes
  // unreachable.
  const showMore = overflowCount > 0 || isManager || isAdmin || has('requests')

  // When two items share a URL prefix (e.g. /requests and /requests/queue),
  // startsWith() alone would light up both — pick whichever visible item's
  // href most specifically matches the current path.
  // Active-item detection still checks every visible item (not just the
  // primary-bar subset) — an item relocated into "More" this render can
  // still legitimately be the current page.
  const activeItem = visible
    .filter((i) => i.href === '/home' ? pathname === '/home' : pathname === i.href || pathname.startsWith(i.href + '/'))
    .sort((a, b) => b.href.length - a.href.length)[0]

  return (
    <div className="flex shrink-0 border-t border-border bg-card lg:hidden">
      {/* Primary shortcuts — capped to MAX_PRIMARY so every item is always
          fully visible, never clipped or scrolled out of reach (see
          MAX_PRIMARY's comment above). */}
      <nav className="flex flex-1 min-w-0">
        {primary.map((item) => {
          const Icon = item.icon
          const isActive = item === activeItem

          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
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
