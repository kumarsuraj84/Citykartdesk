// A Content-Security-Policy that only REPORTS (audit D-033). The browser tells the app what it would have blocked; nothing is blocked yet, so
// no page can break. The reports arrive at /api/csp-report and are kept in the System Log, so the policy can be tightened from what real
// pages actually load, instead of from a guess. Scripts still allow 'unsafe-inline' / 'unsafe-eval' because Next.js needs them without a
// per-request nonce; what the report mainly shows is any OTHER origin a page tries to load code, frames or connections from.

export function buildCspReportOnly(supabaseUrl?: string): string {
  let supabaseOrigin = ''
  try { if (supabaseUrl) supabaseOrigin = new URL(supabaseUrl).origin } catch { /* not a URL: leave it out */ }
  const self = "'self'"
  const connect = [self, supabaseOrigin, 'ws:', 'wss:'].filter(Boolean).join(' ')
  const images = [self, 'data:', 'blob:', 'https:', supabaseOrigin].filter(Boolean).join(' ')
  return [
    `default-src ${self}`,
    `script-src ${self} 'unsafe-inline' 'unsafe-eval'`,
    `style-src ${self} 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src ${self} data: https://fonts.gstatic.com`,
    `img-src ${images}`,
    `media-src ${[self, 'blob:', supabaseOrigin].filter(Boolean).join(' ')}`,
    `connect-src ${connect}`,
    `frame-src ${[self, supabaseOrigin].filter(Boolean).join(' ')}`,
    `frame-ancestors ${self}`,
    `object-src 'none'`,
    `base-uri ${self}`,
    `form-action ${self}`,
    'report-uri /api/csp-report',
  ].join('; ')
}
