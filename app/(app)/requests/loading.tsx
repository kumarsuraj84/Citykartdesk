export default function RequestsLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="h-8 w-32 rounded-lg bg-muted" />
          <div className="h-4 w-48 rounded bg-muted" />
        </div>
        <div className="h-10 w-32 rounded-xl bg-muted" />
      </div>

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="h-10 w-64 rounded-xl bg-muted" />
        <div className="flex gap-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-7 w-20 rounded-full bg-muted" />
          ))}
        </div>
      </div>

      {/* List */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-3.5 last:border-0">
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 rounded bg-muted" />
              <div className="flex gap-2">
                <div className="h-3 w-20 rounded bg-muted" />
                <div className="h-3 w-24 rounded bg-muted" />
              </div>
            </div>
            <div className="hidden gap-2 sm:flex">
              <div className="h-5 w-16 rounded-full bg-muted" />
              <div className="h-5 w-14 rounded-full bg-muted" />
            </div>
            <div className="h-3 w-16 rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  )
}
