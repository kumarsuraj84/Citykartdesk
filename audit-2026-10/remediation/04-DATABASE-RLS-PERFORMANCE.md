# 04 — Database / Row-Level-Security Performance

*Isolated audit stack only. Row security was **never disabled or weakened**: every measurement is made as a real signed-in user with the policy active. These are measurements of the disposable local stack on the dev PC; **they are not a claim about production throughput.***

## 1. Findings addressed

| ID | Audit finding | Result |
|---|---|---|
| **D-064** (High) | A manager's / administrator's org-wide ticket list and count are O(table size) under row security: 5.6 s at 100k tickets, 28 s at 500k, failing the 8 s database limit | **Fixed** — Implemented · Tested · Verified |
| **D-065** (High) | A technician's exact count was ~1,600–2,700× slower with the policy than without it (767 ms vs 0.47 ms at 100k; 4,074 ms vs 1.5 ms at 500k) | **Fixed** — now 4.6 ms at 100k and 25 ms at 500k |
| **D-066** (High) | A few expensive queries saturate the database and starve everyone else | **Mitigated** — the expensive query became cheap, and the load results no longer show the starvation (section 6) |
| **D-024** (Medium) | RLS helper functions evaluate per row, not per statement | **Fixed** for the ticket rules (the table that mattered); other tables' rules use the same pattern but were not a measured bottleneck |
| **D-067** (Medium) | Suggested fixes: evaluate helpers once per query, add an `(org_id, updated_at desc)` index, replace exact counts with estimated/capped counts or a summary table | First two **done**; the third (estimated counts / summary table) is **Deferred** — not needed to meet the targets, and it changes what the screens show |

## 2. Cause

The ticket "select" rule called its helper functions (who am I, which teams, which role, who reports to me, am I a collaborator, am I an approver) **once for every ticket row**, before the page limit could apply. PostgreSQL could therefore not use an index and had to read, and run six functions on, every row to answer "latest 25".

## 3. The change (migration `20240101000158_post_audit_rls_performance.sql`)

* The ticket **select** and **update** rules call each helper through `(SELECT fn())`, so PostgreSQL evaluates it **once per query** and can then use the indexes.
* Two **set-based helpers** return "the tickets I collaborate on" and "the tickets I am a named approver of" as an id list, replacing a per-row function call with a comparison against a short list (`id = ANY(list)`).
* A helper `request_identity_unchanged(...)` (`SECURITY DEFINER`) replaces the update rule's sub-selects on the tickets table (see the regression below).
* Index `idx_requests_org_updated (org_id, updated_at DESC)` for the manager "latest first" list.
* **The rule says exactly what it said before** — same people, same tickets. Only how often the answers are looked up changed.
* Rollback: `supabase/rollback/20240101000158_rollback.sql` restores the previous rules and drops the helpers and the index (executed for real on the disposable database during this work and the migration re-applied).

### A regression I introduced and fixed (recorded in full)

The first version made the ticket select rule contain sub-selects. The ticket **update** rule still compared the new row with the stored row by reading the tickets table in sub-selects. PostgreSQL rejects that combination (`42P17 infinite recursion detected in policy for relation "requests"`), so **every status change and assignment failed** — 22 integration tests failed. It was caught by running the full integration suite after the migration, root-caused, and fixed with the `SECURITY DEFINER` helper (same answer, no self-reference), with a new regression test (`tests/remediation/71-requests-update-identity.test.ts`). Details in document 05.

## 4. Proof that who sees which ticket did not change

| Test | What it proves | Result |
|---|---|---|
| `tests/remediation/70-rls-equivalence.test.ts` | For **nine kinds of user** (three requesters, three technicians, two managers, one administrator), the tickets returned through the API (row security on, as the app's own client) are compared with an **independent calculation in SQL from the written rules** (own tickets, own team, manager/admin/platform-owner, collaborator, named approver, tickets of people who report to the user, tickets assigned to people who report to the user, all within the user's organization). On the 3,000-ticket database every visible id is compared; on the 500,000-ticket database the **exact count** and the **first and last 1,000 ids** are compared. A further test proves the comparison is not vacuous: the collaborator rule, the approver rule and the reports-to rule are each actually exercised, and an unrelated requester sees neither | **10 / 10 pass** before the change, after the first version, and after the final version; also at 500,000 tickets |
| `tests/remediation/72-rls-cross-tenant.test.ts` | With a real second organization: an administrator of organization B sees only organization B tickets; a requester of B sees only their own; organization A's manager, administrator and requester cannot see B's ticket directly or by search; exact counts do not leak (B: 1; A: more than 1); B's administrator cannot change or delete an A ticket and cannot move their own ticket into A | **6 / 6 pass** at 500,000 tickets, and in the final regression |
| `tests/remediation/71-requests-update-identity.test.ts` | An ordinary update by a technician or manager works; changing the requester, service or team is refused; a requester cannot update the ticket | 7 / 7 pass |

## 5. Query plans as a real user (EXPLAIN ANALYZE, row security on)

