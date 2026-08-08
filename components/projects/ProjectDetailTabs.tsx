'use client'

import { useState } from 'react'

const ALL_TABS = [
  { id: 'tasks',      label: 'Tasks' },
  { id: 'requests',   label: 'Requests' },
  { id: 'milestones', label: 'Enhancements' },
  { id: 'updates',    label: 'Updates' },
  { id: 'activity',   label: 'Activity' },
] as const

type TabId = (typeof ALL_TABS)[number]['id']

interface Props {
  tasks: React.ReactNode
  requests: React.ReactNode
  milestones: React.ReactNode
  updates: React.ReactNode
  activity: React.ReactNode
  taskCount?: number
  requestCount?: number
  milestoneCount?: number
  updateCount?: number
  activityCount?: number
  initialTab?: TabId
}

export function ProjectDetailTabs({
  tasks,
  requests,
  milestones,
  updates,
  activity,
  taskCount = 0,
  requestCount = 0,
  milestoneCount = 0,
  updateCount = 0,
  activityCount = 0,
  initialTab = 'tasks',
}: Props) {
  const [active, setActive] = useState<TabId>(initialTab)

  const content: Record<TabId, React.ReactNode> = { tasks, requests, milestones, updates, activity }

  const badges: Record<TabId, number | undefined> = {
    tasks:      taskCount      > 0 ? taskCount      : undefined,
    requests:   requestCount   > 0 ? requestCount   : undefined,
    milestones: milestoneCount > 0 ? milestoneCount : undefined,
    updates:    updateCount    > 0 ? updateCount    : undefined,
    activity:   activityCount  > 0 ? activityCount  : undefined,
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {/* Tab bar */}
      <div className="border-b border-border bg-muted/20">
        <nav className="flex overflow-x-auto px-2 pt-1 gap-0">
          {ALL_TABS.map((tab) => {
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
                      isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {badge}
                  </span>
                )}
              </button>
            )
          })}
        </nav>
      </div>

      {/* Tab content */}
      <div className={active === 'tasks' ? '' : 'p-5'}>{content[active]}</div>
    </div>
  )
}
