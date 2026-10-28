# Citykart Desk — Live Configuration Snapshot

This directory documents what's actually configured and running on Citykart Desk (mirrors Main production's real business configuration into this repo), captured 2026-09-24, so another AI (or a new engineer) can understand the real, live setup without needing direct database access.

**How this was built:** by browsing the live app's own admin screens (normal UI navigation) and reading this repo's schema/migrations — not by bulk-exporting the database. An automated safety system in the session that built this correctly refused every attempt to script a bulk database export, including of non-sensitive tables, and outright blocked any attempt involving the user/employee table. That's a reasonable boundary: this repo may hold real business process detail, but it does not hold a raw dump of 527 employees' names, emails, and phone numbers. See `09-teams-and-users-structure.md` for what's included about users instead (role counts, team sizes, org structure — no individual records).

**No secrets are included anywhere in this directory** — the email-sending App Password, database credentials, and any API keys are configured but never displayed by the app itself, so they were never captured here either.

## Contents

| File | What it covers |
|---|---|
| `01-services.md` | The 14 services in the catalog, their teams, category counts, status |
| `02-categories-and-subcategories.md` | The full category/sub-category taxonomy requesters pick from — ~80 categories, several hundred sub-categories, across IT, HR, Admin, VM, BD, L&D, Legal, LP, PO Advice, Finance |
| `03-sla-policies.md` | All 14 SLA policies — response/resolution targets by priority tier, per service |
| `04-form-templates.md` | The 14 intake form templates (1:1 with services) and how the template builder works |
| `05-field-library.md` | The 37 reusable form fields and which templates use each |
| `06-business-rules.md` | All 38 auto-assignment rules — which technician handles which category, by service |
| `07-email-and-alert-configuration.md` | The real outbound email identity (`citykartdesk@citykartstores.com` via Gmail SMTP), alert rules, notification event matrix, data retention policy |
| `08-oems-and-stores.md` | The 11 AC-servicing OEM vendors (Blue Star/Daikin/Hitachi/LG) mapped to all 214 stores by region, plus a representative store sample with real addresses |
| `09-teams-and-users-structure.md` | 11 teams and their sizes; user base broken down by role (482 Requesters, 41 Technicians, 2 Managers, 0 Admins, 2 Platform Owners) and location — structural only, no individual PII |
| `10-approval-flows.md` | Finding: no formal approval workflow templates exist yet — every approval so far has been ad-hoc, created per-request |

## Known gaps / honesty notes

- **Categories** (`02`) and **Stores** (`08`) were captured via live page reads, not exhaustive pagination — Categories appears complete (no truncation seen at capture time) but should be spot-checked against the live `/admin/categories` page before being treated as 100% authoritative; Stores is an explicit ~20% sample (46 of 214) with the full count and OEM-region pattern documented, not every row.
- **Form Templates** (`04`) documents the *pattern* via one worked example (Admin Repair) rather than opening all 14 templates' field layouts individually — the Field Library (`05`) gives the full field-to-template mapping either way.
- **Approval Flows** (`10`) found essentially nothing configured (by design, not a capture gap) — worth knowing going in rather than assuming a gap in the documentation.
- This snapshot reflects Local's database, which mirrors Main's real business configuration (services, SLA, templates, categories, teams, OEMs, stores) as of when that mirror was last refreshed earlier in this project's history — not a live, continuously-synced copy. Treat it as "accurate as of a recent snapshot," not "always current," and re-verify against the live app for anything operationally critical.
