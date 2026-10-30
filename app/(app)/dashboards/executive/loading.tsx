// Shown while the Smart Dashboard's tickets are loading (a year of tickets is read, so the first open takes a moment).
export default function ExecutiveDashboardLoading() {
  return (
    <div className="space-y-3 animate-pulse" aria-busy="true" aria-label="Loading the dashboard">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="h-6 w-48 rounded bg-muted" />
          <div className="h-3 w-72 rounded bg-muted" />
        </div>
        <div className="flex gap-2">
          {[56, 56, 56, 56, 72].map((w, i) => (
            <div key={i} className="h-8 rounded-lg bg-muted" style={{ width: w }} />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-3">
            <div className="h-3 w-20 rounded bg-muted" />
            <div className="mt-2 h-7 w-14 rounded bg-muted" />
            <div className="mt-2 h-3 w-24 rounded bg-muted" />
          </div>
        ))}
      </div>
      <div className="h-64 rounded-lg border border-border bg-card" />
    </div>
  )
}
