export default function ServicesLoading() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="space-y-2">
        <div className="h-8 w-40 rounded-lg bg-muted" />
        <div className="h-4 w-64 rounded bg-muted" />
      </div>

      <div className="h-11 max-w-lg rounded-xl bg-muted" />

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border bg-card shadow-sm">
            <div className="flex items-start gap-4 p-5">
              <div className="h-12 w-12 shrink-0 rounded-xl bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-5 w-32 rounded bg-muted" />
                <div className="h-3 w-48 rounded bg-muted" />
                <div className="h-3 w-16 rounded bg-muted" />
              </div>
            </div>
            <div className="border-t border-border px-5 py-3">
              <div className="flex gap-2">
                {Array.from({ length: 3 }).map((_, j) => (
                  <div key={j} className="h-6 w-20 rounded-full bg-muted" />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
