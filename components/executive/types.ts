import type { ApprovalMeasure, ApprovalRow, Dim, ExecTicket, Filters, Measure, Win } from '@/lib/reporting/executive/engine'
import type { DashLevel } from '@/lib/reporting/executive/levels'

/** The five "lenses" that show only some sections of the page. */
export type ViewMode = 'stream' | 'velocity' | 'people' | 'matrices' | 'tickets'

/** What the numbers on the page are worked out from (all sections get the same bundle). */
export interface DashData {
  level: DashLevel
  me: string
  now: number
  tickets: ExecTicket[]
  approvals: ApprovalRow[]
  filters: Filters
  /** the chosen period and the equally long one before it */
  W: Win
  P: Win
  compareOn: boolean
}

/** The dimensions a pop-up can start from. */
export type DrillDims = Partial<Record<Dim, string>>

/** Everything the 4-leg pop-up needs to open on the right slice. */
export interface DrillContext {
  title: string
  subtitle: string
  stage: 1 | 2 | 3 | 4
  metric: Measure
  /** when set, the pop-up looks at tickets with an approval of this kind (waiting, approved, rejected ...) */
  approvals?: ApprovalMeasure
  dims: DrillDims
  /** narrower time window (a clicked week or day), instead of the dashboard's period */
  win?: Win
  winLabel?: string
  ticketId?: string
  sla?: 'all' | 'breached' | 'ok'
}

/** Opens the drill-down pop-up. Only the title, subtitle and stage are required; everything else defaults. */
export type OpenDrill = (c: Partial<DrillContext> & Pick<DrillContext, 'title' | 'subtitle' | 'stage'>) => void
