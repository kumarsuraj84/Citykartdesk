// Remediation tests may run ONLY against the disposable audit stack (API port 554xx, started by audit-2026-10/guard/run.ps1).
// They refuse to run against the developer stack (which holds production-derived data) or anything else, so a plain `npx vitest` can never
// make them touch the wrong database.
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
let port = ''
try { port = new URL(url).port } catch { /* handled below */ }
if (process.env.AUDIT_MODE !== '1' || !/^554\d\d$/.test(port) || !/^(127\.0\.0\.1|localhost)$/.test(new URL(url).hostname)) {
  throw new Error(
    `[audit-only] refusing to run: remediation tests need the isolated audit stack (AUDIT_MODE=1 and a 554xx loopback API). ` +
    `Got AUDIT_MODE=${process.env.AUDIT_MODE ?? '(unset)'} and SUPABASE_URL=${url || '(unset)'}. Start them with: ` +
    `powershell -File audit-2026-10\guard\run.ps1 npx vitest run --config vitest.remediation.config.ts`,
  )
}
if (!process.env.NODE_OPTIONS?.includes('egress-guard.cjs')) {
  throw new Error('[audit-only] refusing to run: the egress guard is not preloaded (NODE_OPTIONS). Use audit-2026-10\guard\run.ps1.')
}
