# CK Desk Bot: the combined plan (version 2)

Written 15 October 2026. It joins two things: the blueprint a second AI wrote (called "the Blueprint" below) and our own plan plus what I found in your live system (called "our plan"). Plain language. This is a suggestion for your decision. **Nothing is built.**

---

## 1. Verdict in one minute

- The Blueprint is a **good architecture**. Its main ideas are right, and I checked its claims about your code: they are accurate (see section 2).
- It is written **without looking at your data and your rules**. It does not mention that the knowledge base is empty, that technicians cannot change a service, that your database server has no vector add-on, or that old notes contain passwords.
- **Combined plan = the Blueprint's structure + our ground-truth fixes.** The structure is "Hybrid RAG + live-data tools + guided ticket workflow, behind one safety guard". The fixes decide the order of work and the targets.

---

## 2. Are the Blueprint's claims true for your code? (I checked)

| Blueprint says | What I found |
|---|---|
| Ticket creation goes through `createRequestCore()` | **True.** `lib/requests/create-request-core.ts`: service/template, mandatory-field checks, SLA, business rules and notifications all run there. The bot must use it. |
| A questionnaire engine already exists | **True, and more useful than the Blueprint says.** `lib/requests/questionnaire/` already lists services, searches and re-checks sub-categories, plans the mandatory questions, builds a review and makes titles. It was built for WhatsApp and reads the same form definition as the web form. |
| A search action exists | **True.** `globalSearch` uses the person's own (RLS) access, not the admin client. Good pattern to copy. |
| A Knowledge Base exists with draft/published/archived | **True** (`kb_articles`, an admin screen). **But it has 0 articles.** |
| A WhatsApp conversation framework exists | **True** (`request_conversations`). The WhatsApp project itself still needs setup (secure address, Meta account, user numbers). |
| No RAG or vector index exists | **True.** Also, the main app has no AI library. A separate `api` service has the Anthropic library, and the email classifier uses a Groq/Llama endpoint. There is also an unused hook for AI-written titles. |
| Use `pgvector` "subject to compatibility tests" | **Not available today.** Your database server is a normal Windows PostgreSQL. It has `pg_trgm` only. |
| Use pgvector and a GPU model | We have **no GPU server**. |

One caution from the code: the questionnaire and ticket-creation code uses the **admin database client with explicit organisation filters**, not the person's own access. So the bot must pass the verified signed-in person into every step and we must test it, exactly as the Blueprint's security section says.

---

## 3. What we adopt from the Blueprint

1. **Hybrid design**: RAG for knowledge, tools for live data, workflow for actions, and one guard (citations, confidence, permissions, audit).
2. **Employees always can skip the bot** and go straight to a ticket ("never obstruct ticket creation").
3. **Authorization before retrieval.** Only search what the person may see; never search everything and hide it afterwards.
4. **Controlled actions**: read-only first; a ticket is only created after the person previews and confirms, through `createRequestCore()`.
5. **Learning from solved tickets**: AI finds repeated fixes, drafts a knowledge article, an owner approves, then it becomes searchable. This is how we fill the empty knowledge base. Humans approve; nothing is published automatically.
6. **Separate employee and technician knowledge**; internal notes and sensitive attachments excluded by default.
7. **Prompt-injection protection**: ticket text, emails and documents are data, never instructions.
8. **Provider-independent model gateway**, so we can swap local, hosted or "none".
9. **Isolated `ai_*` tables** with organisation scoping, row rules, retention and rollback, plus bot logs: conversations, messages, which sources were used, feedback, confirmed actions.
10. **Evaluation set of 150 to 300 questions** (including Hinglish) and acceptance targets, measured before launch.
11. **Incremental indexing** (not re-embedding everything), with source hashes, version and revocation.
12. **Ticket-detail "AI Suggestions" panel for technicians** and a persistent "Ask CK Desk" entry in the menu.

---

## 4. What our plan adds or corrects

### 4.1 The knowledge is the real work, so it comes first
- Knowledge base articles: **0**. Tickets: 278. Public messages: 477. No internal notes yet.
- Resolution notes were mostly "Done" or "Resolved". From today, a note must be at least 10 characters and carry no password.
- Some old notes contain a default password. **They must be excluded and cleaned before anything is indexed.**
- So "Phase 0: seed the knowledge" is on the critical path. Without articles the bot has nothing to answer from, whatever the technology.

