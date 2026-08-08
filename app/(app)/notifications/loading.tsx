export default function NotificationsLoading() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 animate-pulse">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="h-6 w-40 rounded bg-muted" />
          <div className="h-3 w-64 rounded bg-muted" />
        </div>
        <div className="h-8 w-28 rounded-lg bg-muted" />
      </div>

      <div className="flex gap-1 rounded-xl border border-border bg-muted/40 p-1">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-7 flex-1 rounded-lg bg-muted" />
        ))}
      </div>

      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-start gap-4 rounded-xl border border-border bg-card px-5 py-4">
            <div className="h-9 w-9 shrink-0 rounded-full bg-muted" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 rounded bg-muted" style={{ width: `${55 + (i % 4) * 10}%` }} />
              <div className="h-3 w-2/3 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
