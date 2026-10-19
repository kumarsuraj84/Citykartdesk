# Citykart Desk — Local Deployment Candidate

**Current Local HEAD:** `bb14e14` ("Poll for inbound email replies every 1 minute instead of 10")

## Pre-existing working-tree changes (before this audit began)

Built and partly tested earlier in this same session, **not yet finalized by the user** — this is the "Saved Reports" feature plus a few Report Builder fixes:

- `components/reports/PivotBuilder.tsx` — Saved Reports UI (save/load/update/delete a named field+filter+date-range configuration), relative date-preset tracking so a saved "Today"/"Last 7 days" stays fresh on reload, grid-overflow CSS fix (`minmax(0,1fr)`).
- `lib/actions/reporting.ts` — `listSavedReports`/`createSavedReport`/`updateSavedReport`/`deleteSavedReport` server actions.
- `lib/reporting/pivot-engine.ts` — `SavedReportConfig`/`DatePreset` types.
- `lib/reporting/field-registry.ts` — Time-of-day companion fields (Created Time, First Responded Time, Resolved Time, etc.), Description-column label-collision fix.
- `lib/queries/reporting.ts` — Time-of-day values in report rows, Description-value-duplication fix (excludes library-linked textareas from the native-column fallback).
- `types/database.ts`, `types/index.ts` — `saved_reports` table types.
- `supabase/migrations/20240101000146_saved_reports.sql` — new table, RLS policies, **and the explicit `GRANT SELECT, INSERT, UPDATE, DELETE ON saved_reports TO authenticated` / `GRANT ALL ... TO service_role`** (a real bug was caught here: RLS policies alone don't work without the base table-level grant — first save attempt failed with a generic "Failed to save the report" until this was added).

**Status:** already functionally verified by the user directly against Local (reports "test1" and "test2" saved and updated successfully, per the dev server's own request log). Not yet explicitly finalized/approved as "done" by the user, per their own instruction to build it, let them review, and not push until finalized.

## New changes from this audit

- `components/admin/CategoryIcon.tsx` — broken-image SSR-hydration-race fallback fix (DESK-LUI-001).
- Local database only (no file/migration involved): cleared 14 `services.icon_image_url` values referencing nonexistent Storage files (DESK-LQA-001) — **this is a Local-only data correction, has no equivalent needed on Main** (Main's real services have real, matching Storage files).
- `lib/reporting/pivot-engine.ts` — pre-existing null-byte corruption removed (DESK-CODE-001) — unrelated to the Saved Reports feature living in the same file, bundled in the same diff since it's the same file.
- `tsconfig.json` — reverted an accidental auto-appended entry from a throwaway audit-only build (net effect: **no real diff** versus `HEAD`, see below).

## Migrations

One new migration, **applied to Local only**, **not yet applied to Main**:

- `20240101000146_saved_reports.sql` — creates `saved_reports` table with RLS + grants. Self-contained, no dependency on any other pending migration. Straightforward to apply to Main via the same `psql`-through-SSH recipe used for migration 145 earlier this session, whenever the Saved Reports feature itself is approved for deployment.

## Environment changes

None. No `.env.local` changes, no new environment variables introduced.

## Test Results

- `npx tsc --noEmit`: 0 errors
- `npm run lint`: 0 errors, 3 pre-existing warnings (unrelated files)
- `npx vitest run`: 870 passed / 1 failed (pre-existing, unrelated, documented) / 23 skipped
- `npm run build` (plain Turbopack build, isolated `NEXT_DIST_DIR` to avoid touching the live dev cache): succeeded, all routes compiled

## Visual Coverage

See `CITYKART-DESK-ROUTE-AND-LAYOUT-COVERAGE.md` for the full matrix. Summary: 28 of 50 routes opened live and measured for overflow at 1440px (all clean), 8 of those also at 768px/390px (all clean). Two real defects found and fixed. Holiday Calendar regression re-tested, did not reproduce.

## Known Risks

1. **Saved Reports feature itself is not yet finalized by the user** — do not deploy it until they explicitly approve it (their own stated condition).
2. **Coverage gap**: the majority of `[id]`-parameterized detail pages, most tablet/mobile breakpoints, and most of the catalogued overlays were not individually opened this session (see the coverage doc's "Untested / Blocked" section). None are known-broken — they're simply unaudited, not verified-safe.
3. **Pre-existing test flake** (`stage6-channel-readiness.test.ts`) — unrelated to anything here, but worth a separate look before it masks a real regression in that module later.
4. **The `services.icon_image_url` NULL-out is Local-only** — if Local's config gets re-mirrored from Main again in the future, this same gap (Storage files not copied) will silently reappear for any service Main has an icon set for. Worth remembering next time a Main→Local config mirror happens, or worth also mirroring the Storage bucket contents at that time.

## Recommended Git Commits

Given the pre-existing (Saved Reports) and audit-found (CategoryIcon/pivot-engine/tsconfig) changes touch overlapping files, recommend splitting into two commits when the user approves pushing:

1. **Saved Reports feature** (once explicitly finalized by the user): `PivotBuilder.tsx`, `lib/actions/reporting.ts`, `lib/reporting/field-registry.ts` (Time fields + Description fix), `lib/queries/reporting.ts`, `types/database.ts`, `types/index.ts`, the new migration. Note this commit will *also* carry the incidental pivot-engine.ts null-byte fix and the grid-overflow fix, since they're small and in the same functional area — not worth further splitting.
2. **CategoryIcon fix + Local data cleanup**: `components/admin/CategoryIcon.tsx` alone (the data cleanup itself is not a file change — it was a direct database update, already applied to Local, nothing to commit for it).

`tsconfig.json` has no real diff versus `HEAD` and needs no commit at all.

## Main Migration Requirement

One migration (`20240101000146_saved_reports.sql`) needs to be applied to Main **only if/when** the Saved Reports feature is approved and deployed — using the same recipe as migration 145 (SSH to `10.0.1.12`, `psql` with `-Encoding ascii` to avoid the BOM issue hit earlier this session).

## Main Restart Requirement

Standard deploy-and-swap (Webpack build, per the fix from earlier today) — no special restart beyond the normal `CitykartApp` service swap.

## Rollback Considerations

Standard: the existing swap script pattern already renames the previous `standalone` build aside before swapping in a new one, so rollback is a simple rename-back if anything goes wrong post-deploy — same pattern used successfully multiple times already today.

# AWAITING USER APPROVAL TO PUSH TO GIT / DEPLOY MAIN
