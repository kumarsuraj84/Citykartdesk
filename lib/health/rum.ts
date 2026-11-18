// Real-user measurements (Health & Performance, phase 3): what a signed-in person's browser reports about speed and screen fit.
// Pure functions (no database, no browser), so the rules for what is accepted are tested. Nothing personal is ever accepted: no user id, name or e-mail, no query string,
// ids in the address are removed (/requests/<uuid> becomes /requests/:id), only numbers inside sensible limits.
import { normalizeRoute } from '@/lib/observability/request-timing'

export type ViewportClass = 'phone' | 'tablet' | 'laptop' | 'desktop'
export const VIEWPORT_LABEL: Record<ViewportClass, string> = { phone: 'Phone (under 640 px)', tablet: 'Tablet (640–1023 px)', laptop: 'Laptop (1024–1439 px)', desktop: 'Large screen (1440 px and over)' }

/** The screen-size group of a window width in CSS pixels. */
export function viewportClass(width: number): ViewportClass {
  if (width < 640) return 'phone'
  if (width < 1024) return 'tablet'
  if (width < 1440) return 'laptop'
  return 'desktop'
}

/** The 'Core Web Vitals' limits used to call a number poor (Google's published limits: largest paint 4 s, layout shift 0.25, interaction 500 ms). */
export const RUM_POOR = { lcpMs: 4000, cls: 0.25, inpMs: 500 } as const
/** Good limits (largest paint 2.5 s, layout shift 0.1, interaction 200 ms). */
export const RUM_GOOD = { lcpMs: 2500, cls: 0.1, inpMs: 200 } as const

export type RumRow = {
  kind: 'vitals' | 'layout'
  route: string
  viewport_w: number
  vclass: ViewportClass
  ttfb_ms: number | null
  load_ms: number | null
  lcp_ms: number | null
  cls: number | null
  inp_ms: number | null
  overflow_px: number | null
}

const int = (v: unknown, min: number, max: number): number | null => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  const n = Math.round(v)
  return n >= min && n <= max ? n : null
}

/** A report from a browser, cleaned: a row to store, or null when it is not a valid report (wrong shape, unknown screen, nothing measured). */
export function sanitizeRum(body: unknown): RumRow | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const kind = b.kind === 'vitals' || b.kind === 'layout' ? b.kind : null
  if (!kind) return null
  if (typeof b.route !== 'string' || !b.route.startsWith('/') || b.route.startsWith('/api')) return null
  const route = normalizeRoute(b.route)
  if (!route) return null
  const viewport_w = int(b.viewport_w, 200, 10_000)
  if (viewport_w === null) return null
  const cls = typeof b.cls === 'number' && Number.isFinite(b.cls) && b.cls >= 0 && b.cls <= 10 ? Math.round(b.cls * 1000) / 1000 : null
  const row: RumRow = {
    kind, route, viewport_w, vclass: viewportClass(viewport_w),
    ttfb_ms: int(b.ttfb_ms, 0, 120_000), load_ms: int(b.load_ms, 0, 120_000), lcp_ms: int(b.lcp_ms, 0, 120_000),
    cls, inp_ms: int(b.inp_ms, 0, 120_000), overflow_px: int(b.overflow_px, 0, 20_000),
  }
  if (kind === 'vitals' && row.lcp_ms === null && row.load_ms === null && row.ttfb_ms === null) return null   // nothing was measured
  if (kind === 'layout') {
    if (row.overflow_px === null) row.overflow_px = 0
    return { ...row, ttfb_ms: null, load_ms: null, lcp_ms: null, cls: null, inp_ms: null }
  }
  return { ...row, overflow_px: null }
}

/** good / needs improvement / poor for a largest-paint time. */
export function lcpRating(ms: number | null): 'good' | 'needs work' | 'poor' | null {
  if (ms === null) return null
  return ms <= RUM_GOOD.lcpMs ? 'good' : ms <= RUM_POOR.lcpMs ? 'needs work' : 'poor'
}
