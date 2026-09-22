import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
  serverExternalPackages: ['imapflow', 'mailparser', 'pino'],
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
  typescript: {
    // Tables added in migrations after types were generated — safe to skip
    ignoreBuildErrors: true,
  },
  // Note: the top-level `eslint` config key was removed in Next 16 (ESLint no longer runs
  // during `next build`); lint is run separately via `npm run lint`.
};

export default nextConfig;
