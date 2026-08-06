export default function HomeLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Greeting skeleton */}
      <div className="h-8 w-48 rounded-lg bg-muted" />

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-start justify-between">
              <div className="h-3 w-24 rounded bg-muted" />
              <div className="h-8 w-8 rounded-lg bg-muted" />
            </div>
            <div className="h-8 w-16 rounded bg-muted" />
            <div className="mt-1.5 h-3 w-20 rounded bg-muted" />
          </div>
        ))}
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-3">
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="border-b border-border px-4 py-3">
              <div className="h-4 w-36 rounded bg-muted" />
            </div>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0">
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-24 rounded bg-muted" />
                  <div className="h-4 w-64 rounded bg-muted" />
                </div>
                <div className="h-4 w-4 rounded bg-muted" />
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-5 lg:col-span-2">
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="border-b border-border px-4 py-3">
              <div className="h-4 w-28 rounded bg-muted" />
            </div>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0">
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-16 rounded bg-muted" />
                  <div className="h-4 w-48 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
