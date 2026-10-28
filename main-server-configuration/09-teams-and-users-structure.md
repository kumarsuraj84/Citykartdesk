# Teams & Users — Structural Summary (no raw personal data)

Source: `/admin/teams` and `/admin/users` (role filter counts), captured 2026-09-24.

**Deliberately excluded:** individual user records (names, emails, mobile numbers). This session's own safety system blocked every attempt to bulk-export the user table, and on reflection that's the right call for what's about to be a git-tracked file — 527 real employees' contact details don't belong in a repo. What's below is the *shape* of the user base instead: role counts, team assignments, and org structure, which is what another AI actually needs to reason about how the app's RBAC and assignment logic behaves.

## Users by role (527 total)
| Role | Count | % |
|---|---|---|
| Requester | 482 | 91.5% |
| Technician (agent) | 41 | 7.8% |
| Manager | 2 | 0.4% |
| Admin | 0 | 0% |
| Platform Owner | 2 | 0.4% |

Note: 0 users currently hold the plain `admin` role — the org is run day-to-day by 2 Platform Owners (who have full admin rights plus cross-org access) and 2 Managers. This is a very top-heavy, requester-dominated user base, consistent with an ITSM tool where the overwhelming majority of accounts only ever submit tickets.

## Users by location (from `08-oems-and-stores.md`)
- HEAD OFFICE: 308 users
- STORES: 214 users
(308 + 214 = 522; the remaining ~5 of 527 likely have no location assigned.)

## Teams (11 total) — who fulfills each service
| Team | Members | Services covered |
|---|---|---|
| IT Group | 8 | 1 (IT) |
| ADMIN GROUP | 6 | 3 (Admin-AC, Admin Repair, Admin Requirements) |
| HR GROUP | 3 | 1 (HR) |
| VM GROUP | 3 | 1 (VM) |
| FINANCE GROUP | 2 | 2 (Finance, Finance-Vendor Creation) |
| LEGAL GROUP | 1 | 1 (Legal) |
| BD Group | 0 | 1 (BD) |
| L&D Group | 0 | 1 (L&D) |
| LP GROUP | 0 | 1 (LP) |
| PO GM GROUP | 0 | 1 (PO Advice GM) |
| PO APPS GROUP | 0 | 1 (PO Advice Apps) |

Several teams show 0 formal members despite having active technicians routing tickets via Business Rules (`06-business-rules.md` — e.g. BD has Mukesh, L&D has Juhi, LP has Jawed Alam) — meaning ticket routing in this org relies more on the per-category assignment rules than on Team membership for several departments. IT and Admin (the two highest-category-count services, 75 and 112+16+183 respectively) have the largest formal teams, which tracks.

**For another AI studying this repo:** the actual RBAC role hierarchy (`user` → `agent` → `manager` → `admin` → `platform_owner`) and what each role can/can't do is implemented via `current_user_role()` (a Postgres function, `supabase/migrations/20240101000000_initial_schema.sql`) checked in both RLS policies (defense in depth) and app-level `getCurrentProfile().role` checks throughout `app/(app)/**/page.tsx` and `lib/actions/**/*.ts`. Search for `isAgentOrAboveRole`, `isManager`, `isAdmin` in `app/(app)/layout.tsx` for the canonical role-tier booleans used across the nav and page gates.
