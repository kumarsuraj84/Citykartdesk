export default function TasksLoading() {
  return (
    <div className="flex flex-col gap-2 animate-pulse">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-1.5">
          {[96, 88, 80, 104, 72].map((w, i) => (
            <div key={i} className="h-7 rounded-full bg-muted" style={{ width: w }} />
          ))}
        </div>
        <div className="flex gap-2">
          <div className="h-8 w-24 rounded-lg bg-muted" />
          <div className="h-8 w-28 rounded-lg bg-muted" />
        </div>
      </div>

      {/* Table header */}
      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
        <div className="h-3 flex-1 max-w-xs rounded bg-muted" />
        <div className="flex gap-6">
          {[48, 56, 48, 64].map((w, i) => (
            <div key={i} className="h-3 rounded bg-muted" style={{ width: w }} />
          ))}
        </div>
      </div>

      {/* Task rows */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-border px-3 py-2.5 last:border-0">
            <div className="h-4 w-4 rounded bg-muted shrink-0" />
            <div className="flex-1 space-y-1">
              <div className="h-3.5 rounded bg-muted" style={{ width: `${50 + (i % 5) * 10}%` }} />
              <div className="h-3 w-32 rounded bg-muted" />
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="h-5 w-16 rounded-full bg-muted" />
              <div className="h-5 w-14 rounded-full bg-muted" />
              <div className="h-6 w-6 rounded-full bg-muted" />
              <div className="h-3 w-16 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
