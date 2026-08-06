export default function AdminLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-7 w-48 rounded-lg bg-muted" />
        <div className="h-4 w-72 rounded bg-muted" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border bg-card shadow-sm">
            <div className="flex items-center gap-4 px-5 py-4">
              <div className="h-10 w-10 shrink-0 rounded-xl bg-muted" />
              <div className="flex-1 space-y-1.5">
                <div className="h-4 w-40 rounded bg-muted" />
                <div className="h-3 w-24 rounded bg-muted" />
              </div>
              <div className="h-8 w-20 rounded-xl bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
