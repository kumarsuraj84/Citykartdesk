# 10 — Updated Defect Register

*Original register: `audit-2026-10/reports/13-MASTER-DEFECT-REGISTER.md` and Part 14 of the full audit report. Severity and numbering are the audit's; two new defects found during this work are D-068 and D-069. "Fixed" means implemented **and** tested **and** verified on the isolated audit stack; nothing here is deployed.*

**Status legend:** **Fixed** · **Fixed (partial)** — part done, the rest stated · **Fixed (defensive)** — closed without a live exploit to reproduce · **Open** — not addressed in this pass · **Requires user approval** · **Deferred** — reason given · **Blocked** — cannot be exercised in isolation · **Not itemized** — Low/Info items the audit did not number.

## Counts (by register ID)

| Severity | Total | Fixed | Fixed (partial) | Open / Deferred / Needs approval |
|---|---|---|---|---|
| **Critical** | 4 | **4** (D-001, D-002, D-003, D-051) | 0 | 0 |
| **High** | 27 (the audit's 24 + the three performance findings D-064 to D-066 added in Part 14) | **22** | 0 | **5**: D-005 and D-011 need approval; D-018 is a production decision; D-040 and D-041 are deferred |
| **Medium** | 38 (the register's rows, incl. D-067 and the new D-068 and D-069) | **14** | **4** (D-033, D-046, D-061, D-067) | **20** |
| **Low / Info** | ≈ 45 (the audit did not number them) | not itemized | | |

The audit's headline said 31 Medium; its register table lists 35 Medium rows (and D-067, D-068, D-069 are additional). This report counts by register ID so every number can be traced. The Medium "Fixed" figure counts D-024, D-025, D-027, D-034, D-035, D-042, D-043, D-054, D-056, D-059, D-062, D-063, D-068 and D-069.

## Critical

| ID | Summary | Status | Evidence |
|---|---|---|---|
| D-001 | Forged "who is the user" header trusted on proxy fast paths | **Fixed** (confirmed by code and by a proxy-level unit test, not by a live attack) | doc 02 |
| D-002 | `owner_delete_org()` callable by anyone | **Fixed** | doc 02 |
| D-003 | Profile self-update (tenant hop, role self-promotion) | **Fixed** | doc 02 |
| D-051 | Public file route validated only the bucket | **Fixed (defensive)** — component-level confirmation only | doc 02 |

## High

| ID | Summary | Status | Evidence |
|---|---|---|---|
| D-004 | Storage policy lets anyone write into any request's folder | **Fixed** | doc 03 |
| D-005 | No confidentiality tier for HR/Finance-style teams | **Requires user approval** (design) | doc 03 |
| D-006 | Global config tables anon-readable and writable by any org's manager/admin | **Fixed** | doc 03 |
| D-007 | Internal helper functions callable by anyone | **Fixed** | doc 02 |
| D-008 | Ticket lifecycle / SLA / number forgeable through the API | **Fixed** | doc 03 |
| D-009 | Admin can take over a platform owner (no target-role guard) | **Fixed** | doc 03 |
| D-010 | Deactivating a user does not revoke access | **Fixed** | doc 03 |
| D-011 | Bulk-import default password hard-coded; forced reset UI-only | **Requires user approval** | doc 03 |
| D-012 | Scheduled reports can export org-wide data to any address | **Fixed** (managers can no longer schedule reports — behaviour change) | doc 03 |
| D-013 | Admin updates spread client payload into service-role writes | **Fixed** (the update actions named in the audit) | doc 03 |
| D-014 | `tasks_delete` rule has no org predicate | **Fixed (defensive)** — not separately exploitable through the API | doc 03 |
| D-015 | Internal notes visible to any team member | **Fixed** | doc 03 |
| D-016 | Delegating one approval rewrites the shared workflow | **Fixed** | doc 03 |
| D-017 | Rate limiting keyed on spoofable `X-Forwarded-For` | **Fixed** (deployment choice: `TRUSTED_PROXY_HOPS`) | doc 03 |
| D-018 | Plain HTTP / cookies not `Secure` | **Deferred** — production deployment decision (TLS first) | doc 03 |
| D-019 | Reporting loops drop errors and truncate silently | **Fixed** | doc 03 |
| D-020 | Inbound-reply dedupe written after, and regardless of, success | **Fixed** (logic-level test; live mailbox Blocked) | doc 03 |
| D-021 | Approvals CSV drops the Decisions column past ~300 rows | **Fixed** | doc 03 |
| D-040 | Smart Dashboard / Report Builder ship up to 30k/20k rows, uncached | **Deferred** — needs a caching design | doc 04 |
| D-041 | Home dashboard re-scans large data every view, uncached | **Deferred** — same | doc 04 |
| D-052 | Inbound e-mail attachment name used raw in storage key | **Fixed** (logic-level; live mailbox Blocked) | doc 03 |
| D-053 | Download route trusts stored `mime_type`, no `nosniff` | **Fixed** | doc 03 |
| D-057 | Reply sender matching fooled by crafted display name | **Fixed** | doc 03 |
| D-058 | OAuth state key falls back to empty string | **Fixed** | doc 03 |
| D-064 | Manager org-wide list/count O(table) under RLS (5.6 s at 100k, 28 s at 500k) | **Fixed** (28 s → 1.3 ms) | doc 04 |
| D-065 | Technician exact counts ~2,000× slower with RLS | **Fixed** (4,074 ms → 25 ms at 500k) | doc 04 |
| D-066 | A few expensive queries starve everyone | **Fixed (mitigated)** — load results no longer show starvation | doc 04 |

## Medium

| ID | Summary | Status | Evidence |
|---|---|---|---|
| D-022 | Request-number sequence is global across tenants | Open | — |
| D-023 | No database-level status-transition enforcement | Open | — |
| D-024 | RLS helpers evaluate per row | **Fixed** (ticket rules) | doc 04 |
| D-025 | Push-subscription endpoint has no allow-list (blind SSRF) | **Fixed** (public https hosts only) | `tests/unit/push-endpoint.test.ts` |
| D-026 | SMTP/IMAP host fields accept private addresses; blank password reuses old secret | Open | — |
| D-027 | `generateEmailBrief` (LLM relay) has no role gate | **Fixed** (reviewer roles only) | `lib/actions/intake/brief.ts` |
| D-028 | Inbound reply trusts `From:` alone, no SPF/DKIM | Open | — |
| D-029 | Approval e-mail links never expire; secret shared with CSAT | Open | — |
| D-030 | No separation of duties in approvals (self-approval) | Open — policy decision | — |
| D-031 | Unchecked foreign-id writes in several service-role actions | Open | — |
| D-032 | Audit-log coverage gaps | Open — see the queued audit-trail build, doc 11 | — |
| D-033 | No security response headers | **Fixed (partial)** — nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy, Permissions-Policy added and verified live; **CSP and HSTS not added** (a CSP needs a page-by-page test; HSTS needs HTTPS, D-018) | `next.config.ts` |
| D-034 | Open redirect in `/auth/callback` | **Fixed** (live-verified with five hostile values) | `tests/unit/safe-next.test.ts` |
| D-035 | `forgotPassword` has no per-address cooldown | **Fixed** (3 per hour per address, with D-017) | doc 03 |
| D-036 | Password policy enforced app-side only | Open (authentication-service setting) | — |
| D-037 | Auth cookies not `Secure`, 400-day lifetime | Open (tied to D-018) | — |
| D-038 | Docker image runs end-of-life Node 20 | Open | — |
| D-039 | 30 MB server-action limit applies to unauthenticated actions | Open | — |
| D-042 | Cron jobs dedupe after acting (business rules, alerts) | **Fixed** for the business-rules job (claim before act; before: ran twice per ticket under two overlapping runs, after: once). The alerts job was not changed | `tests/remediation/91-reliability.test.ts` |
| D-043 | Shared fetch wrapper retries non-idempotent writes | **Fixed** (writes are re-sent only when the server provably never got them) | `tests/unit/resilient-fetch-retry.test.ts` |
| D-044 | Cluster of status/assignment race conditions | Open — concurrent status change and concurrent assignment were tested and left one consistent result; the six individual races were not separately reproduced | doc 08 |
| D-045 | Non-atomic multi-step writes (intake conversion, submitForApproval, OEM routing) | Open | — |
| D-046 | Outbound integrations lack time limits; cron has no overlap lock | **Fixed (partial)** — 20 s limit (120 s for mailbox polls) added to the outbound calls listed in the audit; no distributed overlap lock | `lib/http/fetch-timeout.ts` |
| D-047 | More unbounded `.in()` / unpaged reads | Open | — |
| D-048 | Invite user is multi-step with no rollback | Open | — |
| D-049 | Business logic duplicated 3–5× with drift | Open | — |
| D-050 | Weak runtime validation; `ignoreBuildErrors: true` | Open | — |
| D-054 | `storage_path` not validated against the row's request | **Fixed** | doc 03 |
| D-055 | Upload allow-lists duplicated ~5× and drifted | Open | — |
| D-056 | Audit-log CSV bypasses the safe CSV writer | **Fixed** | `AuditLogClient.tsx` |
| D-059 | OAuth callback: no admin re-check, no session binding | **Fixed** (role re-checked; state bound to the starting user; single-use not added — the provider's code is single-use) | `tests/unit/oauth-state.test.ts` |
| D-060 | Approval 6-digit code deterministic and reusable | Open | — |
| D-061 | WhatsApp webhook does DB/Vault/audit work before verifying the signature | **Fixed (partial)** — body cap, per-caller rate limit, throttled audit rows; the lookup still precedes verification because the secret is per channel (unavoidable) and unknown/wrongly-signed requests are still recognised and audited, as the existing tests require | `tests/unit/whatsapp-webhook-hardening.test.ts` |
| D-062 | Batched webhook payload resolves channel from the first entry only | **Fixed** (mixed phone numbers refused) | same |
| D-063 | CSAT reminder / reply sync / business rules act-then-record | **Fixed** (CSAT reminder and business rules claim before act; reply sync by D-020) | doc 03, 08 |
| D-067 | Perf: helpers once per query, index, estimated counts | **Fixed (partial)** — first two done; estimated counts / summary table deferred | doc 04 |
| **D-068** (new) | Soft-deleting an attachment always failed (row security rejects the update) | **Fixed** | doc 03 |
| **D-069** (new) | Ticket numbers repeat after 999,999 (`LPAD` truncates), blocking all ticket creation | **Fixed** (migration 159) | doc 04 |

## Low / Info

About 45 items listed in audit reports 04 and 11 (rate-limiter design, raw error leakage, hard-coded literals, dead server actions, unenforced retention policy, logging hygiene…). **Not itemized and not addressed in this pass.** One carried-forward question remains: the rich-text e-mail template preview (`dangerouslySetInnerHTML`) was not independently confirmed sanitized.

## Defects found by the UI / UAT / reliability work (not in the audit register)

| ID | Description | Status |
|---|---|---|
| UAT-1 | Sign-in dropped the page the person asked for | Fixed |
| UAT-2 / UI-1 | Header overflowed at 375 px, hiding the notification/approval/theme/avatar icons | Fixed |
| UAT-3 / UI-2..5 | Unlabeled search and comment boxes, 20 px search target, empty-state contrast 3.34:1 | Fixed |
| UI-6..9 | Muted small text at 4.46:1; small targets; heading skips; message overlap | Open — need a design decision (doc 07) |
| REL-1 | With the API layer down a screen hangs about 165 s before the error screen (the 20 s client timeout is retried on each of several calls) | **Open** — recommendation in doc 08 |
| REL-2 | A stage7b WhatsApp audit-logging test failed once at baseline and never again | Open — intermittent, root cause not isolated (doc 05) |

## Items that cannot be tested in isolation (Blocked)

Real WhatsApp (Meta), Gmail/Graph/IMAP mailboxes, SMTP delivery, DeskTime and OEM provider calls; the 18 production-catalog integration tests (need the production catalog); a TLS / HTTPS test (the audit stack is HTTP on loopback).
