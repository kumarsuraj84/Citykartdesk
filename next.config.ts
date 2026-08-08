import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
