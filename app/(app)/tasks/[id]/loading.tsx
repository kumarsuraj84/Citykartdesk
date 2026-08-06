export default function TaskDetailLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* Back link */}
      <div className="h-4 w-24 rounded bg-muted" />

      {/* Main panel */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Title area */}
        <div className="border-b border-border p-5 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2 flex-1">
              <div className="h-6 w-3/4 rounded-lg bg-muted" />
              <div className="flex gap-2">
                <div className="h-5 w-20 rounded-full bg-muted" />
                <div className="h-5 w-16 rounded-full bg-muted" />
                <div className="h-5 w-24 rounded-full bg-muted" />
              </div>
            </div>
            <div className="h-8 w-8 rounded-lg bg-muted shrink-0" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_260px]">
          {/* Left — description + comments */}
          <div className="border-r border-border p-5 space-y-5">
            <div className="space-y-2">
              <div className="h-3 w-full rounded bg-muted" />
              <div className="h-3 w-5/6 rounded bg-muted" />
              <div className="h-3 w-2/3 rounded bg-muted" />
            </div>

            <div className="space-y-3 pt-2">
              <div className="h-4 w-20 rounded bg-muted" />
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="h-7 w-7 rounded-full bg-muted shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-40 rounded bg-muted" />
                    <div className="h-3 w-full rounded bg-muted" />
                    <div className="h-3 w-3/4 rounded bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right — metadata */}
          <div className="p-4 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-1">
                <div className="h-3 w-16 rounded bg-muted" />
                <div className="h-4 w-28 rounded bg-muted" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