### 4.2 Service choice has a higher bar in your company
- Every service has its own mandatory form. **A technician cannot change a ticket's service**, and the trial we built removes that ability for managers and admins too.
- So a wrong service means cancelling and re-raising. This is more costly than the Blueprint assumes.
- The Blueprint's target (correct service/sub-category at least 90%) is too soft for the **service** part. My targets:
  - The right service must be in the bot's **top 3** suggestions **at least 97%** of the time on your past tickets.
  - The bot **always shows the form it will ask for** before the person commits, and asks a plain question when unsure ("which system?", "GM or Apps?").
  - Sub-category suggestion (which sets the assignment, and which a technician can fix) keeps the 90% target.
- Add the safety net: record **why** a ticket is cancelled, and a **"Wrong service?"** helper that cancels with that reason and creates a pre-filled draft in the right service.
- Facts: each sub-category belongs to exactly one service; only 5 names repeat (PO ADVICE APPS vs GM); fire items sit under BD and LEGAL.

### 4.3 Storage: no pgvector on the production database
- Do **not** install anything on the production database server for this.
- At your size (hundreds to a few thousand chunks) a plain table of numbers plus comparison in the app is enough, together with PostgreSQL text search and `pg_trgm`.
- If the content ever grows a lot, test `pgvector` on a copy first.

### 4.4 A "no AI provider" layer
- The Blueprint assumes a language model. We also need a layer that works **without** one: service suggestion by word matching and a Hinglish synonym list, finding and showing the best article section, live-data answers, duplicate warning, and free in-house meaning search on the server CPU.
- An AI writer is then a switch ("Layer 2"), not a requirement. The model gateway has a "none" provider.

### 4.5 Realistic effort
- The Blueprint's 1 to 2 weeks per phase assumes the content and the infrastructure decisions exist. Expect the first useful release to be **content-limited**, not code-limited.
- The Blueprint's own caution is right: the app server also hosts other services, so **no heavy AI job or GPU service on production**. A good writer model needs a GPU machine we do not have.

### 4.6 Technician view needs care with notes
- "Similar solved tickets" is useless until notes are meaningful. It starts after a few months of good notes and an approved set of articles.

---

## 5. Combined architecture

```
Person (web chat "Ask CK Desk", ticket form box, ticket page panel, later WhatsApp)
   │   signed-in identity (never a shared bot account)
   ▼
Orchestrator: who is this, what do they want, what may they see
   ├── Knowledge search (RAG): published articles, service catalogue, SLA, form guidance,
   │      [technicians only] approved resolution summaries
   │      keyword + meaning search, permission filter BEFORE search
   ├── Live-data tools (read-only): my tickets, ticket status, pending approvals,
   │      "Catch me up" facts, predefined reports (tested definitions only)
   └── Guided ticket workflow: suggest service + sub-category, show the form,
          ask the mandatory questions (existing questionnaire engine),
          preview, person confirms, createRequestCore()
   ▼
Guard: citations or "no verified procedure found", confidence, no passwords/personal numbers out,
       prompt-injection rules, rate limit, cost cap, audit log
   ▼
Answer / suggestion / confirmed action, always with "Skip and raise a ticket"
```

Reused from the app: Knowledge Base, service catalogue and templates, `createRequestCore()`, the questionnaire engine, `globalSearch` pattern, roles and row rules, reports, the WhatsApp conversation tables, the existing AI hooks.

---

## 6. What goes into the knowledge (our numbers)

| Source | Index? | Notes |
|---|---|---|
| Published knowledge articles | Yes, first | 0 today: Phase 0 |
| Approved SOPs / manuals / troubleshooting PDFs | After approval and access label | Your team supplies |
| Service catalogue, forms, SLA, "what belongs here" lines | Yes (15 services, 613 sub-categories, 15 forms, 15 SLA policies) | The "what belongs here" lines are new, short, written once per service |
| Approved resolution summaries | Technicians only, after review and clean-up | After note quality improves |
| Old ticket text | Technicians only, permission filtered; **passwords removed** | Later |
| Internal notes, sensitive attachments | No | By default |
| Draft/archived articles | No | |
| Live status, SLA, assignee, report numbers | **Tools, not the index** | Always fresh and permission-checked |

Each chunk carries: source, version, service, audience (requester / technician / manager / admin), group, language, status, revoked flag and source hash.

---

## 7. Database design (adopting the Blueprint's tables, with our changes)

`ai_knowledge_sources`, `ai_knowledge_chunks` (text + embedding as numbers + labels above), `ai_index_jobs`, `ai_conversations`, `ai_messages`, `ai_retrieval_events`, `ai_feedback`, `ai_action_audit`, `ai_model_config`.

