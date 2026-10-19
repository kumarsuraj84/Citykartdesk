# 13 — Master Defect Register

*Consolidated from reports 04 (Security) and 11 (Code Quality), plus the live dynamic verification run (`audit-2026-10/evidence/db-dynamic-verification.json`). Every row cites its source finding ID so detail (evidence, exact file:line, exploit/repro) can be traced back to report 04 or 11 without duplicating it here. Status is tracked per row and updated as remediation (report 14) proceeds.*

**Severity key:** CRITICAL = immediate risk of unauthorized access, data loss or serious business disruption · HIGH = major security/integrity/workflow failure · MEDIUM = important functional/reliability/performance issue · LOW = minor issue or maintainability improvement.

## CRITICAL

| ID | Source | Module | Summary | Evidence | Status |
|---|---|---|---|---|---|
| D-001 | SEC-01/28 | Auth/proxy | `x-verified-user-id` header trusted without re-verifying the session on several proxy fast paths (static assets, public API allow-list, `/csat/*`, `/approve/*`) | CONFIRMED-BY-CODE (3 independent reviewers) | Open |
| D-002 | SEC-02 | DB | `owner_delete_org(uuid)` executable by `anon`/`authenticated`, no caller check, deletes a whole tenant | EXPLOITABLE (reproduced: throwaway org deleted end-to-end) | Open |
| D-003 | SEC-03 | DB | `profiles` self-update has no guard on `org_id`/`role`(admin case)/`is_active`/`manager_id`/`employee_id` | EXPLOITABLE (reproduced: tenant hop, role self-promotion, self-reactivation, field forgery — 4 separate repros) | Open |

## HIGH

