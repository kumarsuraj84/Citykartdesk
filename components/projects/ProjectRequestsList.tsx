import Link from 'next/link'
import { Inbox } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { StatusBadge, PriorityBadge } from '@/components/requests/RequestBadges'
import { formatRelativeTime } from '@/lib/utils'
import type { RequestStatus, RequestPriority } from '@/types'

interface ProjectRequestRow {
  id: string
  request_no: string
  title: string
  status: RequestStatus
  priority: RequestPriority
  updated_at: string
  assignee: { id: string; full_name: string } | null
}

export function ProjectRequestsList({ requests }: { requests: ProjectRequestRow[] }) {
  if (requests.length === 0) {
    return (
      <div className="rounded-lg border border-[#E8E8F0] bg-white dark:border-border dark:bg-card">
        <EmptyState icon={Inbox} title="No linked requests" description="Attach a request to this project from its own detail page." />
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[#E8E8F0] bg-white dark:border-border dark:bg-card">
      <div className="divide-y divide-border">
        {requests.map((r) => (
          <Link
            key={r.id}
            href={`/requests/${r.id}`}
            className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40 transition-colors"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <p className="truncate text-sm font-semibold text-foreground">{r.title}</p>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-xs text-muted-foreground">{r.request_no}</span>
                {r.assignee && (
                  <>
                    <span className="text-muted-foreground/40">·</span>
                    <span className="text-xs text-muted-foreground">{r.assignee.full_name}</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <StatusBadge status={r.status} size="sm" />
              <PriorityBadge priority={r.priority} size="sm" />
            </div>
            <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap">
              {formatRelativeTime(r.updated_at)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