Our additions: every table has `org_id` and row rules; chat logs keep a short retention; a "revoked" check at question time so an archived article stops appearing at once; migrations are run on the production database **by you, on the database server, after a backup**, as with earlier migrations (the app server cannot change the database itself).

---

## 8. Phases (combined)

| Phase | What | Gate to move on |
|---|---|---|
| **0. Prepare and measure** (code is small; content is large) | Record cancel reasons. "Wrong service?" helper. Write the "what belongs here" lines. Seed 15 to 30 articles for the busiest ticket types (I draft from your tickets, your team approves). Clean passwords from old notes. Build the 150 to 300 question evaluation set. | Evaluation set and first articles approved |
| **1. Knowledge Assistant (read-only)** | Chat with citations; Layer 1 (no AI writer) first; AI writer switched on later. No ticket writes. Feedback buttons. Access tests. | Grounded answers 100%; no unauthorized disclosure in the attack tests |
| **2. Guided ticket creation** | Suggest service and sub-category; show the form first; mandatory questions via the existing engine; preview; confirm; `createRequestCore()`. Always a visible "Skip and raise a ticket". | Service in top 3 at least 97% on past tickets; mandatory-field compliance 100%; no duplicates on retry |
| **3. Technician copilot** | AI Suggestions panel on the ticket page; similar approved resolutions; reply drafts; resolution-note drafts; **"draft an article from this solved case" with owner approval** | Enough good notes and articles; helpfulness at least 80% |
| **4. Manager intelligence** | Plain-language questions answered by tested reports and tools, plus ticket summaries | Report accuracy checks |
| **5. WhatsApp** | Same bot through the existing conversation engine | After the WhatsApp setup (secure address, Meta account, user numbers) |

All phases are built locally first, shown to you, and deployed only on your OK.

---

## 9. Success measures

Adopted from the Blueprint, plus ours:

- 100% of procedural answers grounded in authorized sources; at least 98% correct citation mapping.
- **Service in top 3 at least 97%; sub-category suggestion at least 90%** (ours is stricter for service).
- Mandatory-field compliance 100%; unauthorized disclosure 0 in attack tests; no duplicate tickets from retries.
- Answer time: 95% within 5 seconds (benchmark-dependent); helpfulness at least 80%.
- Baselines first, then: tickets avoided, wrong-service cancellations (count by reason), technician time per ticket.

---

## 10. Decisions needed (merged list)

1. **Model approach:** Layer 1 only (no provider) to start, or also an AI writer? If yes: Claude, Groq/Llama, or a self-hosted model (needs a GPU machine; ask IT what exists)? The Blueprint recommends a hybrid: search, embeddings, permissions and storage stay in-house; a provider writes the answer if policy allows.
2. **Data rule:** may a question plus a few matched text chunks go to an outside provider? (Never personal numbers, passwords or attachments.)
3. **Languages:** English only, or Hindi and Hinglish too? (Suggested: both.)
4. **First users:** requesters and technicians on IT, Admin Repair and PO ADVICE?
5. **Content owner:** who approves the first 15 to 30 articles and the "what belongs here" lines, and reviews weekly?
6. **Service rule target:** is 97% in the top 3 acceptable for service suggestion, or do you want it stricter?
7. **Budget cap** per month (the cost at your volume is small, but we should set a limit).
8. **Database changes** for the `ai_*` tables: agree that you run them on the database server after a backup.

---

## 11. Risks and how we handle them

| Risk | Handling |
|---|---|
| Wrong service suggested | Ask when unsure, show the form first, top-3 target, "Wrong service?" helper, cancel reasons |
| Empty or weak knowledge | Phase 0 content; learning loop with human approval |
| Leaking restricted data | Permission filter before search, per-chunk labels, attack tests, no service-role "search everything" |
| Passwords or personal data in notes | Excluded and masked before indexing and before any model call |
| Bot invents an answer | Cite or say "no verified procedure found" |
| Prompt injection from ticket text | Treat retrieved text as data only |
| Cost or load | Limits, caching, no heavy job on the app server |
| People stop using it | Always allow skipping; weekly review of unanswered questions |

---

## 12. Recommended next step

Do not start the bot yet (as you decided). When you want to start, the first small, safe pieces are: record cancel reasons, the "Wrong service?" helper, and a no-AI service-suggestion prototype replayed on your past tickets. They improve the system today and give real accuracy numbers for the decisions above.
