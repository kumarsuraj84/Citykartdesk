import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { getGlobalSLAConfig } from '@/lib/queries/admin'
import { SLAConfigClient } from './SLAConfigClient'
import { FieldSlaMatrixClient } from './FieldSlaMatrixClient'
import { getFieldSlaMatrix } from '@/lib/sla/matrix'
import { AppSettingsClient } from './AppSettingsClient'
import { BusinessHoursClient } from './BusinessHoursClient'
import { HolidayCalendarClient } from './HolidayCalendarClient'
import { EscalationRulesClient } from './EscalationRulesClient'
import { AlertRulesClient } from './AlertRulesClient'
import { PageHeader } from '@/components/ui/PageHeader'
import { STATUS_LABELS } from '@/lib/constants/requests'
import { AGENT_TRANSITIONS, REQUESTER_TRANSITIONS } from '@/lib/constants/request-transitions'
import type { RequestStatus } from '@/types'

type Tab = 'sla' | 'field-sla' | 'lifecycle' | 'business-hours' | 'escalation' | 'alerts' | 'general'

const TABS: { id: Tab; label: string }[] = [
  { id: 'sla',            label: 'SLA Targets'    },
  { id: 'field-sla',      label: 'Field SLA Matrix' },
  { id: 'lifecycle',      label: 'Lifecycle'       },
  { id: 'business-hours', label: 'Business Hours'  },
  { id: 'escalation',     label: 'Escalation'      },
  { id: 'alerts',         label: 'Alert Rules'     },
  { id: 'general',        label: 'General'         },
]

