export default function ServiceDetailLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-4 w-40 rounded bg-muted" />
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-muted" />
        <div className="space-y-2">
          <div className="h-6 w-56 rounded-lg bg-muted" />
          <div className="h-3.5 w-80 rounded bg-muted" />
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-3 w-24 rounded bg-muted" />
            <div className="h-9 w-full rounded-lg bg-muted" />
          </div>
        ))}
        <div className="flex justify-end"><div className="h-9 w-32 rounded-lg bg-muted" /></div>
      </div>
    </div>
  )
}
