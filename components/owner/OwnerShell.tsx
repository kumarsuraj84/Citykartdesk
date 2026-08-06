'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Building2, Inbox, ShieldCheck, Bug, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const NAV = [
  { href: '/owner/orgs',      label: 'Organizations', icon: Building2 },
  { href: '/owner/requests',  label: 'Requests',      icon: Inbox },
  { href: '/owner/licensing', label: 'Licensing',     icon: ShieldCheck },
  { href: '/owner/errors',    label: 'Error Reports', icon: Bug },
]

export function OwnerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router   = useRouter()

  async function handleLogout() {
    await fetch('/api/owner/auth', { method: 'DELETE' })
    toast.success('Signed out')
    router.replace('/owner/login')
  }

  return (
    <div className="relative flex h-screen overflow-hidden text-foreground antialiased">
      {/* Ambient backdrop */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-background" />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(120%_120%_at_0%_0%,rgba(13,148,136,0.10),transparent_45%),radial-gradient(120%_120%_at_100%_0%,rgba(79,70,229,0.08),transparent_45%)]" />

      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 flex flex-col border-r border-border bg-card/80 backdrop-blur-xl">
        {/* Logo */}
        <div className="h-14 flex items-center gap-3 px-4 border-b border-border">
          <div className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-indigo-600 shadow-lg shadow-emerald-500/20">
            <ShieldCheck className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-[12px] font-semibold tracking-tight truncate">CognixDesk</p>
            <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Control Center</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2.5 space-y-0.5">
          <p className="px-2.5 pt-1 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Owner Portal</p>
          {NAV.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href || pathname.startsWith(href + '/')
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'group relative flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sm transition-all duration-200',
                  isActive
                    ? 'bg-gradient-to-r from-emerald-500/10 to-indigo-500/10 text-emerald-600 dark:text-emerald-400 font-semibold shadow-sm ring-1 ring-emerald-500/15'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                )}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-gradient-to-b from-emerald-500 to-indigo-500" />
                )}
                <Icon className={cn('h-4 w-4 flex-shrink-0', isActive ? 'text-emerald-500' : 'text-muted-foreground group-hover:text-foreground')} />
                <span className="flex-1 truncate">{label}</span>
              </Link>
            )
          })}
        </nav>

        {/* Back to app + logout */}
        <div className="border-t border-border p-2.5 space-y-1">
          <Link
            href="/home"
            className="flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            ← Back to CognixDesk
          </Link>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs font-medium text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden">
        {children}
      </main>
    </div>
  )
}