export default async function RequestConfigPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!['admin', 'manager', 'platform_owner'].includes(profile.role)) redirect('/home')

  const sp  = await searchParams
  const tab = (TABS.find(t => t.id === sp.tab) ? sp.tab : 'sla') as Tab

  // Fetch only what the active tab needs
  const supabase = await createClient()

  const slaConfig = tab === 'sla' ? await getGlobalSLAConfig() : null
  const fieldSlaMatrix = tab === 'field-sla' ? await getFieldSlaMatrix() : null

  const [{ data: businessHours }, { data: holidays }] = tab === 'business-hours'
    ? await Promise.all([
        supabase.from('business_hours').select('*').order('day_of_week'),
        supabase.from('holidays').select('*').order('date'),
      ])
    : [{ data: null }, { data: null }]

  const { data: escalationRules } = tab === 'escalation'
    ? await supabase.from('sla_escalation_rules').select('*').order('trigger_pct')
    : { data: null }

  const { data: alertRules } = tab === 'alerts'
    ? await supabase.from('alert_rules').select('*').order('created_at')
    : { data: null }

  const { data: autoCloseRow } = tab === 'general'
    ? await supabase.from('app_settings').select('value').eq('key', 'auto_close_days').single()
    : { data: null }
  const autoCloseDays = parseInt((autoCloseRow as { value?: string } | null)?.value ?? '7', 10)

  const statuses = Object.keys(STATUS_LABELS) as RequestStatus[]

  return (
    <div className={`space-y-5 ${tab === 'field-sla' ? 'max-w-6xl' : 'max-w-4xl'}`}>
      <PageHeader
        title="Request Configuration"
        description="Manage SLA policies, lifecycle statuses, and request governance settings."
      />

      {/* ── Tab bar ── */}
      <div className="flex border-b border-border gap-1">
        {TABS.map((t) => {
          const active = tab === t.id
          return (
            <Link
              key={t.id}
              href={`?tab=${t.id}`}
              className={`px-3 py-1.5 text-[11px] font-medium border-b-2 transition-colors -mb-px ${
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </Link>
          )
        })}
      </div>

      {/* ── SLA Targets ── */}
      {tab === 'sla' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-sm font-semibold text-foreground">SLA Targets by Priority</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Default response and resolution targets by priority. Individual services can override these.
            </p>
          </div>
          <SLAConfigClient initialConfig={slaConfig ?? []} />

          {/* Priority reference */}
          <div className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Priority Levels</h2>
              <p className="text-sm text-muted-foreground mt-0.5">Available priority levels applied to requests and SLA targets.</p>
            </div>
            <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
              {[
                { key: 'urgent', label: 'Urgent / Critical', cls: 'text-red-600 bg-red-50 border-red-100' },
                { key: 'high',   label: 'High',              cls: 'text-orange-600 bg-orange-50 border-orange-100' },
                { key: 'medium', label: 'Medium',            cls: 'text-blue-600 bg-blue-50 border-blue-100' },
                { key: 'low',    label: 'Low',               cls: 'text-slate-600 bg-slate-50 border-slate-200' },
              ].map(({ key, label, cls }) => (
                <div key={key} className="flex items-center gap-3 border-b border-border/50 last:border-0 px-4 py-3">
                  <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>
                  <span className="text-xs text-muted-foreground capitalize">{key}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Field SLA Matrix ── */}
      {tab === 'field-sla' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Field-Level SLA Matrix</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Set a different resolution-time SLA for individual dropdown/radio/multi-select values across the
              catalog — e.g. two reasons under the same service can carry different targets. Only resolution
              hours are set here; response-time SLA still comes from the service or org default. The most
              specific match wins: field value → service → org default.
            </p>
          </div>
          <FieldSlaMatrixClient rows={fieldSlaMatrix ?? []} />
        </div>
      )}

      {/* ── Lifecycle ── */}
      {tab === 'lifecycle' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Request Lifecycle</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Status flow and permitted transitions. Terminal statuses end the request lifecycle.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
            <div className="grid grid-cols-[140px_1fr_1fr_80px] border-b border-border bg-muted/30 px-4 py-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Agent Transitions</span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Requester Transitions</span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Terminal</span>
            </div>
            {statuses.map((status) => {
              const agentNext     = AGENT_TRANSITIONS[status] ?? []
              const requesterNext = REQUESTER_TRANSITIONS[status] ?? []
              const isTerminal    = agentNext.length === 0 && requesterNext.length === 0
              return (
                <div
                  key={status}
                  className="grid grid-cols-[140px_1fr_1fr_80px] items-center border-b border-border/50 last:border-0 px-4 py-3"
                >
                  <span className="text-sm font-medium text-foreground">{STATUS_LABELS[status]}</span>
                  <div className="flex flex-wrap gap-1">
                    {agentNext.length === 0 ? (
                      <span className="text-xs text-muted-foreground/50">—</span>
                    ) : agentNext.map((s) => (
                      <span key={s} className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        {STATUS_LABELS[s]}
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {requesterNext.length === 0 ? (
                      <span className="text-xs text-muted-foreground/50">—</span>
                    ) : requesterNext.map((s) => (
                      <span key={s} className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {STATUS_LABELS[s]}
                      </span>
                    ))}
                  </div>
                  <div>
                    {isTerminal && (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-600 border border-red-100">
                        Terminal
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Business Hours ── */}
      {tab === 'business-hours' && (
        <div className="space-y-6">
          <div className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Business Hours</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Define working hours per day. SLA timers only count during active business hours.
              </p>
            </div>
            <BusinessHoursClient initialRows={businessHours ?? []} />
          </div>
          <div className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Holiday Calendar</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Holidays are excluded from SLA business hours calculations. Recurring holidays repeat each year.
              </p>
            </div>
            <HolidayCalendarClient initialHolidays={holidays ?? []} />
          </div>
        </div>
      )}

      {/* ── Escalation ── */}
      {tab === 'escalation' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">SLA Escalation Rules</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Automatically notify roles when a request reaches a percentage of its SLA window.
            </p>
          </div>
          <EscalationRulesClient initialRules={escalationRules ?? []} />
        </div>
      )}

      {/* ── Alerts ── */}
      {tab === 'alerts' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Alert Rules</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Configure automated alerts for due dates, overdue tasks, unassigned requests, and daily digest emails.
            </p>
          </div>
          <AlertRulesClient initialRules={alertRules ?? []} />
        </div>
      )}

      {/* ── General ── */}
      {tab === 'general' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">General Settings</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Global platform behaviour settings applied across all teams and services.
            </p>
          </div>
          <AppSettingsClient autoCloseDays={autoCloseDays} />
        </div>
      )}
    </div>
  )
}
