// Single source of truth for the backlog-aging buckets, shared by the
// Analytics dashboard's "Backlog Aging" widget (lib/queries/analytics.ts +
// components/analytics/Charts.tsx's AgingBar) and the Report Builder's
// "Age Bucket" field (lib/reporting/field-registry.ts +
// lib/queries/reporting.ts) -- defined once here so the two surfaces can
// never drift out of sync with each other.

export interface AgeBucket {
  key: string
  label: string
  /** Inclusive upper bound in days; null means "no upper bound" (the last bucket). */
  maxDays: number | null
}

export const AGE_BUCKETS: AgeBucket[] = [
  { key: '0-5',    label: '0–5 days',    maxDays: 5 },
  { key: '6-10',   label: '6–10 days',   maxDays: 10 },
  { key: '11-20',  label: '11–20 days',  maxDays: 20 },
  { key: '21-30',  label: '21–30 days',  maxDays: 30 },
  { key: '31-45',  label: '31–45 days',  maxDays: 45 },
  { key: '46-60',  label: '46–60 days',  maxDays: 60 },
  { key: '61-75',  label: '61–75 days',  maxDays: 75 },
  { key: '76-90',  label: '76–90 days',  maxDays: 90 },
  { key: '90+',    label: '90+ days',    maxDays: null },
]

/** Which bucket a given age (in days) falls into. */
export function ageBucketFor(days: number): AgeBucket {
  for (const bucket of AGE_BUCKETS) {
    if (bucket.maxDays === null || days <= bucket.maxDays) return bucket
  }
  return AGE_BUCKETS[AGE_BUCKETS.length - 1]
}

/** Just the label, for the common case of stamping a report row/table cell. */
export function ageBucketLabel(days: number): string {
  return ageBucketFor(days).label
}
