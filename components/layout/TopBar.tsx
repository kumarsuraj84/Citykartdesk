'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, Settings, LogOut, User, Sparkles, ChevronDown } from 'lucide-react'
import { NotificationBell } from './NotificationBell'
import { GlobalSearch } from './GlobalSearch'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { signOut } from '@/lib/actions/auth'
import { Sidebar } from './Sidebar'
import { cn } from '@/lib/utils'
import type { ProfileWithTeams, NavVisibility } from '@/types'
import type { NotificationWithActor } from '@/types'

interface TopBarProps {
  profile: ProfileWithTeams
  navVisibility: NavVisibility
  unreadCount: number
  initialNotifications: NotificationWithActor[]
}

function getInitials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
}

type PrimaryGroup = {
  label: string
  href: string
  paths: string[]
  show: boolean
}

function usePrimaryGroups(navVisibility: NavVisibility): PrimaryGroup[] {
  const { isAdmin, isManager, enabledModules } = navVisibility
  const has = (m: string) => enabledModules.includes(m as never)
  // "My Work" only appears if at least one of its sub-modules is enabled
  const hasMyWork = has('requests') || has('tasks') || has('approvals')
  return [
    { label: 'Home',           href: '/home',                   paths: ['/home'],                                                                                                                                     show: true },
    { label: 'Workspace',      href: has('requests') ? '/requests' : has('tasks') ? '/tasks' : '/approvals', paths: ['/requests', '/tasks', '/approvals', '/notifications'],                               show: hasMyWork },
    { label: 'Analytics',      href: '/admin/reports',          paths: ['/admin/reports', '/admin/audit'],                                                                                                   show: isManager || isAdmin },
    { label: 'Administration', href: '/admin/users',            paths: ['/admin/users','/admin/teams','/admin/roles','/admin/departments','/admin/locations','/admin/org','/admin/services','/admin/categories','/admin/routing','/admin/approvals','/admin/request-config','/admin/task-config','/admin/settings','/admin/master-data'], show: isManager || isAdmin },
    { label: 'Queue',          href: '/admin/monitoring',       paths: ['/admin/monitoring', '/admin/runbooks'],                                                                                              show: isAdmin },
    { label: 'Help',           href: '/admin/knowledge-base',   paths: ['/admin/knowledge-base', '/help'],                                                                                                   show: true },
  ].filter((g) => g.show)
}

function PrimaryNav({ groups, pathname }: { groups: PrimaryGroup[]; pathname: string }) {
  return (
    <nav className="hidden lg:flex items-center gap-0.5">
      {groups.map((group) => {
        const isActive = group.paths.some((p) =>
          group.href === '/home' ? pathname === '/home' : pathname.startsWith(p)
        )
        return (
          <Link
            key={group.href}
            href={group.href}
            className={cn(
              'px-3 py-1.5 text-[12px] font-semibold rounded-lg transition-all duration-150',
              isActive
                ? 'bg-white/20 text-white shadow-[inset_0_1px_0_oklch(1_0_0/0.2)]'
                : 'text-white/60 hover:text-white hover:bg-white/10'
            )}
          >
            {group.label}
          </Link>
        )
      })}
    </nav>
  )
}

export function TopBar({ profile, navVisibility, unreadCount, initialNotifications }: TopBarProps) {
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const groups = usePrimaryGroups(navVisibility)

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-primary/20 sticky top-0 z-40 px-4 sm:px-5 bg-gradient-to-r from-[oklch(0.22_0.08_255)] via-[oklch(0.26_0.1_255)] to-[oklch(0.22_0.08_255)]">
        {/* Brand mark */}
        <Link href="/home" className="flex items-center gap-2.5 shrink-0">
          <div className="relative h-8 w-8 rounded-lg grid place-items-center bg-gradient-to-br from-primary-glow to-primary shadow-[inset_0_1px_0_oklch(1_0_0/0.3),0_4px_12px_-4px_oklch(0.3_0.15_255/0.6)]">
            <Sparkles className="h-4 w-4 text-primary-foreground" strokeWidth={2.5} />
          </div>
          <div className="leading-none">
            <p className="font-extrabold text-[14px] tracking-tight text-white">CognixDesk</p>
            <p className="text-[8px] uppercase tracking-[0.18em] text-white/60 mt-0.5">Service Desk</p>
          </div>
        </Link>

        {/* Primary group tabs — styled for dark header */}
        <PrimaryNav groups={groups} pathname={pathname} />

        <div className="flex-1" />

        {/* Global search — glassmorphic */}
        <div className="hidden md:block">
          <GlobalSearch dark />
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-1">
          <NotificationBell
            initialNotifications={initialNotifications}
            initialUnreadCount={unreadCount}
            dark
          />

          <div className="h-5 w-px bg-white/15 mx-1" />

          {/* User avatar dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button className="flex items-center gap-2 pl-1 pr-2 h-9 rounded-lg hover:bg-white/10 transition-colors">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-glow to-primary grid place-items-center text-primary-foreground text-[11px] font-bold shadow-sm">
                    {getInitials(profile.full_name)}
                  </div>
                  <div className="hidden xl:block text-left leading-tight">
                    <p className="text-[12px] font-semibold text-white">{profile.full_name}</p>
                    <p className="text-[10px] text-white/60 capitalize">{profile.role}</p>
                  </div>
                  <ChevronDown className="h-3.5 w-3.5 text-white/60 hidden xl:block" />
                </button>
              }
            />
            <DropdownMenuContent align="end" className="w-52">
              <div className="px-3 py-2 border-b border-border">
                <p className="text-[12px] font-semibold text-ink">{profile.full_name}</p>
                <p className="text-[11px] text-ink-soft capitalize mt-0.5">{profile.role}</p>
              </div>
              <DropdownMenuItem render={<Link href="/profile" />}>
                <User className="mr-2 h-4 w-4" /> Profile
              </DropdownMenuItem>
              {navVisibility.isAdmin && (
                <DropdownMenuItem render={<Link href="/admin/users" />}>
                  <Settings className="mr-2 h-4 w-4" /> Admin settings
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                render={
                  <form action={signOut}>
                    <button type="submit" className="flex w-full cursor-pointer items-center" />
                  </form>
                }
              >
                <LogOut className="mr-2 h-4 w-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Mobile menu */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 lg:hidden ml-1 text-white hover:bg-white/10"
            onClick={() => setMobileMenuOpen(true)}
          >
            <Menu className="h-4 w-4" />
            <span className="sr-only">Open menu</span>
          </Button>
        </div>
      </header>

      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="left" className="w-[240px] p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation menu</SheetTitle>
          </SheetHeader>
          <Sidebar profile={profile} navVisibility={navVisibility} className="flex h-full" />
        </SheetContent>
      </Sheet>
    </>
  )
}
