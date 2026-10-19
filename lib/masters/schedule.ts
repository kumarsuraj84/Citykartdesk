// When the Google Sheets are copied into CK Desk's database: three times a day, at these times (Indian time). Everything else in CK Desk reads the database copy only.
// The scheduled task on the server (scripts/windows/install-cron-tasks.ps1) uses the same three times.
export const MASTER_SYNC_TIMES = ['11:00', '15:00', '19:00'] as const

const TZ = 'Asia/Kolkata'

function minutesOfDayIst(d: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d)
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return h * 60 + m
}

/** "today 15:00" / "tomorrow 11:00": the next scheduled update after `now`. */
export function nextMasterSyncLabel(now: Date = new Date()): string {
  const cur = minutesOfDayIst(now)
  for (const t of MASTER_SYNC_TIMES) {
    const [h, m] = t.split(':').map(Number)
    if (h * 60 + m > cur) return `today ${t}`
  }
  return `tomorrow ${MASTER_SYNC_TIMES[0]}`
}