| Query | 100k before | 100k after* | 500k before | **500k after (final)** |
|---|---|---|---|---|
| Manager: latest 25 tickets, org-wide | 5,110 ms | 1.4 ms | 27,885 ms | **1.3 ms** |
| Manager: exact count | 5,111 ms | 19 ms | 28,180 ms | **80 ms** |
| Technician: queue (team filter, open statuses, by due) | 1.95 ms | 0.59 ms | 2.27 ms | **0.63 ms** |
| Technician: exact count | 740 ms | 4.6 ms | 4,074 ms | **25 ms** |
| (reference) technician count as the server, row security bypassed | 1.8 ms | 0.8 ms | 1.5 ms | 1.4 ms |

Plain requester, unfiltered exact count, 500,000 tickets: about **7 s → 92 ms** (this case is what led to the set-based helpers; it is not a query the app makes — "My Requests" always filters by requester).

\* The 100,000-ticket "after" numbers were measured on the first version of the migration; the 500,000-ticket numbers on the final version. The equivalence and cross-tenant tests pass on both.

## 6. Load results (virtual users with 1 s think time, 30 s per level, a mix of requester / technician / manager queries, each as a real logged-in synthetic user)

| Scenario | Users | Error rate | P50 | P95 | P99 |
|---|---|---|---|---|---|
| **100k tickets — before** | 50 | 1.6 % | 25 ms | 3,091 ms | 8,019 ms |
| | 200 | 1.0 % | 1,188 ms | 5,792 ms | 8,040 ms |
| **100k tickets — after** | 50 | 0 % | 6.2 ms | 31 ms | 40 ms |
| | 200 | 0 % | 5.5 ms | 139 ms | 221 ms |
| | 500 | 4.9 %† | 4.8 ms | 235 ms | 390 ms |
| **500k tickets — before (audit)** | 50 | 8.5 % | 2,782 ms | 11,325 ms | 14,653 ms |
| | 200 | 27.0 % | 6,496 ms | 12,083 ms | 15,338 ms |
| **500k tickets — after (final)** | 50 | 0 % | 8.8 ms | 71.5 ms | 112.8 ms |
| | 200 | 0 % | 5.0 ms | 144.9 ms | 172.7 ms |
| | 500 | 5.6 %† | 5.2 ms | 290 ms | 388 ms |
| Burst of 200 simultaneous requests, 100k | before / after | 1.5 % → 0 % | wall 9,258 → 162 ms | P95 2,768 → 156 ms | |
| Burst of 200 simultaneous requests, 500k | before / after | 4 % → 0 % | wall 15,296 → 218–362 ms | P95 8,274 → 207–280 ms | |

† The errors at 500 users are **client-side connection errors** (status "-1") from the test rig's gateway (the local Supabase stack's Kong runs with 512 worker connections), not database timeouts: database CPU, connection counts and lock waits stayed flat (`dbConnsPeak` 22, `lockWaitsPeak` 0). They are recorded, not hidden, and are a limit of the local test rig, not a measurement of production.

Notes on method and caveats:
* "Before" for 100k was **re-measured** in this remediation (and matches the audit's own run); "before" for 500k is the audit's run on 501,451 tickets with the same harness; that run stopped at 200 users. The 1,000-user and 1,000-burst levels were not repeated.
* The maximum latency per level is ~2.5–3 s for the first requests of each level (cold connections); this was observed, not explained further.
* The load mix and harness are in `audit-2026-10/tests/perf-load.mjs`; raw results in `audit-2026-10/evidence/perf-*.json` and `evidence/remediation/perf-r*.json`; plans in `evidence/remediation/explain-*.txt` and `evidence/explain-500k.txt`.

## 7. Related defect found while load-testing at scale (new D-069)

Ticket numbers are built with `LPAD(n, 6, '0')`, which **truncates**. Once the counter passed 999,999, numbers 1,000,000 and 1,000,001 both became `CKSD-100000`, the unique rule rejected the second, and no ticket could be created. It surfaced when seeding 500,000 tickets after earlier seeding had already moved the counter to ~601,000. **Fixed** in migration `…159_ticket_number_overflow.sql` (numbers up to 999,999 look exactly as before, larger ones are written in full; existing tickets and the counter untouched); regression test `tests/remediation/80-ticket-number-overflow.test.ts` fails before (duplicate key) and passes after; rollback provided. Production is nowhere near this limit (a few hundred tickets), but a duplicate-number failure would have blocked all ticket creation.

## 8. Production notes (for a later, separately authorized release)

1. Run migration 158 then restart `CkDeskPostgrest` on the app server (schema cache) — the standing procedure. The index build is instant at production size; on a very large table build it with `CREATE INDEX CONCURRENTLY`.
2. The migration is tightening-neutral (same visibility). The equivalence test should be re-run against a **copy** of the production schema before deployment, never against production.
3. Rollback: `supabase/rollback/20240101000158_rollback.sql`.

## 9. Remaining performance work (not done here)

* Executive Dashboard / Report Builder read up to 30k/20k full rows per view with no caching (D-040), and the Home dashboard re-scans large datasets on each manager/admin page view (D-041): **Deferred** — they need a caching/summary-table design and approval for what may be slightly stale.
* Exact counts are still O(matching rows); at 500,000 tickets they cost 25–80 ms, which is fine, but estimated counts would be needed well beyond that.
* Other tables' row-security rules (comments, approvals, attachments) use the same per-row helper pattern. They were not measured as a bottleneck; revisit if a screen on those tables slows at scale.
