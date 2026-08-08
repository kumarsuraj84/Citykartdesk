'use client'

import { useState, useEffect } from 'react'

const ALL_TABS = [
  { id: 'conversations', label: 'Conversations' },
  { id: 'details',       label: 'Details' },
  { id: 'tasks',         label: 'Tasks' },
  { id: 'approvals',     label: 'Approvals' },
  { id: 'time_elapsed',  label: 'Time Elapsed' },
  { id: 'history',       label: 'History' },
] as const

type TabId = (typeof ALL_TABS)[number]['id']

interface Props {
  conversations:   React.ReactNode
  details:         React.ReactNode
  tasks:           React.ReactNode
  approvals:       React.ReactNode
  timeElapsed:     React.ReactNode
  history:         React.ReactNode
  sidebar:         React.ReactNode
  commentCount?:   number
  activityCount?:  number
  taskCount?:      number
  showApprovals?:  boolean
  initialTab?:     TabId
}

export function RequestDetailTabs({
  conversations,
  details,
  tasks,
  approvals,
  timeElapsed,
  history,
  sidebar,
  commentCount  = 0,
  activityCount = 0,
  taskCount     = 0,
  showApprovals = false,
  initialTab    = 'conversations',
}: Props) {
  const [active, setActive] = useState<TabId>(initialTab)

  useEffect(() => {
    function handleFocusComment() {
      setActive('conversations')
      // Let the tab content render before focusing
      setTimeout(() => {
        document.querySelector<HTMLTextAreaElement>('textarea')?.focus()
      }, 0)
    }
    window.addEventListener('citykart:focus-comment', handleFocusComment)
    return () => window.removeEventListener('citykart:focus-comment', handleFocusComment)
  }, [])

  const TABS = ALL_TABS.filter((t) => {
    if (t.id === 'approvals' && !showApprovals) return false
    return true
  })

  const content: Record<TabId, React.ReactNode> = {
    conversations,
    details,
    tasks,
    approvals,
    time_elapsed: timeElapsed,
    history,
  }

  const badges: Partial<Record<TabId, number>> = {
    conversations: commentCount  > 0 ? commentCount  : undefined,
    history:       activityCount > 0 ? activityCount : undefined,
    tasks:         taskCount     > 0 ? taskCount     : undefined,
  }

  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
      {/* ── Left: tab bar + content ── */}
      <div className="min-w-0 flex-1">
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {/* Tab bar */}
          <div className="border-b border-border bg-muted/20">
            <div className="relative">
              <nav className="flex overflow-x-auto px-2 pt-1 gap-0">
                {TABS.map((tab) => {
                  const badge = badges[tab.id]
                  const isActive = active === tab.id
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActive(tab.id)}
                      className={`relative flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-1.5 text-[11px] font-medium transition-colors ${
                        isActive
                          ? 'border-primary text-primary'
                          : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border/60'
                      }`}
                    >
                      {tab.label}
                      {badge != null && (
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
                            isActive
                              ? 'bg-primary/10 text-primary'
                              : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {badge}
                        </span>
                      )}
                    </button>
                  )
                })}
              </nav>
              {/* Right-edge fade for overflow hint */}
              <div className="pointer-events-none absolute right-0 top-0 h-full w-12 bg-gradient-to-l from-card to-transparent" />
            </div>
          </div>

          {/* Tab content */}
          <div className={active === 'tasks' || active === 'conversations' ? '' : 'p-5'}>{content[active]}</div>
        </div>
      </div>

      {/* ── Right: sidebar ── */}
      <div className="w-full space-y-4 lg:w-[272px] lg:shrink-0">
        {sidebar}
      </div>
    </div>
  )
}
