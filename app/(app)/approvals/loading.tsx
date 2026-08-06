export default function ApprovalsLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="h-7 w-32 rounded-lg bg-muted" />
          <div className="h-4 w-64 rounded bg-muted" />
        </div>
        <div className="h-9 w-28 rounded-lg bg-muted" />
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl border border-border bg-muted/50 p-1 w-fit">
        {['Pending', 'Approved', 'Rejected', 'All'].map((label) => (
          <div key={label} className="h-7 rounded-lg bg-muted px-4 py-1" style={{ width: label.length * 9 + 24 }} />
        ))}
      </div>

      {/* Approval rows */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-3.5 last:border-0">
            {/* Status icon */}
            <div className="h-8 w-8 shrink-0 rounded-full bg-muted" />

            {/* Title + meta */}
            <div className="flex-1 space-y-1.5">
              <div className="h-4 rounded bg-muted" style={{ width: `${55 + (i % 4) * 10}%` }} />
              <div className="flex gap-2">
                <div className="h-3 w-20 rounded bg-muted" />
                <div className="h-3 w-24 rounded bg-muted" />
                <div className="h-3 w-28 rounded bg-muted" />
              </div>
            </div>

            {/* Badges */}
            <div className="flex gap-1.5 shrink-0">
              <div className="h-5 w-16 rounded-full bg-muted" />
              <div className="h-5 w-14 rounded-full bg-muted" />
            </div>

            {/* Time */}
            <div className="h-3 w-16 rounded bg-muted shrink-0" />
          </div>
        ))}
      </div>
    </div>
  )
}
