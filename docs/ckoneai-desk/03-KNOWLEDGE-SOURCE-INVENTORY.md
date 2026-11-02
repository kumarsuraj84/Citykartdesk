# 03. Knowledge source inventory

Status: LOCAL, 2 Nov 2026. Full tables (every file with date, audience and class) are in `evidence/inv-C-knowledge-sources.md`; this sheet keeps the conclusions.

## Update 2 Nov 2026

The owner (Ankur) approved the **first 8 help articles** the same day (docs/knowledge-base-drafts/, version 1, review by 2 Feb 2027). They are not in the Knowledge Base table yet and have not been given to the assistant: how-to answers start in phase 2, with another go. The statement below describes the position before this approval.

## The short answer

**There is no approved knowledge today.** The in-app Knowledge Base is empty and no document carries an approval marker. So an assistant cannot truthfully answer "how do I ..." questions from approved material yet, and the plan is: refuse politely now, approve a first set of articles, then answer with citations.

## 1. The in-app Knowledge Base

- Tables `kb_articles` (title, Markdown content, status draft / published / archived, author, view and "helpful" counters) and `kb_article_services`. **0 articles** in the local database (the 15 Oct plans say 0 on live too; not re-checked, because production must not be touched).
- It has **no audience / visibility field, no version history, no reviewer or approval trail, no language field**, no screen for requesters, and nothing uses its search index or its service link.
- It is **not** in the read-only data API, so neither the data platform nor CKOneAI can read it.
- Admin-only editing at `/admin/knowledge-base`.

Gaps to close before the assistant may cite it: an audience field (requester / technician / manager / admin), an approval marker with approver and date, a version number, a language, a requester-facing reader (the "Open in CKDesk" link target), and an export of **published, approved** articles only.

## 2. Documents in the repository (248 `.md` files)

| Class | Meaning | Examples | May the assistant use it? |
|---|---|---|---|
| Approved and publishable | explicit approval marker | **none** | would be yes |
| Candidate (after owner review) | plain-language admin how-to | SYSTEM-LOG, AC-PMS, PROGRAM-PMS, TICKET-AUTOMATION-RERUN, SCHEDULED-REPORTS, OEM-BY-TYPE-GUIDE, STORE-CVM-AND-CATEGORY-FIELDS-GUIDE, SHEET-MASTERS-GUIDE, AC-CALENDAR | not yet; admin audience only; several still say "LOCAL ONLY" |
| Internal operational | accurate, engineering audience | CKDESK-ARCHITECTURE-FEATURES-AND-TEST-GUIDE (best single source of "how X works") | not for general users; may be split into a safe feature-explanation subset |
| Restricted | server names, secrets handling, security findings, real-data warnings | PRODUCTION-INFRASTRUCTURE-AND-MIGRATION, HTTPS-AND-CSP-PLAN, GO-LIVE runbooks, AUDIT / VAPT reports, the data API sheet | **never indexed** for users |
| Draft | plans and designs | the bot plans, vendor programs design, intake designs | no |
| Outdated | retired server (16 files mention 10.0.1.12), old architecture, point-in-time reports | ARCHITECTURE, DATABASE, LIVE-VS-LOCAL | no |

## 3. In-app help text

Only the hard-coded admin help at `/admin/runbooks` (8 sections, 31 topics, partly outdated) and a few banners (reopen window, approval-rejected reopen, CSAT). **No FAQ, no onboarding, no requester help page.**

## 4. Live configuration that answers "what does the catalogue say"

Local copy: 16 published services, 111 categories, 615 sub-categories, 16 form templates, 16 SLA policies (live: 17 services, 112 categories). `services.keywords` is empty everywhere and nothing reads it. Global search matches records only (tickets, tasks, projects, services, people, approvals), not documents.

## 5. Existing "bot" pieces (not reused as a knowledge source)

The WhatsApp / conversation engine has exact-word commands and sub-category name scoring, no intent model. The only LLM calls in the product are an e-mail summary in the intake inbox (nothing stored) and an e-mail classifier in the separate `api` worker. The two older plans (`CKDESK-BOT-RAG-PLAN`, `CKDESK-BOT-COMBINED-PLAN`) are **partly superseded** by `CKDESK-BOT-VIA-CKONEAI.md` (where the bot runs and how numbers are answered); their knowledge side (articles, service suggestion, ticket draft) is still open and is the subject of this pack.

## 6. What a first approved set should contain (proposal for the owner)

1. What CKDesk is and who it is for.  2. Raise a ticket (Services page, mandatory fields, attachment rules).  3. Check status and the 9 status meanings.  4. Reply to a technician; "Waiting on User" and "Hold due to Purchase from HO".  5. Reopen (who, window, reason).  6. Feedback / CSAT.  7. SLA in plain words (paused statuses, business hours as configured).  8. Approvals in plain words.  9. Vendor / OEM ticket basics (for staff).  10. AC PMS in plain words.

Each needs: an owner, an approval date, an audience, a version, a language and a review date. A clearly labelled **synthetic** set of these ten, for local testing only, is in `evidence/fixtures/synthetic-kb/`. It must never be promoted to production knowledge.
