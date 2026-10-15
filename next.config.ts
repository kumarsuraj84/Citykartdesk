import type { NextConfig } from "next";
import { buildCspReportOnly } from "./lib/http/csp";

// One stamp per production build, set ONCE by scripts/windows/build-for-deploy.ps1 (reading the clock here would
// give each of Next's build processes a different value). Every open page compares it with the server's
// current one (/api/version) to tell people when to refresh after a deployment. "dev" = local development.
const BUILD_ID = process.env.CK_BUILD_ID || 'dev'

const nextConfig: NextConfig = {
  // Do not announce the framework in every response header (VAPT, information leak)
  poweredByHeader: false,
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  generateBuildId: async () => BUILD_ID,
  // Emits a self-contained .next/standalone server (only the node_modules it
  // actually needs) — the Dockerfile copies just that output, not the full
  // repo + node_modules, into the runtime image. See docs/RAILWAY-DEPLOYMENT.md.
  output: 'standalone',
  // imapflow pulls in pino for logging. pino is already on Next's default
  // server-external list, but imapflow itself isn't — a *bundled* importer
  // (imapflow) reaching into an *externalized* dependency (pino) is exactly
  // where Turbopack's standalone output breaks: the compiled chunk ends up
  // requiring a hashed alias (e.g. "pino-28069d5257187539") that has no
  // corresponding file anywhere in the standalone bundle, even though the
  // real "pino" folder is right there — a 500 on every route sharing that
  // server chunk, not just the one that imports imapflow. Marking the whole
  // chain external makes it use plain Node require() instead, which resolves
  // by the real package name and just works.
  serverExternalPackages: ['imapflow', 'mailparser', 'pino', 'pdfkit'],
  // The ticket PDF reads its fonts from disk at run time, which the build cannot see on its own, so the standalone
  // output is told to ship them with that route.
  outputFileTracingIncludes: {
    '/api/requests/\\[id\\]/pdf': ['./assets/fonts/**/*'],
  },
  // Deploy builds for Main (built locally on this same machine, with Main's env, while
  // the dev server may still be running against its own `.next/dev` cache — see
  // scripts/windows/build-for-deploy.ps1) go to a SEPARATE directory. Sharing `.next`
  // between a live dev server and a one-off production build corrupts the dev server's
  // Turbopack cache mid-build ("Compaction failed: Another write batch or compaction is
  // already active"), taking Local down every time Main gets deployed.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // The floating route-info badge is dev-only UI (never ships to production) and
  // doesn't affect render performance — off because it visually collided with the
  // sidebar's own bottom-left user avatar.
  devIndicators: false,
  turbopack: {
    root: __dirname,
  },
  experimental: {
    // Next's own default cap on a Server Action's request body is 1 MB — far
    // below the 25 MB this app's own uploadAttachment()/task-attachments.ts
    // already validate against. Below this cap, Next itself rejects the
    // request with a 413 before the action ever runs, which is exactly what
    // broke a real requester's ticket submission: the ticket record saved
    // fine (that's a small, separate action), then the follow-up attachment
    // upload 413'd and crashed the page. 30mb leaves headroom over the 25mb
    // file cap for multipart overhead and the request's other form fields.
    serverActions: {
      bodySizeLimit: '30mb',
    },
    // With proxy.ts in front, Next buffers a request body up to 10 MB by default and silently cuts it there; keep it equal to the Server Action limit
    // so a 10-25 MB attachment arrives whole (VAPT observation, see 02-VAPT/04-MANUAL-PENETRATION-TESTING.md).
    proxyClientMaxBodySize: '30mb',
    // Cache dynamic RSC payloads in the client router cache so back/forward and quick
    // re-navigation are instant (SPA-feel) instead of re-fetching from the server every
    // time (dynamic default is 0s). Mutations still bust the cache via revalidatePath in
    // the server actions, so own-changes stay fresh; cross-user staleness is bounded to 30s.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
    // Off: this dev-only cache stores fetch() responses (including Supabase's internal
    // REST calls) across HMR reloads, overriding even `no-store`, and only partially
    // clears on full reload — causes stale/inconsistent data after schema or RLS changes
    // during local dev. No effect on production.
    serverComponentsHmrCache: false,
  },
  // Basic browser protections on every response (audit D-033). The site's own pages may frame its own attachment previews
  // (SAMEORIGIN); nothing else may frame it. A Content-Security-Policy and HSTS are deliberately NOT set here: a policy needs a
  // page-by-page test, and HSTS only makes sense once the site is served over HTTPS (audit D-018, a deployment decision). Meanwhile a
  // policy that only REPORTS is sent: it blocks nothing, and what the browsers would have blocked is kept in the System Log.
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        // only when the site really is served over https (a browser ignores it on http, and it must never be sent before https works)
        ...((process.env.NEXT_PUBLIC_APP_URL ?? '').startsWith('https') ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }] : []),
        { key: 'Content-Security-Policy-Report-Only', value: buildCspReportOnly(process.env.NEXT_PUBLIC_SUPABASE_URL) },
      ],
    }]
  },
  // Type errors fail the production build (D-050): `npm run typecheck` is clean, so nothing is skipped any more. (The tables added by
  // later migrations are in types/database.ts, which is maintained by hand.)
  // Note: the top-level `eslint` config key was removed in Next 16 (ESLint no longer runs
  // during `next build`); lint is run separately via `npm run lint`.
};

export default nextConfig;