| ID | Source | Module | Summary | Evidence | Status |
|---|---|---|---|---|---|
| D-004 | SEC-04 | Storage | Permissive `storage.objects` policy lets any authenticated user list/upload into any request's attachment folder | EXPLOITABLE (upload repro) | Open |
| D-005 | SEC-05 | RLS/design | No confidentiality tier for HR/Finance-style teams — any manager+ in the org sees every team's requests | CONFIRMED-BY-CODE | Open (design decision needed) |
| D-006 | SEC-06 | DB | Global config tables (`business_hours`, `holidays`, `sla_escalation_rules`, `task_statuses`, `task_priorities`, `request_priorities`, `app_settings`) have no `org_id`, writable by any org's admin/manager, anon-readable | EXPLOITABLE (3 repros: anon read, manager write, admin write) | Open |
| D-007 | SEC-07 | DB | `generate_request_no()` and `seed_default_sla_config()` are PUBLIC-executable SECURITY DEFINER functions | EXPLOITABLE (2 repros) | Open |
| D-008 | SEC-08 | DB/requests | `requests` insert/update RLS allows forged lifecycle fields (status, SLA due dates) and ticket-number overwrite | EXPLOITABLE (2 repros) | Open |
| D-009 | SEC-09 | Admin/users | `adminSetPassword`/`updateUserRole`/`toggleUserActive` lack target-role guard — admin can take over platform_owner | CONFIRMED-BY-CODE | Open |
| D-010 | SEC-10 | Admin/users | Deactivating a user (`is_active=false`) does not revoke access anywhere in the stack | CONFIRMED-BY-CODE (and reproduced via DB-09 context) | Open |
| D-011 | SEC-11/30 | Admin/users | Bulk-import default password `Welcome@123` hard-coded, enforcement of forced reset is UI-only | CONFIRMED-BY-CODE | Open |
| D-012 | SEC-12 | Reports | Scheduled reports let any manager export org-wide data to an unvalidated e-mail address | CONFIRMED-BY-CODE | Open |
| D-013 | SEC-13 | Admin actions | Several admin update actions spread client payload directly into service-role writes (mass assignment / cross-tenant move) | CONFIRMED-BY-CODE | Open |
| D-014 | SEC-14 | DB | `tasks_delete` RLS has no org predicate (only PostgREST's own "DELETE needs WHERE" rule currently protects it) | CONFIRMED-BY-CATALOG, partially tested | Open |
| D-015 | SEC-15 | RLS | Internal-note visibility checks "any team member" not "this ticket's team" | CONFIRMED-BY-CODE | Open |
| D-016 | SEC-16 | Approvals | `delegateApproval` mutates the shared workflow step definition instead of a per-approval copy | CONFIRMED-BY-CODE | Open |
| D-017 | SEC-29 | Auth | Rate limiting keyed on spoofable `X-Forwarded-For` — unlimited brute force if directly exposed, or shared-bucket lockout | CONFIRMED-BY-CODE | Open |
| D-018 | SEC-31 | Transport | Deployment appears to run over plain HTTP; cookies lack `Secure` | CONFIRMED-BY-CODE (config) | Open — production decision, not a code fix |
| D-019 | CQ-01 | Reporting | 5 offset-paging loops drop DB errors and silently truncate at 50k rows with no UI signal | CONFIRMED-BY-CODE | Open |
| D-020 | CQ-02 | Email | Inbound-reply dedupe row written after (and regardless of) comment-append success — can permanently lose a reply or double-post | CONFIRMED-BY-CODE | Open |
| D-021 | CQ-03 | Reporting | Approvals CSV export silently drops the "Decisions" column past ~300 rows (unbatched `.in()`, dropped error) | CONFIRMED-BY-CODE | Open |

## MEDIUM

| ID | Source | Summary | Status |
|---|---|---|---|
| D-022 | SEC-17 | Request-number sequence is global across tenants | Open |
| D-023 | SEC-18 | No DB-level status transition enforcement — app-code only | Open |
| D-024 | SEC-19 | RLS helper functions evaluate per-row, not per-statement (perf+scale) | Open — feeds report 08 |
| D-025 | SEC-20 | Push-subscription endpoint accepted with no host allow-list (blind SSRF via web-push) | Open |
| D-026 | SEC-21 | SMTP/IMAP host fields accept private/loopback addresses; blank password silently reuses old secret against new host | Open |
| D-027 | SEC-22 | `generateEmailBrief` (LLM relay) has no role gate | Open |
| D-028 | SEC-23 | Inbound email reply trusts `From:` header alone, no SPF/DKIM check | Open |
| D-029 | SEC-24 | Approval e-mail links never expire; signing secret shared with CSAT | Open |
| D-030 | SEC-25 | No separation of duties in approvals (self-approval possible) | Open |
| D-031 | SEC-26 | Unchecked foreign-id writes in several service-role actions | Open |
| D-032 | SEC-27 | Audit-log coverage gaps (role/activation/invite/org-structure/SLA changes not logged) | Open |
| D-033 | SEC-32 | No security response headers (CSP/X-Frame-Options/nosniff/Referrer-Policy/Permissions-Policy/HSTS) anywhere | Open |
| D-034 | SEC-33 | Open redirect in `/auth/callback` (`next` param unvalidated) | Open |
| D-035 | SEC-34 | `forgotPassword` has no per-email cooldown (mail-bomb vector) | Open |
| D-036 | SEC-35 | Password policy enforced client/app-side only; GoTrue itself allows weaker passwords | Open |
| D-037 | SEC-36 | Auth cookies not `Secure`, 400-day lifetime | Open |
| D-038 | SEC-37 | Docker image runs EOL Node 20 | Open |
| D-039 | SEC-38 | Global 30MB server-action body limit applies to unauthenticated actions | Open |
| D-040 | CQ-04/05 | Executive Dashboard / Report Builder ship up to 30k/20k full rows per view, uncached | Open — feeds report 08 |
| D-041 | CQ-06 | Home dashboard re-scans large datasets on every manager/admin page view, no caching | Open — feeds report 08 |
| D-042 | CQ-07/08 | Cron jobs (business-rules, alerts) dedupe-after-act — overlap can double-fire | Open |
| D-043 | CQ-09 | Shared fetch wrapper retries non-idempotent writes on connection errors | Open |
| D-044 | CQ-10..15 | Cluster of status-change / assignment race conditions (6 related findings) | Open |
| D-045 | CQ-16/17/18 | Intake approval conversion, submitForApproval, OEM routing: non-atomic multi-step writes | Open |
| D-046 | CQ-19..23 | Outbound integrations (email/push/WhatsApp/DeskTime/OAuth/IMAP) mostly lack timeouts; cron has no overlap lock | Open |
| D-047 | CQ-24..26 | More unbounded `.in()`/`.or()` calls and unpaged reads (same bug class as D-019) | Open |
| D-048 | CQ-27 | Admin "invite user" multi-step with no rollback on failure | Open |
| D-049 | CQ-28 | Business logic (status labels, SLA-breach math) duplicated 3-5× with confirmed drift | Open |
| D-050 | CQ-29 | Weak runtime validation at server-action boundary (209 `as unknown as`, `ignoreBuildErrors: true`) | Open |

## LOW / INFO
See report 04 "LOW/INFO" and report 11 "LOW/INFO" sections for the full itemized list (rate-limiter design, raw error leakage, hard-coded config literals, dead server actions, unenforced retention policy, logging hygiene, etc.) — not reproduced here to avoid duplication; each carries its own ID in the source report (SEC-* / CQ-*).

## Additional rows from the attachments/XSS review (SEC-D) and webhooks/tokens review (SEC-E)

| ID | Source | Module | Summary | Evidence | Status |
|---|---|---|---|---|---|
| D-051 | SEC-39 | Storage | Public storage proxy route validates only the bucket name, not path segments, before a service-role Storage call | NEEDS unit-test verification (not dynamically confirmed — see report 04 note) | Open — **verify before anything else** |
| D-052 | SEC-40 | Intake/storage | Inbound-email attachment filename (attacker-controlled) used raw in the storage key with `upsert:true` | CONFIRMED-BY-CODE | Open |
| D-053 | SEC-41 | Attachments | Download route trusts the stored `mime_type` column and serves inline with no `nosniff` | CONFIRMED-BY-CODE (compounds with D-004) | Open |
| D-054 | SEC-42 | Attachments | `storage_path` not validated against the row's own `request_id` | CONFIRMED-BY-CODE | Open |
| D-055 | SEC-45 | Attachments | Upload MIME/extension allow-lists duplicated ~5× and already drifted between copies | CONFIRMED-BY-CODE | Open |
| D-056 | SEC-46 | Admin | Audit Log CSV export bypasses the shared formula-injection-safe `toCSV()` helper | CONFIRMED-BY-CODE | Open |
| D-057 | SEC-48 | Email | Inbound reply sender-matching regex can mis-extract the address from a crafted `From:` display name | CONFIRMED-BY-CODE | Open |
| D-058 | SEC-49 | Intake/OAuth | OAuth state signing key falls back to an empty string when the env var is blank (not just unset) | CONFIRMED-BY-CODE | Open |
| D-059 | SEC-50 | Intake/OAuth | OAuth callback has no re-check of admin role, no session binding, state not single-use | CONFIRMED-BY-CODE | Open |
| D-060 | SEC-52 | Approvals | 6-digit approval code is deterministic/reusable within its window rather than random+single-use | CONFIRMED-BY-CODE | Open |
| D-061 | SEC-54 | WhatsApp | Webhook does DB/Vault/audit work before verifying HMAC signature (resource-exhaustion vector) | CONFIRMED-BY-CODE | Open |
| D-062 | SEC-55 | WhatsApp | Batched webhook payload resolves channel from first entry only — cross-tenant mis-routing risk if Meta ever batches multiple numbers | CONFIRMED-BY-CODE | Open |
| D-063 | SEC-56/57 | Cron/Email | Business-rules, CSAT-reminder, and reply-sync jobs use check-then-act (not claim-then-act) ordering — overlap can double-fire | CONFIRMED-BY-CODE (ties to D-042) | Open |

## Summary counts (final, all six reviews)
| Severity | Count |
|---|---|
| CRITICAL | 4 (one — D-051 — not yet dynamically confirmed, flagged for a unit test rather than a live repro) |
| HIGH | 24 |
| MEDIUM | 31 |
| LOW/INFO | ~45 (itemized in reports 04 & 11) |

## Open item carried forward
- `components/admin/RichEmailEditor.tsx`'s `dangerouslySetInnerHTML` of `previewHtml` — not independently confirmed sanitized by any reviewer; flagged, not yet verified either way.

*Next step per the audit plan (report 14): prioritize D-001 through D-021 (Critical/High), reproduce each where not already live-verified, write a regression test, implement the smallest safe fix, re-test, record before/after. Stop for explicit user approval before any destructive migration, RLS rewrite at scale, or change to `requests`/`profiles` table policies given how central they are.*
