import type { SLAConfig } from '@/types'

// Shared by any admin form editing an SLAConfig (services.sla_config,
// service_sub_categories.sla_config) — a per-priority response/resolution
// hours grid, backed by string state since inputs are <input type="number">.

export const SLA_PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const
export type SlaDraft = Record<(typeof SLA_PRIORITIES)[number], { response: string; resolution: string }>

export function slaConfigToDraft(config: SLAConfig | null | undefined): SlaDraft {
  const draft = {} as SlaDraft
  for (const p of SLA_PRIORITIES) {
    draft[p] = {
      response: config?.[p]?.response_hours != null ? String(config[p]!.response_hours) : '',
      resolution: config?.[p]?.resolution_hours != null ? String(config[p]!.resolution_hours) : '',
    }
  }
  return draft
}

export function draftToSlaConfig(draft: SlaDraft): SLAConfig {
  const config: SLAConfig = {}
  for (const p of SLA_PRIORITIES) {
    const response = draft[p].response.trim()
    const resolution = draft[p].resolution.trim()
    if (!response && !resolution) continue
    config[p] = {
      response_hours: response ? parseFloat(response) : null,
      resolution_hours: resolution ? parseFloat(resolution) : null,
    }
  }
  return config
}
