export default function ProjectsLoading() {
  return (
    <div className="space-y-3 animate-pulse">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="h-6 w-28 rounded bg-muted" />
          <div className="h-3 w-80 rounded bg-muted" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-24 rounded-lg bg-muted" />
          <div className="h-9 w-24 rounded-lg bg-muted" />
          <div className="h-9 w-28 rounded-lg bg-muted" />
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-3">
            <div className="h-3 w-16 rounded bg-muted" />
            <div className="mt-2 h-6 w-10 rounded bg-muted" />
          </div>
        ))}
      </div>

      {/* Search + filters row */}
      <div className="flex items-center gap-2">
        <div className="h-8 w-64 rounded-lg bg-muted" />
        <div className="h-8 w-32 rounded-lg bg-muted" />
        <div className="flex gap-1.5">
          {[80, 88, 72].map((w, i) => (
            <div key={i} className="h-7 rounded-full bg-muted" style={{ width: w }} />
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center gap-4 border-b border-border bg-muted/30 px-3 py-2">
          {[160, 80, 80, 64, 80, 96, 64].map((w, i) => (
            <div key={i} className="h-3 rounded bg-muted" style={{ width: w }} />
          ))}
        </div>
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border px-3 py-2.5 last:border-0">
            <div className="h-3.5 flex-1 max-w-[220px] rounded bg-muted" />
            <div className="h-3 w-20 rounded bg-muted" />
            <div className="h-5 w-16 rounded-full bg-muted" />
            <div className="h-5 w-14 rounded-full bg-muted" />
            <div className="h-2 w-20 rounded-full bg-muted" />
            <div className="h-3 w-24 rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  )
}
