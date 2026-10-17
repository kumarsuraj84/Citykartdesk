# 08 — SOC 2 readiness update (draft — NOT an attestation)

LOCAL ONLY. **No SOC 2 report, attestation or "compliance" is claimed.** A SOC 2 Type I or Type II report can only be issued by an independent CPA firm. This file records what the final remediation changed against the 2026-10-15 readiness work in `../04-SOC2/` and keeps the same five evidence states as `07-ISO27001-READINESS.md` (code implemented · locally tested · designed only · organisational evidence missing · approval pending / operating evidence unavailable).

Proposed scope (unchanged, needs management approval — D-12): Security (CC1–CC9) and Confidentiality (C1); Availability only if Citykart states a commitment; Processing Integrity and Privacy out for now.

## Type I (design at a date) — what moved

The 2026-10-15 result was: 0 criteria suitably designed, 33 design gaps, 5 not verified (38 assessed). The final remediation closes **technical** design gaps; whole criteria still cannot be called suitably designed because each also needs a policy, a record or an owner that only the organisation can supply.

| Criterion area | Technical design element now present and locally tested | Still missing (organisational) |
|---|---|---|
| CC6.1 logical access | Server-only writes; row-level security + column grants + guard triggers; multi-organisation isolation across every organisation-scoped table (v29); owner-controlled permission matrix; DB-enforced forced password change | access-review record (T-1), owner naming, HTTPS (D-1) |
| CC6.2 / CC6.3 provisioning and removal | invitation or random one-time password, inactive profile = signed out, password change ends other sessions | joiner/mover/leaver procedure and evidence |
| CC6.6 boundary protection | request limits, shared rate limits, replay protection on webhooks, SSRF host checks, Gmail signed-token option | HTTPS, firewall rules evidence, proxy hop setting in production |
| CC6.7 data in transit/removal | mail worker TLS verified | public HTTP remains |
| CC6.8 malicious software | macro refusal, quotas, scanner connector | **no scanner running** (D-10) |
| CC7.1 vulnerability detection | dependency audit 0 (release branch), Semgrep/Gitleaks/OSV/Nuclei run locally | scan cadence owner, ZAP not run, vulnerability log (T-4) |
| CC7.2 – CC7.4 monitoring and incidents | hash-chained System Log; chain verified after concurrent appends; exports, name changes and policy switches audited | alerting on the log, log review evidence, incident record (T-3) |
| CC8.1 change management | tested rollbacks, rehearsal, release order proof, release plan | change approvals (T-5) |
| A1.2 / A1.3 backup and recovery (only if Availability is in scope) | rollback + restore procedure written | backup/restore test (T-2), recovery objectives |
| C1.1 / C1.2 confidentiality | internal-note and attachment hiding, people-list scoping, export limits, mail HTML cleaning | HR/Finance confidentiality tier (D-9), retention and disposal decision |

## Type II (operation over a period) — status

Not started in any meaningful sense. A Type II period needs the controls above to **operate and leave evidence for 3–12 months**. The preparation available now: the evidence calendar and test plan in `../04-SOC2/SOC2-EVIDENCE-COLLECTION-CALENDAR.md` and `SOC2-OPERATING-EFFECTIVENESS-TEST-PLAN.md`, and the five templates in `07-ISO27001-READINESS.md` (access review, backup restore, incident, vulnerability log, change approval), each of which maps to a SOC 2 evidence request. Operating evidence available today: **none** (state 5).

## Exceptions to carry into a Type I description

1. Public HTTP (VAPT-002) — compensating control proposal: VPN-only access until HTTPS.
2. No malware scanning of uploads (VAPT-065).
3. Production still on framework 16.2.9 and without the remediation until the release is approved.
4. Six management decisions at defaults (see `09-…`).
5. Change approval rests on one person's "explicit OK" with no second reviewer or change record, and server administration uses one key on one admin PC (from `../01-BASELINE/04-CONTROL-EVIDENCE-INVENTORY.md`) — segregation of duties is not demonstrable.

## Honest summary

Design gaps that are **technical** are largely closed and locally tested. Design gaps that are **organisational** (policy approval, owners, access review, backup restore test, incident exercise, vendor management) are untouched because they cannot be produced by software. A Type I engagement would be premature until at least: owners named, policies approved, HTTPS and scanner decisions made, one backup-restore test done, and the five templates have been used once.
