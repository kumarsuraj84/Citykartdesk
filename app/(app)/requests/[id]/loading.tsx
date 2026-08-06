export default function RequestDetailLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* Back link */}
      <div className="h-4 w-28 rounded bg-muted" />

      {/* Header bar */}
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="h-6 w-24 rounded bg-muted" />
          <div className="h-7 w-96 rounded-lg bg-muted" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-24 rounded-lg bg-muted" />
          <div className="h-9 w-24 rounded-lg bg-muted" />
        </div>
      </div>

      {/* Status + priority badges */}
      <div className="flex gap-2">
        <div className="h-6 w-20 rounded-full bg-muted" />
        <div className="h-6 w-16 rounded-full bg-muted" />
        <div className="h-6 w-24 rounded-full bg-muted" />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">

        {/* Left — description + activity */}
        <div className="space-y-4">
          {/* Description card */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="h-4 w-32 rounded bg-muted" />
            <div className="space-y-2">
              <div className="h-3 w-full rounded bg-muted" />
              <div className="h-3 w-5/6 rounded bg-muted" />
              <div className="h-3 w-4/6 rounded bg-muted" />
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 border-b border-border pb-0">
            {[80, 64, 72, 56].map((w, i) => (
              <div key={i} className={`h-8 w-${w} rounded-t-lg bg-muted`} style={{ width: w * 4 }} />
            ))}
          </div>

          {/* Activity items */}
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="h-7 w-7 shrink-0 rounded-full bg-muted mt-0.5" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-48 rounded bg-muted" />
                  <div className="h-3 w-32 rounded bg-muted" />
                </div>
                <div className="h-3 w-16 rounded bg-muted shrink-0" />
              </div>
            ))}
          </div>
        </div>

        {/* Right — sidebar */}
        <div className="space-y-3">
          {/* Assignee panel */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="h-4 w-24 rounded bg-muted" />
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-muted" />
              <div className="h-3 w-28 rounded bg-muted" />
            </div>
          </div>

          {/* Metadata rows */}
          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-2.5">
                <div className="h-3 w-16 rounded bg-muted" />
                <div className="h-3 w-24 rounded bg-muted" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
