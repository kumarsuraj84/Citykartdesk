// Wording and fixed values of the AC visit workflow. No server-only import: the public page and the store page load this in the browser too.

export const ENGINEER_STATUSES = ['resolved', 'not_resolved'] as const
export type EngineerStatus = (typeof ENGINEER_STATUSES)[number]

export const NOT_RESOLVED_REASONS = ['come_again', 'parts_po', 'parts_oem', 'other'] as const
export type NotResolvedReason = (typeof NOT_RESOLVED_REASONS)[number]

export const REASON_LABEL: Record<NotResolvedReason, string> = {
  come_again: 'Not resolved - the engineer will come again',
  parts_po: 'Not resolved - parts needed, Citykart must raise a PO',
  parts_oem: 'Not resolved - parts needed, the OEM bears the cost (no PO)',
  other: 'Not resolved - other reason',
}

export type VisitOutcome = 'pending_store' | 'resolved_both' | 'resolved_by_store' | 'resolved_auto' | 'disputed' | 'open' | 'void'

export const OUTCOME_LABEL: Record<VisitOutcome, string> = {
  pending_store: 'Waiting for the store to confirm',
  resolved_both: 'Resolved (engineer and store agree)',
  resolved_by_store: 'Resolved (the store confirmed)',
  resolved_auto: 'Resolved automatically (the store did not object)',
  disputed: 'Store says not resolved - the OEM was asked to send an engineer again',
  open: 'Not resolved - still open',
  void: 'Report marked wrong',
}

export type PoStatus = 'to_raise' | 'raised' | 'revisit_planned' | 'done'
export const PO_STATUS_LABEL: Record<PoStatus, string> = {
  to_raise: 'PO to raise',
  raised: 'PO raised',
  revisit_planned: 'Engineer revisit planned',
  done: 'Done',
}

export type Part = { name: string; qty: number }

export const MAX_FSR_FILES = 5
export const MAX_FSR_BYTES = 10 * 1024 * 1024
export const MAX_PARTS = 15

export const DEFAULT_AUTO_RESOLVE_HOURS = 48
export const DEFAULT_REMINDER_HOURS = 24

export const clip = (s: unknown, n: number) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n)
