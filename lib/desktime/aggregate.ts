// Pure data-shaping functions, ported from the org's own DeskTime tracker
// (src/hooks/use-desktime-apps.ts, src/components/tracker/PersonProjectHoursPanel.tsx).
// There they ran client-side over react-query results; here they run over
// rows already fetched server-side — the grouping/aggregation logic itself
// is unchanged.

export interface AppLogRow {
  work_date: string
  member_name: string
  app_name: string
  minutes: number
}

export interface AppNameBucket { name: string; minutes: number }

export interface MemberAppHours {
  member: string
  aiMinutes: number
  otherMinutes: number
  totalMinutes: number
  topAi: AppNameBucket[]
  topOther: AppNameBucket[]
}

export interface AppBucketRow { name: string; minutes: number; isAi: boolean }
export interface DayBucket { date: string; ai: number; other: number }

export function isAiApp(appName: string, patterns: string[]): boolean {
  const lower = appName.toLowerCase()
  return patterns.some((p) => p && lower.includes(p))
}

export function summariseAppHours(logs: AppLogRow[], patterns: string[]): MemberAppHours[] {
  const byMember = new Map<string, { ai: Map<string, number>; other: Map<string, number> }>()

  for (const log of logs) {
    if (!byMember.has(log.member_name)) byMember.set(log.member_name, { ai: new Map(), other: new Map() })
    const entry = byMember.get(log.member_name)!
    const bucket = isAiApp(log.app_name, patterns) ? entry.ai : entry.other
    bucket.set(log.app_name, (bucket.get(log.app_name) ?? 0) + log.minutes)
  }

  const topN = (m: Map<string, number>): AppNameBucket[] =>
    [...m.entries()].map(([name, minutes]) => ({ name, minutes })).sort((a, b) => b.minutes - a.minutes).slice(0, 4)

  const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0)

  return [...byMember.entries()]
    .map(([member, { ai, other }]) => {
      const aiMinutes = sum(ai)
      const otherMinutes = sum(other)
      return {
        member,
        aiMinutes,
        otherMinutes,
        totalMinutes: aiMinutes + otherMinutes,
        topAi: topN(ai),
        topOther: topN(other),
      }
    })
    .sort((a, b) => b.totalMinutes - a.totalMinutes)
}

export function summariseByApp(logs: AppLogRow[], patterns: string[]): AppBucketRow[] {
  const totals = new Map<string, number>()
  for (const log of logs) totals.set(log.app_name, (totals.get(log.app_name) ?? 0) + log.minutes)
  return [...totals.entries()]
    .map(([name, minutes]) => ({ name, minutes, isAi: isAiApp(name, patterns) }))
    .sort((a, b) => b.minutes - a.minutes)
}

export function summariseByDay(logs: AppLogRow[], patterns: string[]): DayBucket[] {
  const byDate = new Map<string, { ai: number; other: number }>()
  for (const log of logs) {
    const bucket = byDate.get(log.work_date) ?? { ai: 0, other: 0 }
    if (isAiApp(log.app_name, patterns)) bucket.ai += log.minutes
    else bucket.other += log.minutes
    byDate.set(log.work_date, bucket)
  }
  return [...byDate.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => (a.date < b.date ? -1 : 1))
}

// Per-member/day AI ratio (ai minutes / total minutes), derived from app
// logs. desktime_time_logs (project time) has no AI/other split itself —
// only desktime_app_logs does — so this ratio is applied to project minutes
// downstream to estimate an AI/other split per project.
export function computeAiRatios(appLogs: AppLogRow[], patterns: string[]): Map<string, number> {
  const totals = new Map<string, { ai: number; total: number }>()
  for (const log of appLogs) {
    const key = `${log.member_name}|${log.work_date}`
    const entry = totals.get(key) ?? { ai: 0, total: 0 }
    entry.total += log.minutes
    if (isAiApp(log.app_name, patterns)) entry.ai += log.minutes
    totals.set(key, entry)
  }
  const ratios = new Map<string, number>()
  for (const [key, { ai, total }] of totals) ratios.set(key, total > 0 ? ai / total : 0)
  return ratios
}

export interface MemberProjectLog {
  work_date: string
  member_name: string
  minutes: number
  project_id: string | null
  project_name: string
}

export interface ProjectRow {
  project: string
  minutes: number
  aiMinutes: number
  otherMinutes: number
  days: number
}

export interface PersonRow {
  member: string
  totalMinutes: number
  aiMinutes: number
  otherMinutes: number
  projects: ProjectRow[]
}

export function buildPersonProjectRows(logs: MemberProjectLog[], aiRatios: Map<string, number>): PersonRow[] {
  const byMember = new Map<string, Map<string, { minutes: number; ai: number; dates: Set<string> }>>()

  for (const log of logs) {
    if (!byMember.has(log.member_name)) byMember.set(log.member_name, new Map())
    const projects = byMember.get(log.member_name)!
    const entry = projects.get(log.project_name) ?? { minutes: 0, ai: 0, dates: new Set<string>() }
    const ratio = aiRatios.get(`${log.member_name}|${log.work_date}`) ?? 0
    entry.minutes += log.minutes
    entry.ai += Math.round(log.minutes * ratio)
    entry.dates.add(log.work_date)
    projects.set(log.project_name, entry)
  }

  return [...byMember.entries()]
    .map(([member, projects]) => {
      const projectRows: ProjectRow[] = [...projects.entries()]
        .map(([project, { minutes, ai, dates }]) => ({
          project,
          minutes,
          aiMinutes: ai,
          otherMinutes: minutes - ai,
          days: dates.size,
        }))
        .sort((a, b) => b.minutes - a.minutes)

      const totalMinutes = projectRows.reduce((s, p) => s + p.minutes, 0)
      const aiMinutes = projectRows.reduce((s, p) => s + p.aiMinutes, 0)
      return { member, totalMinutes, aiMinutes, otherMinutes: totalMinutes - aiMinutes, projects: projectRows }
    })
    .sort((a, b) => b.totalMinutes - a.totalMinutes)
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}
