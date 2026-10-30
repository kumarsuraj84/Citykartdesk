// What the running server knows about its own build. The build id is stamped once by scripts/windows/build-for-deploy.ps1 as
// <yyyyMMdd-HHmmss>-<short commit>[-dirty] (see next.config.ts); a local development run has no stamp ("dev").
// /api/version and /api/health show it, so "which commit is live?" can be answered from the outside.

export type BuildInfo = { buildId: string; commit?: string }

export function parseBuildId(raw: string | undefined | null): BuildInfo {
  const buildId = raw && raw.trim() ? raw.trim() : 'dev'
  const m = /^\d{8}-\d{6}-([0-9a-f]{7,40})(-dirty)?$/.exec(buildId)
  return m ? { buildId, commit: m[1] } : { buildId }
}

/** The build of this running server. NEXT_PUBLIC_BUILD_ID is written into the code at build time (npm_package_version is not set in the standalone server). */
export const currentBuild = (): BuildInfo => parseBuildId(process.env.NEXT_PUBLIC_BUILD_ID)
