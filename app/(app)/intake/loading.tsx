export default function IntakeLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="space-y-2">
        <div className="h-7 w-48 rounded-lg bg-muted" />
        <div className="h-4 w-80 rounded bg-muted" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card px-4 py-3.5 space-y-2">
            <div className="h-2.5 w-16 rounded bg-muted" />
            <div className="h-7 w-10 rounded bg-muted" />
            <div className="h-2.5 w-20 rounded bg-muted" />
          </div>
        ))}
      </div>
      <div className="h-40 rounded-xl border border-border bg-card" />
    </div>
  )
}
