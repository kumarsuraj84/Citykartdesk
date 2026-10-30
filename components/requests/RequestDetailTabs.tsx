'use client'

import { useState } from 'react'
import type { RequestTabId } from '@/lib/ui/requestTabs'

const ALL_TABS = [
  { id: 'conversations', label: 'Conversations' },
  { id: 'details',       label: 'Details' },
  { id: 'tasks',         label: 'Tasks' },
  { id: 'approvals',     label: 'Approvals' },
  { id: 'time_elapsed',  label: 'Time Elapsed' },
  { id: 'history',       label: 'History' },
] as const

type TabId = RequestTabId

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
  /** The tab the address asked for (?tab=...), already checked by parseRequestTab. */
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

  // A link that points at another tab of this same ticket (a notification clicked while the ticket is open) changes
  // the address, and the tab follows it. State derived from a prop, adjusted while rendering.
  const [prevInitial, setPrevInitial] = useState<TabId>(initialTab)
  if (prevInitial !== initialTab) {
    setPrevInitial(initialTab)
    setActive(initialTab)
  }

  const TABS = ALL_TABS.filter((t) => {
    if (t.id === 'approvals' && !showApprovals) return false
    return true
  })
  // (if the Approvals tab disappears while it is open, show Conversations)
  const current: TabId = TABS.some((t) => t.id === active) ? active : 'conversations'

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

  // Keeps the chosen tab in the address so a reload, a shared link or the Back button comes back to the same tab.
  // The browser's own history call is used (no page request, no scroll jump); the history entry's state is kept as it is.
  function choose(id: TabId) {
    setActive(id)
    try {
      const url = new URL(window.location.href)
      url.searchParams.set('tab', id)
      window.history.replaceState(window.history.state, '', url)
    } catch { /* the address is only a convenience */ }
  }

  // Left / Right arrows move between the tabs, as a tab list should
  function onTabKey(e: React.KeyboardEvent, index: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const next =
      e.key === 'Home' ? 0
      : e.key === 'End' ? TABS.length - 1
      : (index + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length
    choose(TABS[next].id)
    document.getElementById(`request-tab-${TABS[next].id}`)?.focus()
  }

  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
      {/* ── Left: tab bar + content ── */}
      <div className="min-w-0 flex-1">
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {/* Tab bar */}
          <div className="border-b border-border bg-muted/20">
            <div className="relative">
              <div role="tablist" aria-label="Ticket sections" className="flex overflow-x-auto px-2 pt-1 gap-0">
                {TABS.map((tab, index) => {
                  const badge = badges[tab.id]
                  const isActive = current === tab.id
                  return (
                    <button
                      key={tab.id}
                      id={`request-tab-${tab.id}`}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      aria-controls="request-tab-panel"
                      tabIndex={isActive ? 0 : -1}
                      onClick={() => choose(tab.id)}
                      onKeyDown={(e) => onTabKey(e, index)}
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
              </div>
              {/* Right-edge fade for overflow hint */}
              <div className="pointer-events-none absolute right-0 top-0 h-full w-12 bg-gradient-to-l from-card to-transparent" />
            </div>
          </div>

          {/* Tab content */}
          <div
            id="request-tab-panel"
            role="tabpanel"
            aria-labelledby={`request-tab-${current}`}
            className={current === 'tasks' || current === 'conversations' ? '' : 'p-5'}
          >
            {content[current]}
          </div>
        </div>
      </div>

      {/* ── Right: sidebar ── */}
      <div className="w-full space-y-4 lg:w-[272px] lg:shrink-0">
        {sidebar}
      </div>
    </div>
  )
}
