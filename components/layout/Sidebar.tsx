'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Home, Inbox, ListTodo, ShieldCheck, Bell, LayoutGrid, FolderKanban,
  BarChart3, Activity, Settings, Monitor, BookOpenText,
  Users, Tag, GitBranch, Building2, Database, Workflow,
  LogOut, BookOpen, KeyRound, ChevronDown, Sparkles, Filter,
  PanelLeftClose, PanelLeftOpen, Timer,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { signOut } from '@/lib/actions/auth'
import type { ProfileWithTeams, NavVisibility } from '@/types'
import type { NavCounts } from '@/lib/queries/profiles'

interface SidebarProps {
  profile: ProfileWithTeams
  navVisibility: NavVisibility
  navCounts: NavCounts
  className?: string
}

type NavItem = {
  label: string
  href: string
  icon: React.ElementType
  exactMatch?: boolean
  countKey?: keyof NavCounts
}

type NavGroup = { label: string; items: NavItem[] }
type NavSection = {
  key: string
  label?: string
  items?: NavItem[]
  groups?: NavGroup[]
  show?: boolean
}

function getInitials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
}

export function Sidebar({ profile, navVisibility, navCounts, className }: SidebarProps) {
  const pathname = usePathname()
  const { isAdmin, isManager, isAgent, enabledModules } = navVisibility
  const has = (m: string) => enabledModules.includes(m as never)

  const sections: NavSection[] = [
    {
      key: 'home',
      items: [{ label: 'Home', href: '/home', icon: Home, exactMatch: true }],
    },
    {
      key: 'workspace',
      label: 'Workspace',
      show: has('requests') || has('tasks') || has('approvals') || has('projects'),
      items: [
        ...(has('projects')  ? [{ label: 'Projects',      href: '/projects',      icon: FolderKanban, countKey: 'projects'      as keyof NavCounts }] : []),
        ...(has('requests') ? [{ label: 'Requests',      href: '/requests',      icon: Inbox,       countKey: 'requests'      as keyof NavCounts }] : []),
        ...(has('tasks')    ? [{ label: 'Tasks',          href: '/tasks',         icon: ListTodo,    countKey: 'tasks'         as keyof NavCounts }] : []),
        ...(has('approvals') && (isAgent || isManager || isAdmin)
          ? [{ label: 'Approvals', href: '/approvals', icon: ShieldCheck, countKey: 'approvals' as keyof NavCounts }] : []),
        { label: 'Notifications', href: '/notifications', icon: Bell, countKey: 'notifications' as keyof NavCounts },
      ],
    },
    {
      key: 'intake',
      label: 'Intake Intelligence',
      show: has('intake') && (isAgent || isManager || isAdmin),
      items: [
        { label: 'Dashboard', href: '/intake',          icon: Sparkles, exactMatch: true },
        { label: 'Inbox',     href: '/intake/inbox',    icon: Inbox    },
        ...(isAdmin
          ? [{ label: 'Channels', href: '/intake/channels', icon: GitBranch }] : []),
        ...(isAdmin
          ? [{ label: 'Rules',    href: '/intake/rules',    icon: Filter    }] : []),
        ...(isAdmin
          ? [{ label: 'Settings', href: '/intake/settings', icon: Settings  }] : []),
      ],
    },
    {
      key: 'analytics',
      label: 'Analytics',
      show: isManager || isAdmin,
      items: [
        { label: 'Dashboards', href: '/admin/reports',  icon: BarChart3 },
        { label: 'DeskTime',   href: '/admin/desktime',  icon: Timer     },
        { label: 'Audit Logs', href: '/admin/audit',    icon: Activity  },
      ],
    },
    {
      key: 'admin',
      label: 'Administration',
      show: isManager || isAdmin,
      groups: [
        {
          label: 'Access',
          items: [
            { label: 'Users',               href: '/admin/users', icon: Users    },
            { label: 'Teams',               href: '/admin/teams', icon: Users    },
            { label: 'Roles & Permissions', href: '/admin/roles', icon: KeyRound },
          ],
        },
        {
          label: 'Organization',
          items: [
            { label: 'Org Settings', href: '/admin/org', icon: Building2 },
          ],
        },
        ...(isAdmin && has('services') ? [{
          label: 'Service Desk',
          items: [
            { label: 'Service Catalog', href: '/admin/services',       icon: LayoutGrid },
            { label: 'Categories',      href: '/admin/categories',      icon: Tag        },
            { label: 'Routing Rules',   href: '/admin/routing',         icon: GitBranch  },
            ...(has('approvals') ? [{ label: 'Approval Flows', href: '/admin/approvals',      icon: ShieldCheck }] : []),
            ...(has('requests')  ? [{ label: 'Request Config', href: '/admin/request-config', icon: Workflow    }] : []),
            ...(has('tasks')     ? [{ label: 'Task Templates', href: '/admin/task-config',    icon: ListTodo    }] : []),
          ],
        }] : []),
        {
          label: 'System',
          items: [
            { label: 'Settings',       href: '/admin/settings',       icon: Settings },
            ...(isAdmin ? [{ label: 'Master Data', href: '/admin/master-data', icon: Database }] : []),
            { label: 'Knowledge Base', href: '/admin/knowledge-base', icon: BookOpen  },
          ],
        },
      ],
    },
    {
      key: 'queue',
      label: 'Queue',
      show: isAdmin,
      items: [
        { label: 'Monitoring', href: '/admin/monitoring', icon: Monitor      },
        { label: 'Jobs',       href: '/admin/runbooks',   icon: BookOpenText },
      ],
    },
  ].filter(s => s.show !== false)

  // default open all sections
  const defaultOpen = Object.fromEntries(sections.map(s => [s.key, true]))
  const defaultGroups: Record<string, boolean> = { Access: true, Organization: true, 'Service Desk': true, System: true }

  const [openSections, setOpenSections] = useState<Record<string, boolean>>(defaultOpen)
  const [openGroups, setOpenGroups]     = useState<Record<string, boolean>>(defaultGroups)
  const [collapsed, setCollapsed]       = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('fd-nav')
      if (saved) {
        const p = JSON.parse(saved)
        // client-only hydration from localStorage — must run after mount to avoid SSR mismatch
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (p.s) setOpenSections(p.s)
        if (p.g) setOpenGroups(p.g)
      }
      setCollapsed(localStorage.getItem('fd-nav-collapsed') === '1')
    } catch { /* ignore */ }
  }, [])

  function toggleCollapsed() {
    setCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem('fd-nav-collapsed', next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }

  // Flat list of every visible leaf item (across sections + groups) — used by
  // the collapsed icon rail, where the section/group structure is dropped.
  const flatItems: NavItem[] = sections.flatMap(s => [
    ...(s.items ?? []),
    ...(s.groups?.flatMap(g => g.items) ?? []),
  ])

  function persist(s: Record<string, boolean>, g: Record<string, boolean>) {
    try { localStorage.setItem('fd-nav', JSON.stringify({ s, g })) } catch { /* ignore */ }
  }

  function toggleSection(key: string) {
    setOpenSections(prev => { const n = { ...prev, [key]: !prev[key] }; persist(n, openGroups); return n })
  }
  function toggleGroup(label: string) {
    setOpenGroups(prev => { const n = { ...prev, [label]: !prev[label] }; persist(openSections, n); return n })
  }

  function isActive(item: NavItem) {
    if (item.exactMatch) return pathname === item.href
    return pathname === item.href || pathname.startsWith(item.href + '/')
  }

  function renderItem(item: NavItem) {
    const Icon  = item.icon
    const active = isActive(item)
    const count  = item.countKey ? navCounts[item.countKey] : 0

    return (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          'group flex items-center gap-2.5 h-8 px-2.5 rounded-md text-[13px] font-medium transition-all duration-150',
          active
            ? 'bg-sidebar-active text-primary shadow-[inset_0_1px_0_oklch(1_0_0/0.6)] border border-primary/20'
            : 'text-sidebar-foreground hover:bg-muted border border-transparent'
        )}
      >
        <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-primary' : 'text-sidebar-muted group-hover:text-foreground')} strokeWidth={active ? 2.5 : 2} />
        <span className="flex-1 truncate leading-none">{item.label}</span>
        {count > 0 && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary leading-none min-w-[18px] text-center">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </Link>
    )
  }

  return (
    <aside className={cn('flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200', collapsed ? 'w-16' : 'w-[200px]', className)}>
      {/* Collapse toggle */}
      <div className={cn('flex shrink-0 items-center px-2 pt-2', collapsed ? 'justify-center' : 'justify-end')}>
        <button
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="grid h-7 w-7 place-items-center rounded-md text-sidebar-muted hover:bg-muted hover:text-foreground transition-colors"
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      {/* Collapsed icon rail — flat list of all items, tooltips on hover */}
      {collapsed ? (
        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-2 space-y-1">
          {flatItems.map(item => {
            const Icon = item.icon
            const active = isActive(item)
            const count = item.countKey ? navCounts[item.countKey] : 0
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={cn(
                  'group relative flex h-9 items-center justify-center rounded-md transition-colors',
                  active
                    ? 'bg-sidebar-active text-primary border border-primary/20'
                    : 'text-sidebar-muted hover:bg-muted hover:text-foreground border border-transparent'
                )}
              >
                <Icon className="h-4 w-4 shrink-0" strokeWidth={active ? 2.5 : 2} />
                {count > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 grid h-3.5 min-w-[14px] place-items-center rounded-full bg-primary px-1 text-[8px] font-bold leading-none text-primary-foreground">
                    {count > 9 ? '9+' : count}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>
      ) : (
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
        {sections.map(section => {
          const open = openSections[section.key] ?? true

          /* Home — no heading, no toggle */
          if (!section.label) {
            return (
              <div key={section.key} className="pb-1">
                {section.items?.map(renderItem)}
              </div>
            )
          }

          return (
            <div key={section.key}>
              <button
                onClick={() => toggleSection(section.key)}
                className="w-full flex items-center justify-between px-2.5 py-1 mb-0.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-[oklch(0.55_0.02_250)] hover:text-foreground transition-colors"
              >
                <span>{section.label}</span>
                <ChevronDown className={cn('h-3 w-3 transition-transform duration-200', open ? '' : '-rotate-90')} />
              </button>

              {open && (
                <div className="space-y-0.5">
                  {section.items?.map(renderItem)}

                  {section.groups?.map(group => {
                    const gOpen = openGroups[group.label] ?? true
                    return (
                      <div key={group.label} className="mt-1">
                        <button
                          onClick={() => toggleGroup(group.label)}
                          className="w-full flex items-center justify-between px-2.5 py-0.5 mb-0.5 text-[9.5px] font-bold uppercase tracking-[0.14em] text-[oklch(0.65_0.02_250)] hover:text-foreground transition-colors"
                        >
                          <span>{group.label}</span>
                          <ChevronDown className={cn('h-2.5 w-2.5 transition-transform duration-200', gOpen ? '' : '-rotate-90')} />
                        </button>
                        {gOpen && (
                          <div className="ml-2 pl-2 border-l border-[oklch(0.91_0.008_245)] space-y-0.5">
                            {group.items.map(renderItem)}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>
      )}

      {/* User footer */}
      <div className="shrink-0 border-t border-sidebar-border p-3">
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <div className="h-8 w-8 shrink-0 rounded-lg bg-gradient-to-br from-primary-glow to-primary grid place-items-center text-primary-foreground text-xs font-bold shadow-sm" title={profile.full_name}>
              {getInitials(profile.full_name)}
            </div>
            <form action={signOut}>
              <button type="submit" className="h-7 w-7 grid place-items-center rounded-md hover:bg-muted text-sidebar-muted hover:text-foreground transition-colors" title="Sign out">
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </form>
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 shrink-0 rounded-lg bg-gradient-to-br from-primary-glow to-primary grid place-items-center text-primary-foreground text-xs font-bold shadow-sm">
              {getInitials(profile.full_name)}
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[12px] font-semibold text-foreground">{profile.full_name}</p>
              <p className="text-[10px] text-sidebar-muted capitalize mt-0.5">{profile.role.replace('_', ' ')}</p>
            </div>
            <form action={signOut}>
              <button type="submit" className="h-7 w-7 grid place-items-center rounded-md hover:bg-muted text-sidebar-muted hover:text-foreground transition-colors" title="Sign out">
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </form>
          </div>
        )}
      </div>
    </aside>
  )
}
