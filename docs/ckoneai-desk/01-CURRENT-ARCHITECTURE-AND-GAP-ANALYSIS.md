# 01. Current architecture and gap analysis

Status: LOCAL, 2 Nov 2026. Evidence: `evidence/inv-A`, `inv-B`, `inv-C`, `authz-differential.json`; CKOneAI facts are **as described by the CKOneAI session** (no local copy of its repository is on this PC, so none of them were read in code).

## 1. What already exists in CKDesk

| Area | State | Where |
|---|---|---|
| Ticket core: 9 statuses, transitions per role, reopen window (admin setting, default 3 days), priority derived from the sub-category (no manual change), request numbers `CKSD-000123` | built, live | inv-A sections 1 and 2 |
| Service catalogue: services > categories > sub-categories, forms with mandatory and conditional fields, location visibility, Vendor Programs, AC/Genset/CVM sheet masters | built, live (some admin guides still say "local only") | inv-A section 1, inv-B section 5 |
| SLA: policies by priority, business hours and holidays, pause on three statuses, deadlines stored and moved later when a pause ends, four breach definitions, "At risk" = under 4 hours | built, live | inv-A section 3 |
| Business Rules (created, updated, scheduled "percent of SLA elapsed") | built, live | inv-A section 4 |
| Approvals: workflows with steps, ad-hoc, CVM auto approval, delegation per step, separation of duties checked at decision time | built, live | inv-B section 3 |
| Vendor / OEM logins (technician, manager), quotes, POs, parts, FSR | built, live; vendor is a `user` plus company and vendor role | inv-B section 4 |
| CSAT surveys after resolve | built; **1 of 277 rated on live** | inv-A section 5 |
| Row security (one `requests_select` policy with eight ways in) | built | inv-B section 2 |
| Read-only data API (17 entities, bearer token, paging, ids for deletes) | **live since 2 Nov**, DBA loaded all 17 entities | `docs/CKDESK-DATA-API.md`, tests 67 and 69 |
| Knowledge Base | table and admin screen only; **empty**; no audience, version or approval; not exported | inv-C section 1 |
| Global search, WhatsApp engine | records and exact commands only; no documents, no model | inv-C sections 3 to 5 |

## 2. What now exists on the CKDesk side for the assistant (this work, local)

Signer (spec v1), settings and kill switch, path allow-list, roles rule, gate (pilot list, vendor refusal), forwarding with streaming and header stripping, menu entry and frame page, audit line without question text, secret entry in `lib/secrets.ts`, tests (108 unit, 17 database), the question bank, the synthetic articles, the authorisation and contract tests. See docs 05 to 15.

## 3. What exists in CKOneAI (per its session; not read here)

A separate Python/FastAPI service (10.0.0.82:8100) with deterministic routing, fixed read-only tools on the data platform's `gold_*` views through a read-only login, a local model used only for open chat and rewording in other domains, a signed-header bridge (DC360 pattern). For CKDesk, branch `v3-ckdesk` (tip `1f99e1f`): a `ckdesk` scope routed by rules before anything else (no documents, no general model, no slot-filling model), **seven tools** (doc 06), a per-person predicate as a bound parameter checked again before the query, conversations stored apart (`ckdesk:<person>`), closed paths for question library, coverage, handoff and admin, 140 CKDesk tests including the four signing vectors. Not done there: the `/ckoneai-ui/` page build, any run on real `gold_ckdesk`, any release.

## 4. What can be reused (and was)

CKOneAI's tool registry, router, scope framework, conversation store, signing verifier and chat page (nothing rebuilt); the existing data API; the existing System Log; CKDesk's row security as the reference for authorisation tests; CKDesk's forms and ticket-creation engine for the future write design.

## 5. What is missing

| Gap | Effect | Proposed fix |
|---|---|---|
| No approved knowledge; Knowledge Base empty, no audience / version / approval fields, not exported | no "how do I" answers | docs 03 and 04, decision 3 and 5 |
| Platform lacks the facts the access rules use: approver steps, team membership, manager id, collaborators, vendor company | tools are safe but narrower than CKDesk; "approvals waiting for me" impossible; team workload impossible | proposals P1 to P6 (doc 05) |
| Three scope differences (aggregates wider for agents; CSAT wider; tools narrower for technicians and managers) | owner must choose | decision 2 and 8 |
| No definition of "about to breach" for the assistant | SLA-risk tool not built | decision 10 |
| CKOneAI chat page not built; question bank not run; no non-live `gold_ckdesk` copy | no accuracy figures | docs 11 and 14 |
| Spec v1 has no organisation field | fine with one organisation | decision 11 |
| Several admin guides are stale ("local only", old server) | cannot be used as approved material | doc 03 |

## 6. Which earlier plans are superseded

- `CKDESK-BOT-RAG-PLAN.md` and `CKDESK-BOT-COMBINED-PLAN.md` (15 Oct): **where the bot runs and how it answers numbers** is replaced by `CKDESK-BOT-VIA-CKONEAI.md` (a separate service with fixed read-only tools, not a bot inside CKDesk). Their knowledge side (articles, service suggestion, ticket draft) is **not** superseded; it is still open and is the subject of docs 03 and 04 and of the future write design (doc 15).
- Anything that calls the service-role key directly for user questions: rejected; the platform and the per-person predicate replace it.

## 7. What needs the owner's approval

Everything in doc 14: the pilot people, the aggregate-tool scope (new `manager` role), documents and who approves them, plain HTTP for the pilot, the new data entities (with the DBA told first), the definition of "about to breach", and a **separate go** before any push, merge, deploy or secret on the servers.
