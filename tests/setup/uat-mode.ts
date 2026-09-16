// Shared opt-in gates for tests that are NOT self-contained core regression.
//
// RUN_PRODUCTION_CATALOG_UAT gates tests that exercise real, currently-live
// Citykart production catalog config (a specific "IT Support" / "HR Support"
// service, sub-category, or team by hardcoded ID) rather than fixtures the
// test creates itself. A clean-slate database has none of that config, so
// these tests cannot pass there and must not run by default in `npm test` —
// they are Production Configuration Acceptance Tests, opt-in only.
//
// PRESERVE_UAT_FIXTURES controls whether an UAT-style test's own fixtures
// (personas, conversations, requests, WhatsApp channels) are torn down in
// afterAll. Default is to self-clean like every other test in this suite;
// set it to 'true' only for a deliberate evidence-gathering run whose
// output a human still needs to inspect in the database afterward.
export const RUN_PRODUCTION_CATALOG_UAT = process.env.RUN_PRODUCTION_CATALOG_UAT === 'true'
export const PRESERVE_UAT_FIXTURES = process.env.PRESERVE_UAT_FIXTURES === 'true'

export const PRODUCTION_CATALOG_UAT_SKIP_REASON =
  'Production catalog UAT skipped — real IT/HR/Finance/Legal Support services are not configured in this clean-slate environment. Set RUN_PRODUCTION_CATALOG_UAT=true to run against a real production catalog.'

/** A fresh, unique tag for this run — used even when PRESERVE_UAT_FIXTURES is
 *  set, so repeated evidence-gathering runs never collide with each other. */
export function newUatRunTag(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
