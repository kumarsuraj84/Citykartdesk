# Inventory C: knowledge sources for an "Ask CK Desk" assistant

Prepared 2026-11-02, read-only. Repo: `D:\ANKUR AI PROJECTS\CitykartDesk-ZOHO Alternate` (branch `main`, HEAD `96bf6be`, working tree has uncommitted CKOneAI work).
Method: source reading plus read-only GET calls to the LOCAL Supabase REST API (`127.0.0.1:54321`). Only counts and column names were printed; no names, emails or ticket text were read or are recorded here. No production server was touched. No file other than this one was written.

Conventions: "mtime" = file-system modified time; "git" = date of last commit touching the file. Many files share mtime 2026-09-18 and git 2026-09-14 because they were committed/copied in bulk; treat those dates as "not later than", not as authoring dates. Anything not verified is marked UNVERIFIED.

---

## 0. Headline findings

1. The in-app Knowledge Base is real but EMPTY (0 articles, 0 article-service links in the local DB). It has no requester-facing screen, no visibility field and no version history.
2. There is no formal approval marker on any Markdown document, so no document can honestly be called "Approved and publishable" today. About 9 admin guides are good candidates once the owner reviews them (section 2.4).
3. The only existing user-facing help text is (a) the hard-coded admin help at `/admin/runbooks` (8 sections, 31 topics, partly generic or outdated) and (b) a handful of inline banners (reopen window, approval-rejected reopen, CSAT).
4. Global search indexes live records (tickets, tasks, projects, services, people, approvals). It does NOT index the Knowledge Base, runbooks or any document.
5. Existing "bot" logic is deterministic only: the WhatsApp/conversation engine (exact-word commands, sub-category name scoring) and the "Catch me up" ticket summary. No RAG, no embeddings, no vector store.
6. The only LLM calls in the product: (a) per-click email summary in the intake inbox (Groq, `llama-3.3-70b-versatile`, nothing stored); (b) the separate `api` worker's email classifier (same OpenAI-compatible endpoint, results stored in `intake_classifications`, empty locally).
7. `CKDESK-BOT-VIA-CKONEAI.md` (2026-11-02) replaces the "where the bot lives and how it answers numbers" part of the two older plans. The knowledge side (articles, service suggestion, ticket creation) is explicitly left as a later decision.
8. Local data (433 tickets, 231 stores, 599 profiles) is a copy of real company data. Test fixtures must be derived, not exported (see section 5).

---

## 1. Knowledge Base (in-app)

### 1.1 What exists

| Item | Finding | Evidence |
|---|---|---|
| Tables | `kb_articles`, `kb_article_services` (article-to-service link) | `supabase/migrations/20240101000038_enterprise_expansion.sql` lines 85-156 |
| Enum | `kb_article_status` = `draft`, `published`, `archived` | same file |
| Article columns | id, org_id, title, slug (unique per org), content (Markdown text), status, author_id, view_count, helpful_yes, helpful_no, created_at, updated_at | `types/database.ts` (kb_articles Row) |
| Search index | GIN full-text index on `title || content` (English). Created but NOT used by any app code | migration line 105; no query uses it |
| Visibility / audience field | NONE. Only `status`. No requester/technician/manager audience label, no store or service scoping on the article itself | column list above |
| Versions / history | NONE. `updated_at` only; edits overwrite `content`. No version table, no approval, no reviewer, no publish date, no language column | column list above |
| Author | `author_id` FK to `profiles` (set at creation, never changed on edit) | `lib/actions/knowledge-base.ts` |
| Service link | `kb_article_services` exists, rights set to none for `authenticated` by migration 171. No UI or code uses it (the file header says "surface from service detail" but nothing does) | migration 171 line 39; grep shows no other reference |
| Row-level rules | SELECT: same org AND (`published` OR role manager/admin/platform_owner). INSERT/UPDATE: manager/admin/platform_owner. DELETE: admin/platform_owner (but `authenticated` only has INSERT/UPDATE grants, so delete is effectively service-role only) | migration lines 109-130; migration 171 line 40 |
| Server actions | `createKbArticle`, `getKbArticleContent`, `updateKbArticle`, `archiveKbArticle`; all require manager, admin or platform_owner | `lib/actions/knowledge-base.ts` |
| Admin UI route | `/admin/knowledge-base` (page + `KnowledgeBaseClient.tsx`): list with status badge, views, helpful up/down counts; create/edit form with Markdown textarea, status select (Draft/Published) | `app/(app)/admin/knowledge-base/` |
| Menu entry | Sidebar > System > "Knowledge Base" (visible to roles that see the System group) | `components/layout/Sidebar.tsx` line 179 |
| Requester-facing view | NONE. No `/kb`, `/help` or article page for requesters. `view_count` and `helpful_yes/no` have no code that increments them | grep over `app/`, `lib/`, `components/` |
| Data API | `kb_articles` is NOT among the 16 entities in `lib/data-api/entities.ts`, so the data platform and CKOneAI cannot read articles through it | `lib/data-api/entities.ts` |
| Test coverage | Feature F132 "Knowledge Base" is NOT TESTED in the QA run | `qa-release-candidate-2026-10/02-155-FEATURE-TEST-COVERAGE.md` |
| Related: Runbooks | `/admin/runbooks` is a separate, hard-coded help screen (see 3.1); it is not stored in `kb_articles` | `app/(app)/admin/runbooks/` |

Gaps to close before an assistant could cite KB articles (facts only): no audience/visibility, no reviewer/approval trail, no version history, no service/sub-category tag in use, no requester screen, no language field, nothing feeds search.

### 1.2 LOCAL DB counts (counts only)

| Measure | Count |
|---|---|
| `kb_articles` total | 0 |
| status = draft | 0 |
| status = published | 0 |
| status = archived | 0 |
| by visibility | not applicable (no visibility column) |
| `kb_article_services` rows | 0 |

The Knowledge Base is EMPTY locally. The 2026-10-15 plans state the same for production (0 articles); not re-verified today because production must not be touched (UNVERIFIED for today's production).

---

## 2. Markdown documents (root and `docs/`)

Totals: 248 `.md` files in the repo outside `node_modules`/`.next` (241 tracked by git). Root: 46 files. `docs/`: 61 files plus 2 in `docs/superpowers/specs/`. Other folders are listed in 2.3.

Classification key:
- **Approved** = carries an explicit approval marker for publication. NONE found.
- **Internal** = internal operational or engineering material, accurate enough to read, not meant for end users.
- **Restricted** = contains infrastructure/server names, secrets handling, security findings or real-data warnings. Must not be indexed for general users.
- **Draft** = proposal, plan or "for approval/not built" document.
- **Outdated** = describes the retired server `10.0.1.12`, a dropped module, or a superseded plan, or is an old point-in-time report.
- **Unverified** = not read in full; class inferred from header and keyword scan.
- "CAND" = candidate for "Approved" after owner review (plain-language, admin-audience how-to).

"Mentions 10.0.1.12" counts occurrences of the retired server address (keyword scan, whole file).

### 2.1 `docs/` (61 Markdown files plus 2 specs)

| File | Title / purpose | Audience | mtime | git | Class | Notes |
|---|---|---|---|---|---|---|
| CKDESK-ARCHITECTURE-FEATURES-AND-TEST-GUIDE.md | Architecture, features, workflows and test guide (v 2026-10-26; sections: roles, data model, ticket lifecycle, admin set-up, feature workflows, scheduled jobs, test scenarios, feature inventory, QA errata) | Testers, AI models, developers | 2026-10-27 | 2026-10-29 | Internal (best single source of "how does X work"); partly Restricted | Section 0/3 point to local test credentials file and say local data is a copy of real company data. Contains an errata section; 0 hits for 10.0.1.12. Best candidate to split into a safe feature-explanation subset. |
| CKDESK-BOT-RAG-PLAN.md | CK Desk Bot (RAG) plan, 2026-10-15 | Owner | 2026-10-15 | 2026-10-19 | Draft (partly superseded) | See section 4.5 |
| CKDESK-BOT-COMBINED-PLAN.md | Combined bot plan v2, 2026-10-15 | Owner | 2026-10-15 | 2026-10-19 | Draft (partly superseded) | See section 4.5 |
| CKDESK-BOT-VIA-CKONEAI.md | Ask CK Desk via CKOneAI, 2026-11-02 | Owner, developers | 2026-11-02 | 2026-11-02 (modified, uncommitted) | Draft/current design | Names 10.0.0.82, 10.0.1.98; Restricted for general users |
| CKDESK-DATA-API.md | Read-only data API for the DBA / data platform | Owner, DBA | 2026-11-02 | 2026-11-02 (modified, uncommitted) | Restricted | Token handling, server addresses, entity list |
| PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md | Production infrastructure, deploy and migration runbook; says old server 10.0.1.12 is retired | Owner, ops | 2026-10-31 | 2026-10-30 | Restricted | 4 mentions of 10.0.1.12 are the "retired" warning, not stale instructions |
| HTTPS-AND-CSP-PLAN.md | HTTPS, headers, task accounts, "must do on live" checks | Owner, ops | 2026-10-31 | 2026-10-30 | Restricted | Security findings, server names |
| GO-LIVE-RUNBOOK-2026-10.md | Go-live runbook for sheet masters, vendor module, PMS, approval history, calendar | Owner, ops | 2026-10-27 | 2026-10-29 | Restricted | Deploy steps, server names; 1 mention of 10.0.1.12 (warning) |
| GO-LIVE-AC-RO-SENSOMATIC.md | Go-live plan AC, RO, Sensomatic together | Owner | 2026-10-31 | 2026-10-31 | Draft | "LOCAL PLAN ONLY" |
| LIVE-CONFIGURATION-VENDOR-PROGRAMS.md | Live configuration after the Vendor Programs release | Owner, admin | 2026-10-29 | 2026-10-29 | Restricted | Mentions production servers |
| LIVE-CUTOVER-AC.md | Moving AC mail to the AC Vendor Program | Owner, admin | 2026-10-31 | 2026-10-31 | Draft | "LOCAL" |
| LIVE-VS-LOCAL-COMPARISON-2026-10-22.md | Live vs local, read-only check | Owner | 2026-10-22 | 2026-10-22 | Outdated + Restricted | Point-in-time; server names |
| LIVE-VS-LOCAL-COMPARISON-2026-10-23.md | Live vs local since 20 Sep | Owner | 2026-10-23 | 2026-10-23 | Outdated + Restricted | Point-in-time; server names |
| LOCAL-FEATURES-AND-PUSH-PLAN.md | Order local features go to main | Owner | 2026-10-22 | 2026-10-22 | Outdated | Superseded by RELEASE-2026-10 list |
| RELEASE-2026-10-COMPLETE-CHANGE-LIST.md | Everything local and not on main | Owner | 2026-10-27 | 2026-10-27 | Internal (point-in-time) | Likely partly released since; UNVERIFIED |
| MORNING-WALKTHROUGH.md | Walkthrough of local features (search in category, linked filters, etc.) | Owner | 2026-10-31 | 2026-10-31 | Internal, point-in-time | Describes branch state of 31 Oct |
| POST-AUDIT-BATCH-2.md | Post-audit batch 2: what changed and how to release | Owner, developers | 2026-10-14 | 2026-10-14 | Internal | Server names |
| SYSTEM-LOG.md | System Log (audit trail and error capture), `/admin/logs` | Admin | 2026-10-14 | 2026-10-14 | Internal, CAND (admin) | Plain language |
| AC-CALENDAR.md | Ticket Calendar in the Smart Dashboard | Managers, admin | 2026-10-23 | 2026-10-23 | Internal, CAND | Header says "built locally, not pushed" (may be released; UNVERIFIED) |
| AC-PMS.md | AC PMS (preventive maintenance) tickets, set-up for admin | Admin | 2026-10-31 | 2026-10-30 | Internal, CAND | "LOCAL ONLY until released" in file; release status UNVERIFIED |
| PROGRAM-PMS.md | PMS tickets per Vendor Program | Admin | 2026-10-31 | 2026-10-30 | Internal, CAND | Same note |
| TICKET-AUTOMATION-RERUN.md | "Run automation again", auto retry, Stuck tickets | Admin, technicians | 2026-10-31 | 2026-10-30 | Internal, CAND | Same note |
| SCHEDULED-REPORTS.md | Scheduled reports that send themselves | Admin | 2026-10-31 | 2026-10-31 | Internal, CAND | Same note |
| OEM-BY-TYPE-GUIDE.md | OEMs by type (AC and Genset), set-up | Admin | 2026-10-19 | 2026-10-19 | Internal, CAND | Says "LOCAL BUILD, NOT RELEASED"; later released (memory notes, 2026-10-19 and 10-31); wording stale |
| STORE-CVM-AND-CATEGORY-FIELDS-GUIDE.md | Store CVM (approver) and category-limited Qty field | Admin | 2026-10-19 | 2026-10-19 | Internal, CAND | Same note |
| SHEET-MASTERS-GUIDE.md | AC / Genset / CVM Google Sheets as masters, sync times | Admin | 2026-10-19 | 2026-10-19 | Internal, CAND | Mentions go-live checklist, sheet names |
| VENDOR-PROGRAMS-DESIGN.md | Vendor Programs design | Owner, developers | 2026-10-29 | 2026-10-29 | Draft/design | |
| VENDOR-TECHNICIAN-DESIGN.md | Vendor technician (OEM engineer login) design | Owner, developers | 2026-10-23 | 2026-10-23 | Draft/design | "built locally, not pushed" at time of writing |
| VENDOR-EMAIL-MAP.md | Who gets which vendor e-mail and when | Admin | 2026-10-23 | 2026-10-23 | Internal | Contains mail-flow wording, possibly addresses; UNVERIFIED |
| CITYKART-DESK-FULL-APPLICATION-DESIGN.md | Full application design (build blueprint, 103 KB) | Developers | 2026-10-22 | 2026-10-22 | Internal; Unverified accuracy | 56 secret-keyword hits (config descriptions) |
| ARCHITECTURE.md | Architecture reference | Developers | 2026-09-18 | 2026-08-11 | Outdated | Pre-migration, Vercel/Supabase-cloud era; UNVERIFIED line by line |
| DATABASE.md | Database reference | Developers | 2026-09-18 | 2026-08-08 | Outdated | Predates migrations 38+ and later (195 migrations exist) |
| INTAKE-INTELLIGENCE-BLUEPRINT.md | Intake intelligence architecture blueprint ("for approval") | Developers | 2026-09-18 | 2026-08-08 | Draft/Outdated | Mentions the old repo name |
| INTAKE-PHASE-C-DESIGN.md | Intake classification layer design ("for approval") | Developers | 2026-09-18 | 2026-08-08 | Draft | |
| INTAKE-CLASSIFICATION-REDESIGN.md | Signal hierarchy, catalog-bound taxonomy | Developers | 2026-09-18 | 2026-08-08 | Draft | |
| INTAKE-EFFICIENCY-PROPOSAL.md | Triage efficiency proposal | Developers | 2026-09-18 | 2026-08-08 | Draft | |
| AUDIT-2026-08-08.md | Full codebase audit | Developers | 2026-09-18 | 2026-08-08 | Outdated + Restricted | Security findings |
| SYSTEM-AUDIT-2026-09-09.md | System audit and knowledge-transfer report (203 KB) | Developers | 2026-09-18 | 2026-09-14 | Outdated + Restricted | Security findings; 41 secret-keyword hits |
| UAT-REPORT-2026-09-10.md | Autonomous UAT report | QA | 2026-09-18 | 2026-09-14 | Outdated | Point-in-time test result |
| CITYKART-DESK-COMPLETE-TEST-REPORT-2026-09-10.md | Complete test report | QA | 2026-09-18 | 2026-09-14 | Outdated | |
| CITYKART-DESK-DESIGN-TESTING-REPORT-2026-09-10.md | Design/UX testing report | QA | 2026-09-18 | 2026-09-14 | Outdated | |
| CITYKART-DESK-UI-QA-REPORT-2026-09-10.md | Visual UI QA report | QA | 2026-09-18 | 2026-09-14 | Outdated | |
| CITYKART-DESK-REMEDIATION-AND-REUAT-REPORT-2026-09-10.md | Remediation and re-UAT | QA | 2026-09-18 | 2026-09-14 | Outdated | |
| D-03-SECURITY-VALIDATION-REPORT-2026-09-10.md | Security validation (D-03) | Security | 2026-09-18 | 2026-09-14 | Outdated + Restricted | |
| DESK-UAT-001-FIX-REPORT-2026-09-10.md | Fix report UAT-001 | QA | 2026-09-18 | 2026-09-14 | Outdated | |
| DESK-ALERTRULE-001-FIX-REPORT-2026-09-17.md | Fix report ALERTRULE-001 | QA | 2026-09-18 | 2026-09-17 | Outdated | 3 mentions of 10.0.1.12 |
| CITYKART-DESK-DAILY-ACTIVITY-REPORT-2026-09-16.md | Daily activity report | Owner | 2026-09-18 | 2026-09-16 | Outdated | 2 mentions of 10.0.1.12 |
| CITYKART-DESK-DEPLOYMENT-PARITY-AND-PERFORMANCE-REMEDIATION.md | Deployment parity and performance | Ops | 2026-09-18 | 2026-09-16 | Outdated + Restricted | 4 mentions of 10.0.1.12 |
| CITYKART-DESK-FINAL-PARITY-PERFORMANCE-CLEAN-SLATE-REPORT.md | Final parity/performance/clean-slate | Ops | 2026-09-18 | 2026-09-16 | Outdated + Restricted | 4 mentions of 10.0.1.12 |
| CITYKART-DESK-PRODUCTION-SCALE-LOAD-AND-CLEAN-SLATE-REPORT.md | Production-scale load test | Ops | 2026-09-18 | 2026-09-16 | Outdated | 1 mention of 10.0.1.12 |
| CITYKART-DESK-FINAL-GO-LIVE-ACCEPTANCE-2026-09-17.md | Go-live acceptance 17 Sep | Owner | 2026-09-18 | 2026-09-17 | Outdated | |
| CITYKART-DESK-TEST-HARDENING-AND-BULK-READINESS.md | Test hardening, bulk readiness | QA | 2026-09-18 | 2026-09-16 | Outdated | |
| CITYKART-DESK-MANUAL-UAT-CHECKLIST.md | Manual UAT checklist | QA | 2026-09-18 | 2026-09-14 | Internal; Unverified currency | Useful as checklist structure only |
| TEST-FIXTURE-FIX-AND-REGRESSION-RESULTS.md | Test fixture fix, regression | QA | 2026-09-18 | 2026-09-16 | Outdated | |
| CLEAN-SLATE-SEED-MANIFEST.md | Clean-slate seed manifest | Ops | 2026-09-19 | 2026-09-19 | Internal | Seed contents; UNVERIFIED if still valid |
| PERF-AUDIT.md | Performance audit (2026-06-21 content) | Developers | 2026-09-18 | 2026-08-08 | Outdated | |
| PERFORMANCE-INVESTIGATION-REPORT.md | Local vs main performance | Developers | 2026-09-18 | 2026-09-16 | Outdated | 3 mentions of 10.0.1.12 |
| PERFORMANCE-LOCAL-ENVIRONMENT.md | Local dev environment notes | Developers | 2026-09-18 | 2026-09-16 | Internal; Unverified | |
| PERFORMANCE-MAIN-SERVER.md | "Main (Live) Server Environment 10.0.1.12" | Ops | 2026-09-18 | 2026-09-16 | Outdated + Restricted | Describes the retired server |
| WINDOWS-DEPLOYMENT.md | Native Windows Server deploy (no Docker) | Ops | 2026-09-18 | 2026-09-16 | Outdated + Restricted | 4 mentions of 10.0.1.12; 44 secret-keyword hits |
| RAILWAY-DEPLOYMENT.md | Hosted Supabase + Railway deploy | Ops | 2026-09-18 | 2026-09-15 | Outdated + Restricted | Superseded hosting model |
| superpowers/specs/2026-10-08-executive-dashboard-design.md | Executive dashboard design | Developers | 2026-10-08 | - | Internal/Draft | |
| superpowers/specs/2026-10-14-system-log-design.md | System log design | Developers | 2026-10-14 | - | Internal/Draft | |

Spreadsheets also in `docs/` (not Markdown, UNVERIFIED content): `CKDESK-FEATURES-BY-ROLE.xlsx`, `CKDESK-MANAGEMENT-FEATURE-STATUS.xlsx`, `VENDOR-EMAIL-MAP.xlsx`, `VENDOR-EMAIL-MAP-UPDATED.xlsx`.

### 2.2 Repository root (46 files)

| File(s) | Title / purpose | Audience | mtime | git | Class | Notes |
|---|---|---|---|---|---|---|
| AGENTS.md | "This is NOT the Next.js you know" (tool instruction) | AI coding tools | 2026-09-18 | 2026-08-06 | Internal | Not a knowledge source |
| CLAUDE.md | Project instructions and production setup (server addresses, deploy rules) | Developers, AI tools | 2026-10-07 | 2026-10-07 | Restricted | Server names, deploy policy |
| README.md | CityKart Desk overview and tech stack; lists "knowledge base" as a feature | Developers | 2026-09-18 | 2026-08-08 | Outdated | Written for local Supabase/Docker/Vercel era; UNVERIFIED line by line |
| HANDOVER.md | Session handover note | Developers | 2026-09-18 | 2026-09-01 | Outdated | |
| CITYKART_DESK_COMPLETE_SPEC.md | Complete technical and product specification (181 KB) | Developers | 2026-09-18 | 2026-09-14 | Outdated; Unverified | 36 secret-keyword hits; predates Oct features |
| CITYKART_DESK_WHATSAPP_TECHNICAL_DISCOVERY.md | WhatsApp ticket creation technical discovery (113 KB) | Developers | 2026-09-18 | 2026-09-14 | Outdated | WhatsApp out of scope per current guide |
| WHATSAPP_PILOT_USER_GUIDE.md | WhatsApp pilot user guide; the pilot number is "to be filled in" | Pilot users | 2026-09-18 | 2026-09-14 | Draft | Only user-facing guide in the repo; covers IT Support and HR Support only; WhatsApp is out of scope now |
| WHATSAPP_PILOT_RUNBOOK.md | WhatsApp pilot operations runbook | Ops | 2026-09-18 | 2026-09-14 | Outdated + Internal | |
| META_OPERATOR_HANDOFF.md | Meta operator hand-off | Ops | 2026-09-18 | 2026-09-14 | Restricted + Outdated | Token handling steps |
| UAT_DEPLOYMENT_HANDOFF.md | UAT deployment hand-off | Ops | 2026-09-18 | 2026-09-14 | Outdated + Restricted | |
| PILOT_MONITORING_SCORECARD.md, PRE_PILOT_CONFIGURATION_DECISIONS.md | WhatsApp pilot scorecard and decisions | Owner | 2026-09-18 | 2026-09-14 | Outdated | |
| STAGE_1_REPORT.md, STAGE_1_1_REPORT.md, STAGE_2_REPORT.md, STAGE_3_REPORT.md, STAGE_3_1_REPORT.md, STAGE_3_2_REPORT.md, STAGE_4_REPORT.md | Build-stage reports for the shared ticket-creation core, mobile identity, discovery/questionnaire, persistent conversation state | Developers | 2026-09-18 | 2026-09-14 | Internal (design history); Unverified currency | Useful to understand the conversation engine |
| STAGE_5_REPORT.md, STAGE_5_1_REPORT.md, STAGE_6_REPORT.md, STAGE_7_UAT_PLAN.md, STAGE_7_UAT_RESULTS.md, STAGE_7_1_ENHANCEMENT_PLAN.md, STAGE_7_1_IMPLEMENTATION_REPORT.md | Meta WhatsApp integration, hardening, UAT | Developers | 2026-09-18 | 2026-09-14 | Outdated + Restricted | Credential handling (STAGE_5: 25, STAGE_6: 19 secret-keyword hits) |
| STAGE_8_REAL_META_VALIDATION_REPORT.md, STAGE_8_1_EXTERNAL_PREREQUISITE_REPORT.md, STAGE_8_2_OPERATOR_ACTIONS.md, STAGE_8_2_REAL_META_ACTIVATION_REPORT.md, STAGE_8_3_REAL_VALIDATION_REPORT.md, STAGE_8_3_REMAINING_ACTIONS.md, STAGE_9_MAIN_RELEASE_REPORT.md | Real Meta validation and main release | Ops | 2026-09-18 | 2026-09-14 | Outdated + Restricted | |
| CITYKART-DESK-COMPLETE-SECURITY-AND-COMPLIANCE-STATUS-REPORT-2026-10-16.md | VAPT, ISO 27001, SOC 2 status | Owner, security | 2026-10-19 | 2026-10-17 | Restricted | Security findings; 3 mentions of 10.0.1.12 |
| CITYKART-DESK-FULL-AUDIT-REPORT-2026-10-13.md | Complete enterprise audit (187 KB) | Owner, developers | 2026-10-13 | 2026-10-19 | Restricted | Security findings; 5 mentions of 10.0.1.12 |
| CITYKART-DESK-CURRENT-CODE-FULL-LOCAL-AUDIT.md and -FINAL.md | Local audit and completion pass | Developers | 2026-09-23 | 2026-10-19 | Outdated + Restricted | |
| CITYKART-DESK-LOCAL-DEFECT-AND-FIX-REGISTER.md and -FINAL.md | Defect and fix register | Developers | 2026-09-23 | 2026-10-19 | Outdated | |
| CITYKART-DESK-LOCAL-DEPLOYMENT-CANDIDATE.md and -FINAL.md | Local deployment candidate | Developers | 2026-09-23 | 2026-10-19 | Outdated | |
| CITYKART-DESK-ROUTE-AND-LAYOUT-COVERAGE.md and -FINAL.md | Route and layout coverage | Developers | 2026-09-23 | 2026-10-19 | Internal; mentions `kb_articles` | Useful as a route list; may be stale |
| CITYKART-DESK-UNIVERSAL-REQUEST-FORM-LOCAL-IMPLEMENTATION.md, -UX-PROPOSAL.md, -VISUAL-REVIEW.md | Universal request form proposal, implementation, review | Developers, designers | 2026-09-24 | 2026-10-19 | Draft / Internal | Unverified if built as proposed |

### 2.3 Other Markdown folders (not in `docs/`, listed for completeness, not read in full)

| Folder | md files | Nature | Class |
|---|---|---|---|
| `security-assessment-2026-10/` | 63 | VAPT, ISO 27001, SOC 2 reports, remediation | Restricted |
| `audit-2026-10/` | 24 | Audit reports and evidence | Restricted |
| `vapt-2026-10/` | 7 | Penetration review working notes | Restricted |
| `qa-release-candidate-2026-10/` | 21 | QA results, 155-feature coverage list, UAT pack | Internal; the feature list (F001-F155) is a useful feature inventory |
| `main-server-configuration/` | 11 | Configuration of the retired Main server | Restricted + Outdated |
| `release-out/` | 6 | Release output notes | Restricted (UNVERIFIED) |
| `local-testing/README-LOCAL-TESTING.md` | 1 | Local test environment, points to the local test credential | Restricted |

### 2.4 Summary of classification

| Class | Where it applies |
|---|---|
| Approved and publishable | NONE (no approval marker in any file) |
| Candidates for approval after owner review (admin audience) | OEM-BY-TYPE-GUIDE, STORE-CVM-AND-CATEGORY-FIELDS-GUIDE, SHEET-MASTERS-GUIDE, AC-PMS, PROGRAM-PMS, TICKET-AUTOMATION-RERUN, SCHEDULED-REPORTS, AC-CALENDAR, SYSTEM-LOG. All are written in plain language; several still say "LOCAL BUILD, NOT RELEASED" and need their status lines refreshed first. |
| Internal operational | CKDESK-ARCHITECTURE-FEATURES-AND-TEST-GUIDE (best single feature explainer; carve out a safe subset), RELEASE-2026-10 change list, POST-AUDIT-BATCH-2, MORNING-WALKTHROUGH, STAGE_1..4 reports, QA feature list |
| Restricted | CLAUDE.md, PRODUCTION-INFRASTRUCTURE-AND-MIGRATION, HTTPS-AND-CSP-PLAN, GO-LIVE-RUNBOOK, LIVE-CONFIGURATION, CKDESK-DATA-API, CKDESK-BOT-VIA-CKONEAI (server names), all audit/VAPT/security folders, WhatsApp/Meta hand-offs |
| Draft | BOT plans (RAG, combined), GO-LIVE-AC-RO-SENSOMATIC, LIVE-CUTOVER-AC, VENDOR design docs, INTAKE design docs, WHATSAPP_PILOT_USER_GUIDE |
| Outdated (retired server 10.0.1.12 or superseded) | PERFORMANCE-MAIN-SERVER, WINDOWS-DEPLOYMENT, RAILWAY-DEPLOYMENT, the 2026-09 test/parity/load/clean-slate reports, ARCHITECTURE.md, DATABASE.md, README.md, HANDOVER.md, CITYKART_DESK_COMPLETE_SPEC.md, WhatsApp/Stage 5-9 reports, LIVE-VS-LOCAL comparisons |
| Unverified | Anything marked "Unverified" above; no file was checked line by line against the code |

Files containing the retired address `10.0.1.12` (keyword scan): 16 files in root and `docs/` (including the "retired" warnings in CLAUDE.md, PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md, GO-LIVE-RUNBOOK-2026-10.md which are correct statements and not stale instructions).

---

## 3. In-app help content and the service catalogue

### 3.1 Help text found in `app/` and `components/`

| Place | What it says / does | Audience | Notes |
|---|---|---|---|
| `/admin/runbooks` (`app/(app)/admin/runbooks/RunbooksClient.tsx`, 1,068 lines; sidebar item "Runbooks"; page allowed for admin, manager, platform_owner) | Hard-coded admin help: 8 sections, 31 topics: Getting Started (overview, role guide, first login), Service Management, Workflow Configuration, SLA and Escalation, Technician Group and User Management, Task Management, Reports and Exports, Platform Settings (auto-close, retention, SMTP, Resend, cron jobs) | Admin, manager | Generic examples ("Laptop Setup", "New Hire Onboarding", "Expense Reimbursement"), references Vercel `vercel.json` crons and `docs/RAILWAY-DEPLOYMENT.md`. Outdated against the 2026-10 production setup (Windows servers). Last commit 2026-10-01. Feature F133 "Runbooks" NOT TESTED. |
| `components/requests/ResolvedReopenBanner.tsx` | "Not actually fixed? You can reopen this within [window] of it being resolved - after that it closes for good." After the window: "Still having the issue? Please log a new request." with a countdown | Requester | Window length comes from app settings (`reopen` setting in `/admin/request-config`, text in `AppSettingsClient.tsx`) |
| `components/requests/ApprovalRejectedReopenBanner.tsx` | "Approvals are sometimes rejected by mistake - you can reopen this and send it back to the technician." | Requester | Rejected approval leaves a 48-hour window per the architecture guide |
| `app/csat/[token]/CsatPublicForm.tsx` | CSAT public page: "Not fixed yet? You can reopen this until [date]." | Requester | Signed link from the CSAT e-mail |
| `app/(app)/admin/settings/SettingsClient.tsx` (around line 462) | "How do I set this up?" expandable guide for the sender mailbox and Google app password | Admin | Mentions SMTP host/port and app-password steps (no real secret) |
| `app/(app)/services/page.tsx` | Page description "Browse and request services from your technician groups"; empty-state texts | Requester | The service catalogue is the main "how do I raise a ticket" entry point |
| `app/(app)/home/page.tsx` | Section headers and empty states ("My Queue", "Needs Your Attention", "My Requests") | All | No explanatory text |
| `components/ui/tooltip.tsx` | Generic tooltip component; used only in `components/analytics/Charts.tsx` | - | There is no tooltip-based help system |
| `lib/requests/ticket-summary.ts` and `components/requests/TicketSummaryCard.tsx` | "Catch me up" card on the ticket (what happened, what is pending, with whom); built from the ticket's own history, no outside service | Technician, manager | Deterministic; the file says an AI could later write sentences from the same facts |

Not found: any `/help`, FAQ, onboarding tour, welcome screen or "how to raise a ticket" page for requesters. A repo-wide search for "FAQ", "onboarding", "tour", "guide" component/file names returned nothing beyond the above.

### 3.2 Service catalogue (LOCAL DB, counts only)

| Measure | Count |
|---|---|
| Services (all active, all status `published`, visibility `all`) | 16 |
| Services with a non-empty description | 16 |
| Services with a form template linked | 16 |
| Services with an SLA policy linked | 16 |
| Services with an approval workflow set on the service row | 0 (approvals come through rules/workflows elsewhere; UNVERIFIED how) |
| Services with `auto_oem_routing` on | 1 |
| Services with keywords filled in (`services.keywords`) | 0 (column exists, all empty; nothing in app code reads it) |
| Service categories (all active) | 111 (all have a description; 1 is a PMS category) |
| Service sub-categories (all active) | 615; tagged to services: 614 |
| Form templates | 16 |
| Form field library entries | 39 |
| SLA policies | 16 |
| Service-location tags | 26 |
| Business rules | 48 |
| OEMs | 14 |
| Vendor programs | 4 (program rows: 2,980) |

Sub-categories per service (service name : sub-categories : tickets raised), service names are catalogue data, not personal data:
AC-PMS 1:2, ADMIN - AC 15:45, ADMIN - REQUIREMENTS (NON TRADING) 178:86, ADMIN REPAIR 114:49, BD 53:7, FINANCE OMNI 7:1, FINANCE REFUND 5:7, FINANCE-VENDOR CREATION 1:3, HR 72:89, IT 75:133, L&D 15:0, LEGAL 10:1, LP 3:1, PO ADVICE (APPS) 8:0, PO ADVICE (GM) 13:2, VM 44:7.

Local differs slightly from the live figures quoted in the 2026-10-15 plans (live then: 15 services, 108 categories, 613 sub-categories). Local is a copy taken 2026-10-21 plus later local changes; do not treat local numbers as live numbers.

Fact from the plans, checked in code: each sub-category belongs to exactly one service (unique tag), so service suggestion can be derived from a sub-category match.

---

## 4. Search, WhatsApp engine, AI usage and the bot plans

### 4.1 Global search (`lib/actions/search.ts`, UI `components/layout/GlobalSearch.tsx`)

- Server action `globalSearch(query)`; minimum 2 characters. Uses the signed-in user's own (row-level-security) client, not the admin client, so a user only finds what they may already see.
- Matching is `ILIKE %text%` (no full-text index, no ranking, no semantic search), run per column and merged:

| Group | Columns searched | Limit |
|---|---|---|
| Tickets (`requests`) | ticket number, title, description, requester name, assignee name | 8 shown |
| Tasks | title, description, assignee name, linked ticket number | 8 |
| Projects | name, description, owner, milestone names, project update text and blockers | 8 |
| Services | name, description (active only) | 5 |
| People (`profiles`) | full name | 5 |
| Approvals | ticket title/number, approval status (post-filtered from the latest 50 visible) | 5 |

- NOT indexed: Knowledge Base articles, runbooks, categories/sub-categories, comments, attachments, stores, documents.
- The unused GIN index on `kb_articles` is the only full-text index relevant to knowledge and nothing queries it.

### 4.2 WhatsApp conversation engine and intake

Components: `lib/whatsapp/` (config, signature check, Meta Graph client, inbound adapter, render, media, webhook handler, `intent.ts`), `lib/conversations/` (orchestrator 1,009 lines, state machine, repository, recovery, types), `lib/requests/questionnaire/` (catalog, sub-category search, question plan, review, title, answers), route `app/api/intake/webhook/whatsapp/route.ts`.

| Topic | Finding |
|---|---|
| Status | Code present, out of delivery scope per the architecture guide (section 0, item 6; section 12). Local tables are empty: `intake_channels` 0, `request_conversations` 0, `conversation_events` 0, `conversation_attachments` 0, `intake_messages` 0, `intake_threads` 0. No ticket has an `intake_message_id`. |
| Message classification | There is NO free-text intent classifier. `parseCommand()` accepts only exact words `new`, `cancel`, `restart`, `create`, `edit`. `mapFriendlyGreetingToNew()` maps exact phrases `hi`, `hello`, `hey`, `new`, `ticket`, `create ticket`, `raise ticket` to "new". Deliberately excludes "help". Exact match only; code comments say "do NOT add AI intent classification". |
| Conversation states | identified, awaiting_service, awaiting_issue_search, awaiting_subcategory, awaiting_description, collecting_fields, awaiting_file, review, submitting, completed, cancelled, expired. One active conversation per phone/identity; idempotent on external message id; 5-minute stale-submitting repair; lazy expiry. |
| Service selection | Presents a numbered/selectable list of services (published and active only, filtered by the requester's location tags). Service is chosen from the list, not guessed from text. |
| Keyword matching to services | None. `services.keywords` is not read. Matching exists only one level down: `scoreSubCategoryMatch()` ranks sub-categories of the CHOSEN service by name (exact 100, prefix 80, substring 60, word overlap up to 40), no AI, no embeddings, no Hindi/Hinglish synonyms. |
| Ticket creation | Goes through `createRequestCore()` (`lib/requests/create-request-core.ts`) using the admin client with explicit `org_id` filters; the verified requester id must be passed in at every step. |
| Titles | `lib/requests/questionnaire/title.ts` builds titles deterministically; it exposes an optional `AiTitleProvider` hook that nothing wires up. |
| Bot-like behaviour already in the web app | "Catch me up" ticket summary (deterministic). Nothing conversational. |
| Gaps relevant to an assistant | No "what does X mean / how do I" answering anywhere; no FAQ matching; no duplicate-ticket warning; no wrong-service recovery (cancel reasons exist as `cancellation_reason` on `requests`). |

### 4.3 Existing AI usage

| Where | Provider and model | What is sent | What is stored |
|---|---|---|---|
| Email brief: `lib/actions/intake/brief.ts`, shown by `components/intake/AiBrief.tsx` in the intake inbox | OpenAI-compatible chat endpoint; defaults `https://api.groq.com/openai/v1` and model `llama-3.3-70b-versatile` (overridable by `INTAKE_LLM_BASE_URL`, `INTAKE_LLM_MODEL`); needs `INTAKE_LLM_API_KEY` (not set = "not_configured") | Subject, sender address and the first 2,000 characters of the body; only for users who can review intake (D-027); module "intake" must be enabled | NOTHING. Result is held in browser state only. temperature 0.1, max 150 tokens, 15 s timeout. |
| Email classifier: `api/src/intake/classify/local-model-classifier.ts` (separate `api` service) | Same env-driven OpenAI-compatible endpoint (default Groq Llama 3.3 70B); rule engine runs first | Subject, sender, channel and the first ~1,800 characters | One row per stage in `intake_classifications` (type, department, category, subcategory, priority, confidence, rationale up to 500 chars, token counts, cost estimate); the winner is marked final. Local table has 0 rows. |
| `api/package.json` | Depends on `@anthropic-ai/sdk ^0.36.3` | - | No Anthropic call was found in `api/src` in this pass (UNVERIFIED; the dependency is present) |
| Root Next.js app | No AI SDK dependency | - | - |
| `ai_applications` table (6 rows locally) | Unrelated: a list of application names for DeskTime productivity tracking, not an AI feature | - | - |

### 4.4 CKOneAI integration (current direction, uncommitted in the working tree)

`lib/ckoneai/*` (sign, config, path, roles, access, forward), `app/api/ckoneai/`, `app/ckoneai-ui/`, `app/(app)/ckoneai/`, menu entry "Ask CK Desk", four unit-test files. Off by default (`CKONEAI_ENABLED`, base URL, shared secret, pilot user ids). CK Desk stores no question or answer text; only a System Log line (who, when, size, roles). CKOneAI answers from the data platform `gold_*` views fed by the read-only data API.

Knowledge relevance: neither the data API nor CKOneAI has any path to `kb_articles`, runbooks or the Markdown docs today. The data API entities that touch guidance content are `services`, `service_categories`, `service_sub_categories`, `sla_policies`, `approval_workflows` and `programs` (structure only, no ticket text).

### 4.5 The two bot plans and what is superseded

| Plan | What it proposed | Superseded by `CKDESK-BOT-VIA-CKONEAI.md`? |
|---|---|---|
| `CKDESK-BOT-RAG-PLAN.md` (2026-10-15) | Bot = RAG (knowledge) plus tools (live data), always limited to the asker's permissions. Index: help articles/SOPs (to be written), service catalogue, SLA, store/AC facts, past solved tickets (technicians only, passwords removed), rules explanations. Hybrid search inside the existing Postgres (no pgvector on the Windows DB server; embeddings stored as numbers and compared in the app). Safety rules: same permissions, no passwords, cite or refuse, treat ticket text as untrusted, people confirm actions, audit, switches. Phases 0-5 (content first, requester help bot, technician assistant, manager assistant, WhatsApp, improve). Decisions: AI provider (Claude / Groq / self-hosted), first users, languages, outside-provider data rule, content owner, budget. | PARTLY. Superseded: where the assistant runs (CKOneAI at 10.0.0.82 instead of new `ai_*` tables and an in-app model call), how live numbers are answered (CKOneAI reads `gold_*` views, "numbers never come from the model"), the chat UI (CKOneAI page embedded at `/ckoneai-ui/`). Still open and not superseded: the knowledge bookshelf (articles/SOPs), service suggestion and "raise a ticket for me", technician reply drafts, evaluation set, content ownership. |
| `CKDESK-BOT-COMBINED-PLAN.md` (2026-10-15) | Merges an external blueprint with the RAG plan. Verifies code claims (createRequestCore, questionnaire engine, globalSearch pattern, KB with 0 articles, no pgvector, no GPU). Adds: knowledge content is the critical path; stricter service-suggestion target (right service in top 3 at least 97%, sub-category 90%) because a technician cannot change a ticket's service; "Wrong service?" helper and cancel reasons; a no-AI "Layer 1"; `ai_*` tables (sources, chunks, index jobs, conversations, messages, retrieval events, feedback, action audit, model config); learning loop that drafts articles from solved tickets with owner approval; phases 0-5; 150-300 question evaluation set; merged decision list. | PARTLY. Superseded: the `ai_*` table design and in-app orchestrator (replaced by the CKOneAI bridge: CK Desk only authenticates, signs and passes the chat through); the model gateway and rate/cost controls move to CKOneAI. Not superseded and explicitly deferred (section 6 of the new doc): service suggestion, guided ticket creation, "raise a ticket for me", knowledge-base answers. |
| `CKDESK-BOT-VIA-CKONEAI.md` (2026-11-02) | CK Desk checks the session, decides roles on every call (requester, technician, approver), signs the call (HMAC, 60-second window, one-time number), forwards chat only to `/api/ckoneai/*` and `/ckoneai-ui/*`; read-only answers; no question text stored; switched off until four settings exist; plain-HTTP caveat; names only on the asker's own tickets/approvals. | Current direction for the "ask about my data" half. Says the knowledge base is still empty so document answers have nothing to read. |

Decision facts carried in the plans that remain unresolved: AI provider and data-leaves-company rule, languages (Hinglish), content owner, first user group. None of these is recorded as decided in the 2026-11-02 document except the architecture (CKOneAI).

Other facts worth reusing: users who have a mobile number registered: 29 of 553 (live, 2026-10-15; UNVERIFIED today); old resolution notes contain at least one default password and must be excluded or cleaned before indexing (statement in both plans; not re-checked, to avoid reading ticket text).

---

## 5. LOCAL DB volumes for test fixtures (counts only)

Source: local Supabase REST, counted 2026-11-02. The data is a copy of real company data (architecture guide, section 0 and 3): derive fixtures, never export or paste real rows.

| Table / measure | Count |
|---|---|
| `requests` total | 433 |
| status closed | 137 |
| status open | 123 |
| status in_progress | 110 |
| status cancelled | 27 |
| status resolved | 17 |
| status pending_approval | 9 |
| status waiting_user | 7 |
| status assigned | 2 |
| status hold_purchase_ho | 1 |
| priority medium / low / high | 349 / 61 / 23 (no urgent) |
| tickets with a source-metadata object | 407 (26 without) |
| tickets that came from the intake (e-mail/WhatsApp) | 0 |
| `request_comments` | 772 (771 public, 1 internal) |
| `request_attachments` | 570 |
| `stores` (all active) | 231 |
| `teams` (all active) | 11 |
| `departments` | 1 |
| `profiles` total | 599 |
| profiles by role | user 549, agent 45, manager 2, platform_owner 2, admin 1 |
| `services` | 16 (all published) |
| `service_categories` / `service_sub_categories` | 111 / 615 |
| `form_templates` | 16 |
| `sla_policies` | 16 |
| `business_rules` | 48 |
| `approval_workflows` | 643 |
| `approvals` total | 56 |
| approvals approved / pending / rejected | 44 / 9 / 3 |
| `csat_surveys` total | 133 |
| csat sent (sent_at set) | 133 |
| csat reminder sent | 132 |
| csat rated (rating set, submitted_at set) | 1 |
| csat unrated | 132 |
| `oems` | 14 |
| `vendor_programs` / `program_rows` | 4 / 2,980 |
| `system_log` | 72,969 |
| `error_reports` | 9 |
| `master_mail_templates` | 0 |
| `kb_articles` | 0 |
| intake / conversation tables | all 0 |
| `scheduled_reports` / `saved_reports` / `notification_rules` | 1 / 1 / 1 |

Fixture implications (facts, not recommendations): there is almost no rated CSAT (1 of 133) and no urgent priority, no intake-origin tickets and no KB content, so any assistant test that needs those has to create synthetic rows in an isolated database. Every role needed for role-based tests exists (user, agent, manager, admin, platform_owner); `approver` is derived (manager/admin/platform_owner or a named approval-step approver). 43 approvals are historical, 9 pending, giving enough rows for "my pending approvals" style tests.

---

## 6. Items not verified in this pass

- Production counts (KB, tickets, users with mobile numbers) were not re-read; only the 2026-10-15 figures in the plans are quoted.
- Whether the "LOCAL ONLY" admin guides (section 2.1) have since been released; memory notes suggest several were, but each file still carries its old status line.
- No document was compared line by line to the code; "Outdated" for pre-October files is by date, server-name scan and header text.
- `@anthropic-ai/sdk` in `api/package.json`: no usage found in the files inspected; not searched exhaustively.
- Content of the four `.xlsx` files and of `security-assessment-2026-10/`, `audit-2026-10/`, `main-server-configuration/` was not opened.
- How approval workflows are attached (0 services carry `approval_workflow_id`; 643 workflow rows exist, apparently per category/sub-category).
- Whether any ticket comment or resolution note locally contains a password (deliberately not checked; ticket text was not read).
