# Citykart DESK — WhatsApp Ticket Creation & Interaction: Technical Discovery

**Audit type:** Read-only discovery. No code, schema, or configuration was modified to produce this report.
**Repository:** `Citykart DESK` (Next.js 16 App Router + Supabase/Postgres, plus a separate Express intake-worker service under `api/`).
**Labeling convention used throughout:** **CONFIRMED** (verified directly in code/schema) / **INFERRED** (strongly suggested, not fully proven) / **NOT FOUND** (searched, absent) / **UNKNOWN** (cannot be determined from the repository).

---

## 1. Executive Summary

Citykart DESK is a Next.js 16 / Supabase(Postgres) service-desk application with no ORM (134 hand-written, sequential SQL migrations) and pervasive Row-Level-Security-based multi-tenancy. The ticket entity is `requests`; there is a separate, lighter-weight `tasks` entity for internal work items. Ticket creation runs entirely through one Next.js **Server Action**, `createRequest()` (`lib/actions/requests.ts:149-509`), which is tightly coupled to an authenticated browser session (cookies + a middleware-forwarded header) — it cannot be called from a bare webhook handler today.

The most important fact for a WhatsApp architect: **an email-based inbound-ticket channel ("Intake") already exists**, complete with webhook handlers (Gmail/Outlook), OAuth credential storage in Supabase Vault, an idempotent message-store pipeline, an AI/rule-based classifier, and a human triage UI. Its data model was **explicitly designed to be channel-agnostic** — the `intake_channel_type` enum already contains `'whatsapp'`, and the classifier's input shape (`IntakeEnvelope`) carries a code comment stating WhatsApp/Slack/Teams can populate it "with zero engine changes." The admin UI for configuring a WhatsApp intake channel already exists and is clickable — but it is **inert**: no WhatsApp webhook route, no credential/connect flow, and no ingestion worker exist yet.

However, the existing Intake module is also the strongest cautionary tale in this codebase: its own ticket-conversion path (`lib/actions/intake/work.ts`) does **not** reuse `createRequest()`. It hand-rolls a second, independent `INSERT INTO requests`, and in doing so it silently **drops SLA initialization, Business-Rule-based auto-assignment, and team-member notifications** for every intake-created ticket. This is concrete, present-day evidence of what happens when a second channel is bolted onto this schema without also refactoring the shared business logic — and it is the single most important risk a WhatsApp implementation must not repeat.

**Overall readiness rating: PARTIALLY READY — strong schema and channel-agnostic classification foundation, but the reusable "create a fully-governed ticket" business logic does not yet exist as a callable, channel-agnostic function, and several supporting capabilities (phone-to-employee identity, duplicate detection, draft/resume, master-data search APis for stores/departments, an "Issue" taxonomy level) do not exist at all.**

---

## 2. Current Architecture

### Stack (CONFIRMED)
- **Frontend:** Next.js 16.2.9 (App Router), React 19.2.4, TypeScript. Tailwind CSS 4 + shadcn/ui (`components.json`, `@base-ui/react`) + `lucide-react`. Forms: `react-hook-form` + `zod` (zod is used only for the auth screens — login/forgot-password/reset-password — **not** for the request-creation form, which uses a hand-rolled validator; see §5, §6).
- **Backend:** Two coexisting surfaces in the same repo:
  1. **Next.js App Router backend** — mutations go through **Server Actions** (`'use server'` functions in `lib/actions/**`, ~17 files) rather than REST; a small number of **Route Handlers** under `app/api/**` exist only for things an external caller (cron, webhook) needs to hit: `health`, `alerts/run`, `business-rules/run`, `desktime/sync`, `admin/audit`, and `intake/{webhook/gmail, webhook/outlook, oauth/callback, cron/classify}`.
  2. **Standalone Express service** at `api/src/index.ts` ("citykart-api") — a **separate deployable Node process**, not in-process with the Next.js app, coordinating only via the shared Postgres database. It runs its own `setInterval` mailbox poller for the email-intake pipeline (IMAP/Gmail-sync/Graph-sync → parse → classify → store). **UNKNOWN** whether this service is actually deployed in the current Railway setup — no `api/Dockerfile` or `api/railway.toml` was found in the repo (only the root app has deployment config).
- **Database:** PostgreSQL via Supabase. **No ORM** — 134 raw, sequentially-numbered SQL migration files (`supabase/migrations/20240101000000_...` through `...000132_...`). No Prisma/Drizzle/TypeORM/Knex anywhere in the repo.
- **Auth:** Supabase Auth via `@supabase/ssr`, cookie/JWT-based. Three Supabase client factories with distinct trust levels: `lib/supabase/client.ts` (browser, RLS-scoped), `lib/supabase/server.ts` (server, RLS-scoped, reads `next/headers` cookies), `lib/supabase/admin.ts` (service-role, **bypasses RLS**, used only server-side). **No `middleware.ts`** exists in the repo — session-refresh is per-request, not centrally enforced (a stale code comment in `server.ts` claims otherwise).
- **API architecture:** Server Actions (dominant), a handful of REST Route Handlers for external callers. No tRPC, no GraphQL.
- **Multi-tenancy:** CONFIRMED — `organizations`/`org_id` is wired through virtually every table and every RLS policy (migrations 032, 033, 080, 121). **The project's own `docs/ARCHITECTURE.md` claims the app is single-tenant — this is stale and contradicted by the live schema.** Treat that doc, and `docs/DATABASE.md` (self-flagged stale past migration 087), as historical snapshots, not current truth.
- **Background jobs/workers:** No durable job queue (no BullMQ/Sidekiq-equivalent). Scheduled work is driven by **external HTTP pings**: `scripts/cron-tick.mjs` is invoked by Railway's native cron feature and calls `GET /api/{alerts,business-rules}/run`, `/api/desktime/sync`, `/api/intake/cron/classify` with an `x-cron-secret` header. The separate Express service additionally runs its own always-on `setInterval` poller.
- **Cache:** NOT FOUND — no Redis/Upstash/memcached anywhere. `lib/rate-limit.ts` is explicitly in-process/per-replica only, with a code comment noting Redis would be needed at scale.
- **Queue/message broker:** NOT FOUND.
- **File storage:** Supabase Storage, private buckets (`request-attachments`, `task-attachments`, `intake-attachments`), signed-URL-only access, all writes via the service-role admin client.
- **Notifications:** Three real channels — in-app (`notifications` table), email (Resend, called directly via `fetch()` from the Next app; the separate Express service uses `nodemailer`/SMTP instead — these are two independent email-sending implementations), and web push (`web-push`/VAPID, silently no-ops if unconfigured). No SMS. WhatsApp exists only as an unused enum value.
- **Deployment:** Railway, Docker (`railway.toml`, `Dockerfile`, 3-stage build, `TZ=Asia/Kolkata` set explicitly because SLA/business-hours math must resolve in India time).
- **Third-party integrations found:** `@supabase/ssr`/`@supabase/supabase-js`, `web-push`, `exceljs` (root app); `@anthropic-ai/sdk` (AI-assisted email classification), `imapflow`, `mailparser`, `nodemailer`, `resend` (declared but unused), `express` (the separate `api/` service).

### Architecture diagram (as found)

```
                         ┌────────────────────────────┐
                         │      Browser (React 19)     │
                         └──────────────┬───────────────┘
                                        │ HTTPS
                    ┌───────────────────▼────────────────────┐
                    │   Railway: Next.js 16 (App Router)      │
                    │   proxy.ts (Edge: session refresh,      │
                    │             auth redirects, cron/webhook│
                    │             allowlist)                  │
                    │                                          │
                    │  app/(app)/**            app/api/**      │
                    │  RSC + Server Actions     Route handlers │
                    │  lib/actions/*  ◄──┐      /health         │
                    │  (createRequest,   │      /alerts/run      │
                    │   createTask,      │      /business-rules/run│
                    │   approvals, ...)  │      /desktime/sync    │
                    │                    │      /intake/cron/classify│
                    │  lib/notifications │      /intake/oauth/*   │
                    │  lib/email  ──fetch()──► Resend HTTP API   │
                    │  lib/push   ──────────► Web Push (VAPID)   │
                    │  lib/sla, lib/rules, lib/routing           │
                    └───────────┬───────────────────┬────────────┘
                                │ @supabase/ssr      │ service-role
                                │ (RLS-enforced)      │ (RLS-bypass, admin.ts)
                                ▼                     ▼
                    ┌────────────────────────────────────────┐
                    │   Supabase (Postgres + Auth + Storage)   │
                    │   134 raw SQL migrations, no ORM         │
                    │   RLS on every table; org_id multi-tenant│
                    │   Storage buckets: request-attachments,  │
                    │   task-attachments, intake-attachments   │
                    └───────────────┬──────────────────────────┘
                                    │ shared DB (no direct RPC)
                    ┌───────────────▼──────────────────────────┐
                    │  api/src (Express, separate process)      │
                    │  citykart-api — Intake email ingestion    │
                    │  IMAP / Gmail-sync / Graph-sync pollers   │
                    │  mailparser → classify (rule + Anthropic  │
                    │  SDK local-model) → intake_* tables       │
                    │  own setInterval scheduler                │
                    └────────────────────────────────────────────┘

External cron: Railway "Cron Schedule" service running
  `node scripts/cron-tick.mjs` → GET https://<app>/api/{alerts,business-rules}/run
  (x-cron-secret header) — no queue/broker, no Redis.
```

---

## 3. Ticket Data Model

The primary ticket entity is `requests` (base: `supabase/migrations/20240101000000_initial_schema.sql:267-289`, no columns ever dropped/renamed per exhaustive grep of all 134 migrations).

| Field | DB Type | Required | Default | Source | Meaning |
|---|---|---|---|---|---|
| `id` | UUID | Yes (PK) | `gen_random_uuid()` | initial schema | Ticket ID |
| `request_no` | TEXT | Yes, UNIQUE | trigger-generated | initial schema; format changed by migrations 112, then 117 | Human ticket number, current format `CKSD-000001` |
| `title` | TEXT | Yes | — | initial schema | Subject/title (no separate "issue" field — see §4) |
| `description` | TEXT | No | — | initial schema | Free-text description |
| `requester_id` | UUID → `profiles` | Yes | — | initial schema | Requester. **No distinct `created_by`/creator column** — see below |
| `assigned_to` | UUID → `profiles` | No | — | initial schema | Assigned agent |
| `service_id` | UUID → `services` | Yes | — | initial schema | Service (catalog item) |
| `team_id` | UUID → `teams` | Yes | — | initial schema | Assignment group |
| `priority` | enum `low/medium/high/urgent` | Yes | `'medium'` | initial schema | Single priority axis — **no separate impact/urgency columns exist anywhere** |
| `status` | enum (8 values, see §14) | Yes | `'open'` | initial schema | Ticket status |
| `form_data` | JSONB | Yes | `{}` | initial schema | Dynamic/custom field values (no discrete columns) |
| `form_schema_snapshot` / `form_sections_snapshot` | JSONB | Yes | `[]` | initial schema / migration 004 | Immutable snapshot of the form as it was at submission |
| `response_due_at`, `resolution_due_at`, `responded_at`, `resolved_at`, `closed_at` | TIMESTAMPTZ | No (SLA fields required to be null-safe) | — | initial schema | SLA + lifecycle timestamps |
| `created_at`, `updated_at` | TIMESTAMPTZ | Yes | `now()` | initial schema | Standard |
| `waiting_since` | TIMESTAMPTZ | No | — | migration 010 | SLA-pause tracking start |
| `org_id` | UUID → `organizations` | Yes (NOT NULL since 121) | backfilled | migrations 033, 121 | Tenant isolation |
| `intake_message_id` | UUID → `intake_messages`, `ON DELETE SET NULL` | No | — | migration 056 | Reverse link to the inbound email that created this ticket — **the closest thing to a channel marker that exists** |
| `source_metadata` | JSONB | No | — | migration 056 | Free-form provenance blob, **no enum/CHECK constraint** — populated only by the intake conversion path today (`created_via: 'intake'` literal) |
| `parent_request_id` | UUID → `requests`, self-FK | No | — | migration 068 | Single-level sub-request hierarchy (possibly a dormant/removed feature per `HANDOVER.md` — verify live UI usage before relying on it) |
| `project_id` | UUID → `projects`, `ON DELETE SET NULL` | No | — | migration 073 | Optional Projects-module link |
| `category_id`, `sub_category_id` | UUID → `service_categories`/`service_sub_categories` | No | — | migration 109 | Category, selected **at submission time**, not derived from the service |
| `cancellation_reason` | TEXT, CHECK (`approval_rejected`,`manual`) | No | — | migration 114 | Distinguishes reopenable vs. permanent cancellation |
| `reopen_deadline_at`, `reopen_count` | TIMESTAMPTZ / INTEGER | No / Yes (`0`) | — / `0` | migration 114 | Reopen window bookkeeping |
| `pre_approval_status` | enum (nullable) | No | — | migration 124 | Status snapshot before "Send for Approval," so resume restores it correctly |
| `paused_ms_total` | BIGINT | Yes | `0` | migration 125 | Append-only ledger of completed SLA pauses (recent bug fix — see §11) |

**Explicitly NOT FOUND on `requests`:** a distinct "Issue" field, impact/urgency columns, a `department`/`store`/`location` column (both are only reachable indirectly — department via `team_id → teams.department_id`, store/location via `requester_id → profiles.store_id`/`location_id`), a current approval-status column (real state lives in separate `approvals`/`approval_decisions` tables), an escalation-tier column (lives in `sla_escalation_events`, itself largely dead — see §12), and any generic `source`/`channel`/`created_via` **column** (only the intake-specific `intake_message_id`/`source_metadata` pair exists, and only intake-created tickets populate it).

**Attachments:** `request_attachments` (`request_id` FK, `uploaded_by` NOT NULL FK, `file_name`, `file_size` CHECK ≤25MB, `mime_type`, `storage_path` unique, `is_internal`, `comment_id` nullable FK, `deleted_at` soft delete).

### `tasks` vs. `requests` — the conceptual difference (important, easy to conflate)

A **`request`** is the formal, SLA-governed, approval-capable service-desk ticket: must originate from a `service_id`, carries SLA deadline fields, can require multi-step approvals, has an 8-state status lifecycle. A **`task`** (`tasks` table, `initial_schema.sql:369-385`) is a lighter-weight work item — `personal` or `team`-scoped, 4-state lifecycle (`open/in_progress/done/cancelled`), no SLA, no approval workflow, no service-catalog origin requirement. Tasks **do** have an explicit `created_by` column (unlike requests) and an optional one-way `request_id` FK (a task can be spawned from a ticket, but is not a sub-type of one). Fully separate route trees, server-action files, query modules, and activity-log enums exist for each. **Do not conflate "task" with "ticket" when scoping WhatsApp — the ticket entity is `requests`.**

### Simplified ER diagram

```
organizations 1───* requests *───1 services *───1 service_categories
                       │  │  │                 └──1 service_sub_categories
        profiles 1─────┘  │  └───1 teams ───1 departments
     (requester_id,       │
      assigned_to)        │
     requests.id  1───────┼────────* request_comments (author_id → profiles)
                  1────────┼────────* request_activity (actor_id → profiles) [append-only]
                  1────────┼────────* request_attachments (uploaded_by → profiles)
                  1────────┼────────* request_collaborators / request_time_entries
                  1────────┼──(0..1)─ approvals ──1──* approval_decisions
                           │             └──1 approval_workflows ──1──* approval_workflow_steps
                  1────────┼──(0..*)── sla_escalation_events (rule_id → sla_escalation_rules) [dead]
                  1────────┼──(0..*)── tasks (request_id, ON DELETE SET NULL — optional link)
              self-FK ─────┘ parent_request_id → requests.id (0..1 parent)
                  (0..1) intake_messages ◄── intake_message_id (email-intake provenance)
                  (0..1) projects ◄── project_id
```

---

## 4. Service Catalogue & Issue Taxonomy

### The actual hierarchy (verified — not the naive 4-level assumption)

```
service_categories  (top-level bucket, e.g. "Hardware")
      └─ service_sub_categories  (e.g. "Laptop Repair")
               ▲  1-to-1 constrained (UNIQUE on sub_category_id)
               │
service_sub_category_tags  (junction: service_id ↔ sub_category_id)
               │
services  (e.g. "IT" — a broad service, NOT itself scoped to one category)
```

**Critical, load-bearing finding: `services.category_id`/`services.sub_category_id` were deliberately dropped** (migration 118, "exclusive_category_service_tag"). A service no longer belongs to a fixed category. Instead, **category/sub-category selection happens inside the ticket submission form itself** (`requests.category_id`/`sub_category_id`, added in the same migration) — the requester picks it as a built-in form field, not by browsing a tree. This is explicitly documented in a code comment: *"Service Catalog is a flat list now — a broad service ... no longer has one fixed category to browse through; category is a field the requester picks inside the submission form itself"* (`app/(app)/services/page.tsx`).

**There is no "Issue" or "Issue Type" table anywhere in the schema — CONFIRMED NOT FOUND** (zero matches across all 134 migrations for `issue_type`/`ticket_type`/`request_type`). The deepest structural entity is the **Sub-Category**. Anything more granular ("printer jam," "VPN not connecting") exists only as an option inside a service's own dynamic dropdown field (see §6) — not a queryable catalogue table. A service's `keywords TEXT[]` array and full-text search index are the only "search alias" mechanism, and they operate at the **Service** level, not at a finer issue level.

### Entity detail

| Entity | PK | Parent | Active flag | Order | SLA mapping | Assignment mapping | Custom-field mapping | Approval mapping | Search/alias |
|---|---|---|---|---|---|---|---|---|---|
| `service_categories` | `id` | none (top) | `is_active` | `sort_order` | — | — | — | — | none |
| `service_sub_categories` | `id` | `category_id` | `is_active` | `sort_order` | `sla_priority` label only (no hours of its own) | — | — | — | none |
| `services` | `id` | none (untagged to category) | `is_active` | `sort_order` | `sla_policy_id → sla_policies` | `team_id` (coarse); fine-grained routing via Business Rules | `form_sections`/`form_fields` JSONB, or `template_id → form_templates` | `approval_workflow_id → approval_workflows` (nullable) | `keywords TEXT[]` + full-text GIN index on name+description |

Admin UI: `app/(app)/admin/categories/CategoriesAdminClient.tsx` manages categories/sub-categories; `app/(app)/admin/services/ServicesAdminClient.tsx` (901 lines) manages services, including sub-category tagging via an RPC (`retag_service_categories`) and location-visibility tagging (`retag_service_locations`).

### Sample catalogue data (Part D)

**Source:** `supabase/seed.sql` — the only real sample data in the repo. **Caveat (schema-drift bug, flagged, not in scope to fix):** `seed.sql` inserts against columns (`services.category_id`, `services.sub_category_id`, `services.sla_config`) that were later **dropped** by migrations 118/110 — running it as-is against a fully-migrated DB would fail. With that caveat, the intended shape:

| Service | Category | Sub-Category | Issue (illustrative form dropdown — not a real column) | Active |
|---|---|---|---|---|
| Laptop Request | Hardware | Computers & Laptops | Reason: New hire / Replacement / Upgrade | true |
| Equipment Repair | Hardware | Peripherals & Repair | Device type: Laptop / Monitor / Keyboard-Mouse / Other | true |
| Software Installation | Software & Access | Software Installation | free-text | true |
| Access Request | Software & Access | Access & Permissions | Access level: Read only / Read-write / Admin | true |
| New Employee Onboarding | People & HR | Onboarding | Equipment needed (multiselect) | true |
| HR General Inquiry | People & HR | HR Support | Topic: Payroll / Benefits / Leave / Policy / Other | true |
| Office Supplies | Facilities | Office Supplies | free-text | true |
| Maintenance Request | Facilities | Building & Maintenance | Issue type: Lighting / HVAC / Plumbing / Cleaning / Security / Other | true |

Only 8 services exist in the seed data (fewer than the requested 10-20 — the repo simply doesn't contain more).

---

## 5. Current Ticket ("Request") Creation Flow — end to end

**Entry:** `app/(app)/services/[slug]/page.tsx` (Server Component) loads the service, the allowed sub-categories, and the requester's own store address, then renders `<DynamicForm>`.

**Client (`components/forms/DynamicForm.tsx`, `'use client'`):**
- Category/sub-category picker rendered as an **in-form field**, not a browse hierarchy.
- Field schema resolved via `resolveServiceFormSections(service)` then filtered for requester-visibility.
- `store_address` pre-populated read-only from the requester's store.
- Optional "book on behalf of" picker (agent/manager/admin/platform_owner only) — typeahead over `searchOrgMembers`.
- Client-side validation: `validateFields()` (`lib/validation/formFields.ts`) — **hand-rolled, not Zod**, explicitly shared with the server ("so the two can never drift out of sync").
- Submit builds a `FormData` and calls **`createRequest(formData)`**, a Next.js **Server Action** — there is **no `app/api/requests` route**.
- File fields are uploaded *after* a real `requestId` exists, one at a time via a second server action.

**`createRequest()` (`lib/actions/requests.ts:149-509`), in order:**
1. `supabase.auth.getUser()` (cookie session) — no session, no ticket.
2. Module-enabled gate (`requests` module must be on for the org).
3. Server re-validates "book on behalf of" (role + same-org), never trusts the client.
4. Parses `form_data` JSON.
5. Re-fetches the service and re-validates location scope server-side.
6. **Derives `category_id` server-side** from `sub_category_id` — never trusts a client-submitted category.
7. Resolves the form schema (template wins over legacy flat fields).
8. Resolves the requester's store; **forcibly overwrites `store_address`** server-side regardless of client payload.
9. Runs `validateFieldValue()` per field — the real validation gate (file-type required-ness is a known, documented client-only limitation).
10. Derives `title` from the first meaningful field, or falls back to `service.name`.
11. Resolves `priority` from `sub_category.sla_priority ?? service.default_priority` — **never from client input** (see §10).
12. Resolves SLA deadlines (`resolveSlaDeadlines()`) — layered `field_sla_overrides → sla_policies[priority] → null`.
13. Inserts into `requests` (ticket number is a placeholder `''`, overwritten by a DB trigger).
14. **Business Rules `created`-trigger fires** (`runRulesForTrigger('created', ...)`) — may assign, set priority/status/team, or notify, depending on configured rules. Failure is swallowed.
15. Activity log entry (`created`).
16. Optional OEM auto-routing (email + comment + possible auto-transition to `in_progress`).
17. Notifications (fire-and-forget) to the actual requester (if booked on behalf) and to the assigned team's members.
18. **Approval is explicitly NOT initiated here** — a code comment states this is deliberate; approval is always a separate, later, human-triggered action.
19. Returns `{ requestId }` to the client, which then uploads any pending files and client-navigates to the ticket detail page.

**Ticket numbering** is entirely a Postgres `BEFORE INSERT` trigger (`trg_assign_request_no` → `generate_request_no()`), invisible to and untouched by any application code — this part is genuinely channel-agnostic already (any INSERT into `requests`, from any code path, gets a correct atomic number).

### Sequence diagram (as found)

```
Requester        DynamicForm.tsx        createRequest()            Postgres                lib/rules + lib/notifications
   │                    │                     │                       │                              │
GET /services/[slug] ──────────────────────────────────────────────►│ (RSC fetch: service, subcats, store)
   │◄── form ───────────┤                     │                       │                              │
   │  fill + validate ─►│ validateFields()     │                       │                              │
   │  submit ───────────►│ build FormData      │                       │                              │
   │                    │──createRequest(fd)──►│ auth.getUser()         │                              │
   │                    │                     │ re-validate everything │                              │
   │                    │                     │ resolve priority/SLA   │                              │
   │                    │                     │ INSERT requests ──────►│ trigger: assign request_no   │
   │                    │                     │◄── {id, request_no} ───┤                              │
   │                    │                     │ runRulesForTrigger('created') ──────────────────────►│ match rules: assign/priority/status/notify
   │                    │                     │ logActivity('created')│                              │
   │                    │                     │ notify() (team, on-behalf) ─────────────────────────►│ notifications insert
   │                    │◄── {requestId} ──────┤                       │                              │
   │                    │── uploadAttachment() (per file) ────────────►│                              │
   │◄── navigate to /requests/{id} ─────────── │                       │                              │
```

---

## 6. Dynamic / Custom Field Engine

**Two separate engines exist — do not conflate:** (1) `task_custom_fields`/`task_custom_field_values` — scoped to Tasks only, a small EAV-style engine, **not relevant to service/request intake**. (2) The **service/request intake engine** — relevant to WhatsApp.

**Storage:** JSON columns, not EAV. `services.form_sections JSONB` (array of sections, each with `fields[]`) is the field-definition store; a legacy flat `services.form_fields JSONB` is synthesized into a section automatically if `form_sections` is empty. Values land in `requests.form_data JSONB`; `form_sections_snapshot`/`form_schema_snapshot` freeze the definitions used at submission time for immutable historical display. Service-to-field relationship is either inline, or indirected through a shared, **live** `form_templates` row (editing the template instantly changes every tagged service's form).

**Supported field types (exactly as found):** `text | textarea | number | date | select | multiselect | checkbox | radio | email | phone | file | toggle | store_address`. The current admin builder (`SectionBuilder.tsx`) only offers 11 of these — `checkbox`/`radio` are legacy types still rendered but no longer newly addable. **`store_address` is the only master-linked field type** — system-populated from `stores.address` via the requester's `profiles.store_id`, never free text. No `employee`/`store`/`vendor`/`asset` picker field types exist as such; "book on behalf of" is a separate hard-coded UI feature, not a generic field type.

**Other attributes:** required-ness is audience-aware (`requester_can_view`/`requester_can_set` — separately govern whether the requester or the technician must fill it); display order is a plain integer; validation is the same hand-rolled module used client- and server-side (`lib/validation/formFields.ts`); **no conditional visibility/dependency logic exists at all** (no `depends_on`/`visible_if`); no per-field default value (a type-based empty default is computed at render time); dropdown/multiselect options support a nested `children[]` tree (grouped options) with soft-archival (`is_active`).

### Can the existing field engine drive WhatsApp questions without a parallel config system?

**PARTIALLY.**
- **Yes for data/validation:** field definitions are plain, React-free JSON, and `validateFieldValue()`/`validateFields()` are pure `(field, value) → result` functions with zero DOM dependency — directly reusable to validate a WhatsApp-collected answer with no rendering involved. Each field already carries everything needed for a text prompt (label, help text, required, options list).
- **No, a rendering layer must be built:** there is no text-channel equivalent of `FieldRenderer.tsx` (the React component tree) — a new, small interpreter that walks `FormField[]` and emits WhatsApp list/button prompts per type would need to be written. This is normal, expected new work, not evidence of deep coupling.
- **Genuine gaps for a chat UX:** no conditional-question logic (every visible field must be asked, in order, regardless of prior answers); `store_address` and `file` types need bespoke channel-specific handling; nested option trees don't map 1:1 onto WhatsApp's flat list-message UI (≤10 items).

---

## 7. Master Data & Search

**Governing finding:** ticket custom-field values that reference a master entity (e.g. a "Store" dropdown) are stored as **hand-authored `{value,label}` static option strings inside JSONB**, never as the master's row ID. Even the one FK-derived field type, `store_address`, denormalizes to a **text snapshot** at submission time, not a live FK. **No ticket/task custom field can be reliably resolved back to a specific master row today** — a WhatsApp bot cannot trust an existing field value as an ID; either a true FK-typed field must be added, or label text must be fuzzy-matched.

| Master | Model | Existing API | Search Supported | Pagination | Suitable for WhatsApp |
|---|---|---|---|---|---|
| Employee/User | `profiles` | Yes — 6+ near-duplicate search functions (`searchProfiles`, `searchOrgMembers`, `searchAgentTierMembers`, `searchUsersForDelegation`, `searchManagersForApproval`, `searchAgentsForRequest`) | Yes — case-insensitive `ilike`, backed by a real trigram index | No true pagination — hard `.limit(8-10)` | **YES** — best-suited master in the codebase; returns `{id, full_name}` |
| Store | `stores` | No dedicated search — CRUD only, one single-row lookup exists for request-form auto-fill | No | No — full table fetched unfiltered | Needs a small new `searchStores()` action; not a redesign |
| Location | `locations` | CRUD only | No | No | Small, coarse set (HO/Stores/Warehouse) — full-list menu works, but no API serves it that way |
| Department | `departments` | CRUD only | No | No | Needs a new search action |
| Team | `teams` | No dedicated search | No | No | Needs a new search action (set is likely small) |
| Agent (support tier) | `profiles.role='agent'` + `team_members` | Yes — same infra as Employee, filtered to agent-tier roles | Yes | Same cap | **YES** |
| Vendor (OEM) | `oems` | CRUD only | No | No | Org-level list is small; needs a search wrapper |
| Asset | **NOT FOUND** | — | — | — | Entity does not exist in this system at all |
| Project | `projects` | Yes — `getProjects()`, ilike name/description/owner | Yes | Yes — real page/pageSize/`range()` with exact count, the best pagination pattern in the repo | **YES**, but trim the returned columns for a WhatsApp caller |
| Cost center | `cost_centers` | CRUD only | No | No | Needs a new search action |
| Job Function / Designation | `job_functions`, `designations` | CRUD only | No | No | Needs a new search action |
| Tag | `tags` | Create/delete only | No | No | Tiny seeded set; full-list works |

---

## 8. User / Employee Identity

**One unified `profiles` table**, a 1:1 extension of Supabase `auth.users` — **no separate employee master**. Fields confirmed present: `department_id`, `location_id`, `cost_center_id`, `employee_id` (TEXT, **no UNIQUE constraint** — duplicates possible), `job_title`, `manager_id` (self-referential FK), `store_id`, `function_id`/`designation_id`, `role` (enum: `user, agent, manager, admin, platform_owner`), `is_active`, `org_id`. **Email is not a `profiles` column at all** — it lives solely in Supabase Auth, and every screen that needs it makes a second call to the Auth Admin API and joins in application code.

### Can identify employee using mobile number: **NO.**

- **`profiles` has zero phone/mobile column, confirmed by exhaustive grep and by the full generated `types/database.ts` row shape.** There is nothing today for an inbound WhatsApp number to even be compared against.
- The only phone-shaped data anywhere in the schema is a **per-ticket dynamic form field** of type `phone` — free text entered per-ticket, unrelated to the user record, unindexed, unvalidated for uniqueness, and (per §7) stored as a plain JSONB string.
- The bulk-user-import CSV format (`components/admin/BulkImportUsersDialog.tsx`) has **never** captured a phone/mobile column — so even if a `phone` column were added today, every existing organization's `profiles` rows would start 100% empty on it; a backfill/onboarding step would be mandatory.
- No WhatsApp identity-mapping table, code path, or resolver exists anywhere (grep across `lib/`, `app/`, `components/` for "whatsapp" finds only the unused `ChannelType` enum entry).
- No store-level phone number exists either (`stores` has no phone/contact column), so the "shared store phone → multiple requesters" scenario isn't even representable today.

**What would be needed at minimum:** a normalized `phone`/`mobile` column on `profiles` (with an E.164-aware normalization convention — the existing 10-digit-domestic `PHONE_REGEX` used for ticket form fields does not handle WhatsApp's `+91XXXXXXXXXX` format and would need new logic), a uniqueness constraint, an explicit decision on shared/generic store accounts (e.g. `sm.<code>@citykartstores.com`-style accounts already exist for stores — the same ambiguity would apply to a shared store WhatsApp line), and explicit handling of what happens to a phone mapping when `is_active` flips to false.

---

## 9. Assignment Engine

**Two mechanisms exist; only one is live.** `assignment_rules` (migration 020) is **CONFIRMED dead code** — explicitly left in place only as a rollback path (migration 096's own comment), zero application references. The **live mechanism is the generic Business Rules engine** (`business_rules` table + `lib/rules/evaluate.ts`/`actions.ts`/`run.ts`), which can condition on service/category/sub-category/team/project/priority/requester (role, department, location, designation, function)/SLA-breach state/attachments/age/any dynamic form field, and assign via `direct`, `round_robin` (cursor persisted on the rule row), or `load_balanced` (fewest-open-tickets) strategies — always re-validated against actual team membership before writing.

**Manual assignment** (`assignRequest()`) is separately RBAC-gated: agents can only assign within their own team; managers/admins can cross-team assign.

### Does assignment run automatically for API/webhook-created tickets? **NO — confirmed by evidence, not inference.**

- **There is no DB trigger for assignment** — the only `AFTER/BEFORE INSERT` triggers on `requests` are ticket-numbering and `org_id` backfill. Assignment is purely application code, invoked at exactly one call site inside `createRequest()`.
- **The existing email-intake ticket-creation path (`lib/actions/intake/work.ts`) does NOT call `runRulesForTrigger()` at all** — grepped, zero matches. So business-rule-based auto-assignment **never fires** for intake-created tickets today.
- The `intake_channel_type` enum already includes `'whatsapp'`, meaning a WhatsApp integration would very naturally be built by extending this same intake-conversion code path — **which would inherit this exact gap** unless the conversion code is changed to call `runRulesForTrigger('created', ...)` (or the whole creation path is refactored per §21).

---

## 10. Priority / Impact / Urgency

**No impact/urgency concept exists anywhere** — grep confirms zero hits across all migrations and application code. There is **no ITIL-style Impact × Urgency → Priority matrix**. Priority is a single enum (`low/medium/high/urgent`).

**Two different determination logics by channel, both already avoiding "trust the caller":**
1. **Web/portal path:** `priority = subCategory.sla_priority ?? service.default_priority` — a deterministic, admin-configured mapping, **never** taken from user/client input.
2. **Email-intake path:** `mapPriorityToRequest(decision.final_priority)` where `final_priority` is a **human reviewer's** decision in the Intake Review UI, defaulting to an **AI classifier's suggestion** — never taken verbatim from the raw email content either.

Priority is the sole key into SLA resolution (`resolveSlaDeadlines(priority)`).

### Should WhatsApp send priority, or should DESK calculate it?

**DESK should calculate it, following the existing precedent exactly.** Neither existing channel trusts a caller-supplied priority string. If WhatsApp were allowed to self-report "urgent," it would bypass the admin-controlled Sub-Category→SLA mapping every other channel is forced through and create a trivial SLA-gaming vector. The correct pattern (mirroring email intake) is: a WhatsApp-supplied signal, if any, should feed a **suggestion** that is then resolved the same deterministic way (Sub-Category/Service default), or — if urgency truly needs to vary by conversation content — routed through the same classification+review discipline the email channel already uses.

---

## 11. SLA Engine

**Model:** `sla_policies` (org-scoped, named, `config JSONB` keyed by priority tier → `{response_hours, resolution_hours}`), mapped 1:many from `services.sla_policy_id`. A **more specific** override layer, `field_sla_overrides`, applies per `(service, field, option-value, priority)` and wins over the policy (atomic upsert via a Postgres function that also enforces `resolution_hours > response_hours`). **There is deliberately no org-wide default layer beneath that** — a service/field combination with no explicit override simply gets **no SLA deadline at all** (the legacy `global_sla_config`/"SLA Targets" screen was removed and is no longer read).

**Business hours & holidays:** `business_hours` (per day-of-week) + `holidays` (with recurrence) drive a business-hours-aware deadline calculator that deliberately returns `null` (with an operator alert) rather than a wrong multi-year-out date when the calendar is entirely unusable.

**Pause/resume — "pause-credit ledger" (recent hardening):** `requests.paused_ms_total` is an append-only ledger fixing a real bug where earlier SLA-recompute paths only credited a *currently active* pause, silently discarding time from a pause that had already completed before a later priority/category change.

**Breach detection:** three distinct, explicitly separate formulas (`isCurrentlyBreached`, `isEverBreached`/`isEverResponseBreached`) specifically to avoid drift between a live "needs attention today" count and a historical "did we hit the deadline" fact.

### Is SLA automatically initialized on ticket creation? **Exact code path, channel-dependent.**

- **Web/portal path — YES, synchronously, inline:** `resolveSlaDeadlines()` runs *before* the `INSERT`, and the resulting `response_due_at`/`resolution_due_at` are literal columns on that same insert. Not a trigger, not a cron backfill — application code inside `createRequest()`.
- **Email-intake path — CONFIRMED NO.** `lib/actions/intake/work.ts`'s direct insert has **no `response_due_at`/`resolution_due_at` keys at all**. Every intake-converted ticket lands with `NULL` SLA deadlines and is therefore **permanently exempt** from breach detection and from the SLA-percentage-elapsed escalation sweep (which explicitly filters `.not('resolution_due_at','is',null)`) — unless some *other* later action (a priority or category change) happens to set them. **This is the single most important concrete gap to fix before any WhatsApp-via-intake design ships**, since WhatsApp is most likely to be built by extending this same code path.

---

## 12. Escalation Engine

**`sla_escalation_rules`/`sla_escalation_events` are CONFIRMED dead/orphaned** — their processing route (`app/api/escalation/run`) no longer exists in the repo; zero non-migration references anywhere.

**Live escalation is split across two systems:** (1) `alert_rules` (processed by `app/api/alerts/run`) handles `due_soon`/`overdue`/`unassigned`/`daily_digest` — but its DB-level `sla_warning`/`sla_breached` values have **no handling branch in the cron processor and silently never fire** (explicitly documented and deliberately hidden from the admin UI for this exact reason). (2) The **Business Rules `schedule` trigger** (`sla_pct_elapsed`, `unassigned_minutes` checks) is the actual functioning replacement — escalation in this codebase is implemented as `notify`/`reassign`/`set_priority`/`set_status` **actions** of a scheduled rule, not a distinct escalation-tier concept. Cron wiring: `scripts/cron-tick.mjs` → `/api/business-rules/run`, secured by a shared `x-cron-secret` header.

### Would WhatsApp-created tickets automatically participate?

**Mechanically yes for the sweep itself** (it's a channel-agnostic cron query over `requests`, filtered by org/status/deadline — not tied to how the ticket was created) — **but only if `resolution_due_at` is non-null**, per §11's confirmed gap. A WhatsApp/intake-created ticket with a null SLA deadline is **structurally invisible** to the `sla_pct_elapsed` sweep, not merely unnotified. The `unassigned_minutes` check has no such dependency and would still catch an unassigned WhatsApp ticket by age.

---

## 13. Approval Engine

**Model:** `approval_workflows` (named container) → `approval_workflow_steps` (`approver_type`: `specific_user` | `any_manager`) → `approvals` (per-request instance, `current_step`, `status`) → `approval_decisions` (append-only). `services.approval_workflow_id` is the only structural link from a service to a workflow — **no amount thresholds, no conditional branching anywhere in the schema.**

**Sequential vs. parallel:** both coexist, distinguished by `approvals.current_step` — `0` is an explicit sentinel meaning "ad-hoc parallel" (every step's approver can decide independently; resolves once all decide, any single reject ends it immediately); a positive number means sequential (only the current step's approver can act).

**Approvers are determined by:** a static, admin-configured step (named user, or "any manager/admin/platform_owner") — **no manager-hierarchy/reporting-chain auto-resolution**, no conditional/amount-based selection.

### What determines whether a newly created ticket enters approval? **Nothing, automatically — always a deliberate, separate, human-triggered action.**

`createRequest()` never sets `status='pending_approval'` and its own code comment says so explicitly: *"Approvals are initiated manually by the solver via 'Send for Approval' — not auto-created here."* Entry into approval is always one of: (a) an agent/manager clicking "Send for Approval" on an *existing*, already-`in_progress`+ ticket (`submitForApproval()`), (b) an ad-hoc approval sent to arbitrary users (`sendAdHocApproval()`), or (c) — for email intake specifically — a **human reviewer explicitly choosing** `payload.type === 'approval'` in the Intake Review UI before conversion (never inferred automatically from category/service).

**A reachable configuration foot-gun, flagged for completeness:** a Business Rules `set_status` action can be configured to set a *new* ticket's status straight to `pending_approval` with **no approval workflow lookup and no approver ever assigned** — the exact failure mode `submitForApproval()` was hardened against, but unguarded in this path.

### Would an API/WhatsApp-created ticket automatically trigger approval? **No, following the current design intent** — and no generic ticket-creation API/WhatsApp channel exists yet regardless. If WhatsApp reuses the email-intake pattern, a human reviewer's explicit choice (or a future bot-side equivalent of that choice) would still be required to route a ticket into approval; there is no category/service-driven auto-gate at creation time anywhere in the system today.

---

## 14. Status Workflow

**Statuses (CONFIRMED, unchanged since initial schema):** `pending_approval, open, assigned, in_progress, waiting_user, resolved, closed, cancelled`. `closed`/`cancelled` are terminal.

**Transitions are a hard-coded, in-application state machine** (`lib/constants/request-transitions.ts`), explicitly documented as the single source of truth imported by both server and client — **not** a DB CHECK constraint, **not** a separately configurable table, but combined with a role check (agent-tier vs. requester) computed at call time. A few transitions are deliberately excluded from the generic matrix and hard-wired as special cases instead: `open/assigned → in_progress` only via the "Start Working" action (forces a mandatory first-response comment); `cancelled → assigned` (reopen) only when `cancellation_reason='approval_rejected'` and within the reopen deadline. A **second, parallel** status-mutation path exists via Business Rules' `set_status` action, gated only by "is this a valid status label" — **no role check, no transition-matrix check at all**, i.e. it can bypass the normal state machine entirely.

**Reopen/cancel/resolve:** two, and only two, reopenable terminal scenarios (both deadline-boxed): approval-rejected cancel → reopen (requester-only, returns to `assigned` with the same technician), and resolved → reopen ("not satisfied," time-boxed for the requester, no deadline for the agent's own ticket). A directly agent-cancelled ticket is permanent. A cron sweep (`autoCloseRequests()`) finalizes both flavors into `closed` once the window lapses.

---

## 15. Comments & Activity

**`request_comments`** (`id, request_id, author_id, body, is_internal, created_at` — unchanged schema since initial migration) is the human conversation surface; `is_internal=true` notes are agent-only. **`request_activity`** (`actor_id, action` enum, `metadata`) is a separate, append-only **system-event audit log** (status changes, assignment, approvals, comment-added markers, reclassification, form edits) — distinct in purpose from comments, and its INSERT is denied to `authenticated` (service-role only).

`addComment()` (`lib/actions/requests.ts`) is the single function behind every comment post, and is the natural reuse target for WhatsApp because it already does everything a bidirectional integration would want for free: first-response SLA stamping, activity logging, requester/assignee/collaborator notification fan-out, `@mention` resolution, and — critically — an **existing auto-transition**: a non-internal reply from the requester while status is `waiting_user` automatically flips the ticket back to `in_progress` and resumes the SLA clock. This is exactly the behavior a WhatsApp reply from a requester should trigger, and it already works.

**Gap:** `request_comments` has **no channel/source or external-message-id columns today** — unlike `requests.intake_message_id`/`source_metadata`, there is no existing scaffolding on the comment table for tracking which WhatsApp message a reply came from (needed for de-duplication/threading of inbound replies).

`task_comments`/`task_activity` are a **separate, duplicated** schema/RLS/enum set for the Tasks entity — not shared infrastructure with the request equivalents.

---

## 16. Attachments

Three **independent, near-identical** attachment subsystems exist: `request_attachments` (bucket `request-attachments`, via `uploadAttachment()`), `task_attachments` (bucket `task-attachments`, via `uploadTaskAttachment()`), and `intake_attachments` (bucket `intake-attachments`, via the separate Express worker's `storeAttachments()`). No code path copies rows between them.

**Security (recently hardened — commit `ab36139`):** MIME allowlist (checked client- and server-side), file-extension allowlist, and — the meaningful addition — **magic-byte/content-sniffing validation** server-side, closing the gap where a direct server-action call (bypassing the browser) could otherwise skip client-side checks. **`image/svg+xml` is deliberately excluded from every allowlist** because attachments are served via a direct signed-URL link with no `Content-Disposition` header, so an SVG's embedded script would execute in the browser — a documented stored-XSS defense. (Residual drift flagged: the underlying **Storage bucket's own** `allowed_mime_types` config, as captured in older migrations, still lists SVG — only the application-level checks were updated; unclear if a later, unlisted migration also fixed the bucket config.) **No virus/malware scanning exists** — only a placeholder comment (`VIRUS_SCAN_HOOK`) and an unused `scan_status` column that is written once as `'pending'` and never updated.

### Can WhatsApp media be inserted via the existing attachment service? **PARTIALLY.**

`uploadAttachment()` is a Server Action hard-gated on a cookie session and a real browser `File` object — **not callable as-is from a webhook** (no session, and a Buffer isn't a `File`). But the codebase already contains the exact right precedent: the email-intake pipeline's `storeAttachments()` (`api/src/intake/store.ts`) ingests attachments from a channel with **no user session**, using a **Buffer-based** validator (hand-kept in sync with the browser one, same allowlist/magic-byte logic) and the service-role client with `storage.upload(path, buffer, ...)`. A WhatsApp handler should mirror this pattern exactly (fetch media buffer from WhatsApp's Media API → validate with a Buffer-based validator → upload via service-role), not attempt to call the browser-oriented function. One structural caveat: `request_attachments`/`task_attachments` require a NOT-NULL `uploaded_by → profiles` FK, so a synthetic "system/WhatsApp" profile (or a resolved requester profile) would be needed as the target — `intake_attachments` has no such requirement, making a parallel intake-style table the more natural fit than writing directly into `request_attachments`.

---

## 17. Notification Engine

**Central dispatch is well-abstracted:** `notify()` (`lib/notifications.ts`) is the single choke point virtually every call site uses. It checks per-user opt-outs (`notification_preferences`) and per-org channel toggles (`notification_rules`), then dispatches independently, per-recipient, fire-and-forget, to three channel blocks: in-app (`notifications` table insert), email (dynamic import → Resend via `fetch`), and push (dynamic import → `web-push`/VAPID).

| Event | Existing | Current Channels | Reusable for WhatsApp |
|---|---|---|---|
| Ticket Created | CONFIRMED | in-app, email, push | Yes |
| Assigned (+reassigned/unassigned) | CONFIRMED | in-app, email, push | Yes |
| Status Changed | CONFIRMED | in-app, email, push | Yes |
| Comment Added (+internal/@mention) | CONFIRMED | in-app, email, push | Yes |
| Information Required | INFERRED (piggybacks on `status_changed` for `waiting_user`, no distinct copy/template) | in-app, email, push | Partially |
| Approval Required / Approved / Rejected | CONFIRMED (3 distinct types) | in-app, email, push | Yes |
| SLA Warning | Enum value exists but **CONFIRMED dead** — no call site fires it | None | No — must be wired up first |
| Escalated | **NOT FOUND** as a distinct event type | — | No — needs a new enum value + call site |
| Resolved / Closed (+auto-closed/cancelled) / Reopened | CONFIRMED | in-app, email, push | Yes |

**Assessment:** adding WhatsApp as a fourth channel is architecturally a small, additive change in the Next.js app — a new sender module, a new `notification_rules` column, one new dispatch block modeled exactly on the existing push block. **Two real caveats:** (1) `alert_rules.channels` is a **separately maintained**, narrower channel list (`in_app`/`email` only) used for due-soon/overdue/unassigned/daily-digest alerts — it would need its own WhatsApp addition if those alert types should also reach WhatsApp; (2) the **email-sending layer is itself duplicated** between the Next app (`fetch()` directly to Resend's REST API) and the separate Express service (`nodemailer`/SMTP) — `api/`'s declared `resend` npm dependency is never actually imported. Since a WhatsApp webhook most naturally lives alongside the email-intake worker in `api/src/`, and `api/` has **no import path into `lib/notifications.ts`** (it's a separate deployable), a WhatsApp sender will most likely need to be its own independent module, not a literal import of `notify()`.

---

## 18. Existing Integration / Webhook Architecture (the most important section)

An email-based inbound channel — **"Intake"** — already exists end to end, and is the direct architectural precedent for WhatsApp.

**Incoming webhooks:** `app/api/intake/webhook/gmail/route.ts` (Google Pub/Sub push, auth via a static shared-secret **query-string token**, constant-time-compared, deliberately separate from the higher-privilege worker secret; payload is a pointer — actual mail fetched later via the Gmail API) and `app/api/intake/webhook/outlook/route.ts` (Microsoft Graph change notifications; `GET` handles the subscription-validation handshake, `POST` verifies via Graph's `clientState`, same token). **Both routes always return 200 OK** even on bad/duplicate requests, by design, to stop provider retry storms. Both are thin verify-and-relay layers — they never touch `intake_messages` directly; they fire-and-forget a call to the separate Express worker (`INTAKE_WORKER_URL`) with its own `x-intake-worker-secret` header.

**OAuth/credentials:** `app/api/intake/oauth/callback/route.ts` exchanges an auth code for a refresh token and persists it via a `SECURITY DEFINER` RPC into **Supabase Vault** — never a plaintext column. WhatsApp Business (a permanent system-user token + phone-number-id, not a 3-legged OAuth flow) would need a **new** credential code path here, not just a new provider branch.

**Idempotency (multi-layered):** an `external_message_id` lookup guard, a DB-level `UNIQUE(org_id, channel_id, external_message_id)` backstop, a content-based dedup hash column (written but **not currently queried back** — present but apparently unused today), and idempotent thread upserts keyed on `(org_id, channel_id, external_thread_key)`.

**Provider abstraction — the key design fact:** the **classification pipeline is already fully channel-agnostic.** `IntakeEnvelope` (`api/src/intake/classify/types.ts`) is a deliberately channel/provider-agnostic shape, with a literal source-code comment: *"Email populates it today; WhatsApp/Slack/Teams populate the same shape later with zero engine changes."* Once a message lands in `intake_messages`, everything downstream (classification, human review, conversion to a ticket) is generic. **What is *not* abstracted is ingestion itself** — `storeMessage()` is hard-typed to `mailparser`'s email-specific `ParsedMail` shape (from/to/cc address lists, MIME attachments). A WhatsApp channel needs its **own** ingestion module (mirroring `gmail-sync.ts`/`graph-sync.ts`) mapping WhatsApp's payload into the storage shape — this part is genuinely new work, not reuse, though it is arguably **simpler** than email since WhatsApp pushes full message content in the webhook itself (no separate poll-and-fetch step needed).

**Audit/retry/outbound:** `intake_audit_log` logs review *decisions*, not raw webhook deliveries — **no dedicated webhook-delivery-log table exists**. **No server-side retry logic** for inbound webhooks — reliance is entirely on the provider's own retry (which is exactly why both handlers force-return 200). `intake_outbound` is a synchronous send-and-log table (not a real queue) for the reply-by-email feature — its column shape (`channel_id`, `in_reply_to_id`, `action`, `status`, `error`) is directly reusable as the pattern for a WhatsApp outbound-reply log.

### Would `/api/intake/webhook/whatsapp` fit the same shape? **Yes for the outer shell, no (new work) for inner ingestion.**

The token/idempotency/classification patterns transfer cleanly — WhatsApp's `wamid` maps directly onto the existing `external_message_id` uniqueness guard with **no schema change**, and the classifier already anticipates `channelType: 'whatsapp'` literally in its own source comment. New work required: a WhatsApp-specific store/ingestion function (simpler than email, no polling needed), a new credential/OAuth-equivalent flow (system-user token, not refresh-token OAuth), and an outbound-send function alongside the existing `smtp.ts`.

### Channel/Source Support (Part S)

`intake_channels.type` **already includes `'whatsapp'` as a legal enum value** — zero migration needed there. The admin UI (`app/(app)/intake/channels/ChannelsClient.tsx`) already lets an admin create a `whatsapp`-typed channel today, complete with an icon and label — but it is **inert**: the Connect/Test/Resync controls are gated to `type === 'email'` only, and no ingestion code path exists, so such a channel would sit permanently `paused`. There is **no generic `source`/`channel`/`created_via` column on `requests` itself** — only the intake-specific `intake_message_id`/`source_metadata` pair, with `source_metadata.created_via` being an unconstrained free-text literal (`'intake'`), not an enum. **Net effect: adding "WHATSAPP" as a recognized value requires zero schema migration** — it's already legal at the `intake_channels` level and unconstrained at the `requests.source_metadata` level. What's missing is entirely application code (webhook route, credential flow, ingestion worker, connect UI).

### Duplicate Ticket Detection (Part V): **NOT FOUND.**

No requester+issue+store+asset+description+time-window similarity detection exists anywhere, for any channel. The only "dedup" concept in the repo is inbound-**message**-level (email content-hash/external-id dedup in the intake pipeline) — it prevents the same email being ingested twice, but does nothing to prevent two *different* messages (or a WhatsApp message plus a phone call) from becoming two separate tickets for the same issue. Would need to be built net-new.

### Draft / Incomplete Ticket Support (Part W): **NOT FOUND at the ticket level; a partial analog exists in Intake.**

`requests.status` has no `'draft'` value, and no autosave/localStorage/draft-table mechanism exists for the web creation form. The closest analog is `intake_threads` — a long-lived, resumable conversation container that groups inbound messages over days before any conversion decision — but it accumulates raw *messages*, not structured *form fields* toward one eventual ticket, and the conversion step is one-shot (single-message-to-one-review-to-one-request), with no multi-turn "collect field A, then B, then C" state machine. **`intake_threads` is the right table to *extend* as the "draft-in-progress" concept for a multi-turn WhatsApp conversation** (e.g. adding a `pending_form_data JSONB` column that accumulates turn-by-turn) — but this capability does not exist today.

---

## 19. Channel / Source Architecture

Covered fully in §18 (Part S). Summary: `intake_channel_type` enum already legal for `'whatsapp'`; no CHECK/enum constrains `requests.source_metadata`; adding the value is a code change, not a migration.

---

## 20. Existing API Inventory

| Requirement | Existing Endpoint | Reusable? | Gap |
|---|---|---|---|
| Identify employee | — | No | No phone column exists at all (§8) |
| List services | `getServices()`/catalog query (`lib/queries/services.ts`) | Yes | — |
| List categories | `service_categories` admin queries | Yes | — |
| Search issues (keyword) | `searchServices()` (`lib/queries/services.ts:123-144`, ilike name/description, `.limit(50)`) — operates at **Service** level, no "Issue" level exists (§4) | Partially | No fuzzy/typo tolerance, no ranking, no sub-500ms guarantees investigated; ceiling is Service-level, not issue-level |
| Get issue fields | `resolveServiceFormSections(service)` (§6) | Yes | Rendering interpreter still needs to be written |
| Search stores | `stores` table + single-row lookup only | Partially | No `searchStores()` action exists — small addition |
| Search employees | `searchManagersForApproval()`/`searchOrgMembers()` (§7) | Yes | Org-scoped already; add a role/permission check if exposed more broadly |
| Search assets | — | No | No `assets` entity exists anywhere in the system |
| Upload attachment | `uploadAttachment()` (Server Action) | Partially | Session/File-object coupled — mirror the Buffer-based intake pattern instead (§16) |
| Create ticket | `createRequest()` (Server Action) | Partially | See §21 — session-coupled, not callable from a webhook as-is |
| View ticket | Standard RLS-scoped queries | Yes | — |
| Add comment | `addComment()` (Server Action) | Yes | Needs a channel/external-id column added (§15) |
| Reopen ticket | `updateRequestStatus()` reopen path | Yes | Session/role-coupled like all Server Actions |
| Cancel ticket | `updateRequestStatus()` | Yes | Same |
| Approve | `approveApproval()`/`rejectApproval()`/`delegateApproval()` (`lib/actions/approvals.ts`) | Yes (as the canonical, race-guarded implementation) | Also session-coupled — a WhatsApp "approve" reply needs the same webhook-auth pattern as §18/§22, since there's no Supabase Auth session for a WhatsApp sender |

All rows other than the cron/webhook routes are **Next.js Server Actions**, not REST endpoints — confirmed by an exhaustive listing of `app/api/**`, which contains no `requests`/`tickets`/`store`/`employee`/`asset`/`approval` routes at all.

---

## 21. Ticket Creation Service Reusability (critical conclusion)

**Classification: D — Existing creation logic is channel/UI-coupled and needs redesign.**

`createRequest()` is a Server Action, which is a partial positive (it's a plain async function, not literally embedded in a React component) — but three structural facts make it channel-coupled in practice:
1. It hard-depends on `cookies()` (via `@supabase/ssr`) for `auth.getUser()` — a mechanism that only exists inside an active Next.js request/response cycle. A webhook handler with a service-role connection has no cookies to hand it and would immediately get `{ error: 'You must be signed in...' }`.
2. It hard-depends on `getCurrentProfile()`, which reads an `x-verified-user-id` header set by the app's own middleware/`proxy.ts` — another HTTP-pipeline-only dependency.
3. Its "acting user vs. requester" model (the "book on behalf of" override) conflates identity resolution with business logic, rather than accepting an already-resolved requester ID as a parameter.

**No SQL/RPC layer encapsulates creation logic either** — the only request-relevant Postgres functions found handle ticket numbering, `org_id` stamping, and an atomic JSONB merge helper for later edits. None perform SLA resolution, priority derivation, business-rule assignment, or notification dispatch — ruling out "call a DB function via Supabase RPC from any channel" as a present-day reuse path.

**Decisive evidence for classification D, not the milder C:** a second, real, non-browser-form ticket-creation path **already exists** — `lib/actions/intake/work.ts`'s `approveAndCreate()`, used when a human converts a reviewed email into a ticket. Instead of calling `createRequest()`, it does its own direct `INSERT`, and in doing so it has **already drifted**: no `resolveSlaDeadlines()` call (confirmed §11), no `runRulesForTrigger('created', ...)` call (confirmed §9), no team-member notification, no `created` activity-log entry, no OEM auto-routing, and none of `createRequest()`'s server-side re-validation (location scope, category derivation, per-field validation). **This is concrete, present-day proof that the org's own prior attempt to add a second channel reimplemented a stripped-down insert rather than reusing the shared logic — and a WhatsApp integration built the same way would repeat exactly this mistake.**

**What would need to change** (concrete): extract the pure business logic of `createRequest()` — schema resolution, field validation, title derivation, priority resolution, `resolveSlaDeadlines()`, the insert, `runRulesForTrigger('created', ...)`, activity logging, OEM auto-routing, notifications — into a channel-agnostic `createRequestCore(params, client)` that takes an already-resolved `requesterId`/`orgId` and an injected Supabase client (RLS or admin) instead of deriving identity from cookies/headers. Make the existing `createRequest()` Server Action a thin web-specific adapter over it. Make `lib/actions/intake/work.ts` call the same core function instead of hand-rolling its insert (this alone retroactively fixes the SLA/rules/notification gaps documented in §9/§11). A WhatsApp handler then resolves `requesterId` (once phone-identity mapping exists, §8) and calls `createRequestCore()` with a service-role client, getting identical governed behavior to the web form.

---

## 22. Draft / Resume Capability

Covered in §18 (Part W). Summary: **NOT FOUND** at the ticket level (no `'draft'` status, no autosave); `intake_threads` is architecturally the right foundation to extend for a multi-turn WhatsApp conversation, but currently accumulates raw messages, not structured form-field progress, and would need a new `pending_form_data`-style column plus new conversation-state logic.

---

## 23. Duplicate Detection

Covered in §18 (Part V). Summary: **NOT FOUND** for tickets on any channel today; only inbound-message-level dedup exists in the email-intake pipeline.

---

## 24. Audit & Logging

`request_activity`/`task_activity` (system-event history, append-only, service-role-write-only) exist for the two core entities. `admin_audit_log` (migration 089) covers admin-configuration changes (service/category edits), role-gated read, service-role-write-only. **`intake_audit_log`** is the closest existing precedent for logging *integration/review* events (records review decisions like `review_approved`/`review_converted`/`review_reclassified`, actor nullable to represent "system/worker") — but it is **not** a raw webhook-delivery log (no per-delivery status/retry-count table exists for any inbound channel today). The full raw inbound payload is captured for email via `intake_messages` (`headers` JSONB, `body_text`/`body_html`, a `status` state machine). **Assessment:** the `intake_*` schema is explicitly designed to be reused across channels (the `intake_channel_type` enum already anticipates WhatsApp) — a WhatsApp conversation's events should populate `intake_messages`/`intake_threads`/`intake_audit_log` exactly as email does, rather than inventing parallel logging tables. The only genuinely new piece is the channel-specific ingestion adapter authenticating the inbound webhook (§18).

---

## 25. Security / Permissions

**Auth model:** Supabase Auth via cookie/JWT, three client trust tiers (browser-RLS, server-RLS, service-role-admin-bypass-RLS). RLS is pervasive and has been **iteratively and publicly hardened** — migration 080's own comment documents a real historical bug where earlier "replace the old policy" migrations used mismatched `DROP POLICY` names, leaving old **unscoped** permissive policies live underneath new org-scoped ones (Postgres ORs multiple permissive policies together, silently defeating the org check) — fixed, but strong evidence RLS alone has previously failed silently and app-level checks matter as defense-in-depth.

**CRITICAL FINDING — the Permission Matrix is decorative.** `permission_overrides`/`custom_roles` tables exist and the admin UI writes real rows to them, but **nothing in the app reads either table to make an authorization decision** — every real permission check is a hard-coded role comparison scattered through server actions and RLS policies. This is explicitly self-documented in the component's own code comment and a `PERMISSION_MATRIX_ENFORCED = false` constant, with a regression test (`permission-matrix-not-enforced.test.tsx`) specifically guarding against silently re-enabling a misleading control. **A WhatsApp integration must follow the same hard-coded-role-check pattern everywhere authorization matters — it cannot rely on `permission_overrides` for anything, because nothing does.**

**The webhook/cron RLS-bypass pattern (directly reusable template for a WhatsApp handler), consistently applied across every existing external-caller endpoint:**
1. Authenticate the inbound HTTP request with a constant-time-compared shared secret (`secureCompare()` using `crypto.timingSafeEqual`) — a *dedicated* token per integration, deliberately **not** reused across different privilege levels (the intake webhook token is intentionally separate from the higher-privilege worker-to-worker secret, because query-string tokens leak into proxy/CDN logs).
2. Use `createAdminClient()` (service-role key) — there is no Supabase Auth session for a webhook caller, so RLS cannot apply.
3. **Manually re-implement every authorization/org-scoping check RLS would otherwise have done**, directly in the route handler — every downstream query explicitly filters by `org_id` in application code, with an explicit code comment stating this obligation (`alerts/run/route.ts`).

A future WhatsApp webhook handler faces the identical problem (Meta calls the endpoint with no Supabase session) and should follow this exact three-part pattern, mirroring `app/api/intake/webhook/gmail/route.ts` and `app/api/alerts/run/route.ts` closely.

**Module gating:** `requireModuleEnabled()` must be called explicitly in every server action — a **previously real gap**, fixed only after a specific bug was found: intake actions originally only hid the module in the UI/nav, not in the actions themselves, so a disabled-module org's users could still invoke any intake action directly. **This is exactly the class of bug a new WhatsApp module must avoid from day one.**

**Rate limiting:** exists, but is in-process/per-replica only (an in-memory `Map`), and only applied to login/forgot-password — **no rate limiting on any webhook, cron endpoint, or general mutation action.** **CORS:** no configuration exists at all (no `headers()` in `next.config.ts`); not needed today since nothing is called cross-origin, but would need explicit setup if ever required.

---

## 26. Existing Tests

**14 unit test files, 9 integration test files** (the integration suite runs against a real local Postgres+Auth, not mocks). Well-covered areas: SLA breach/business-hours pure functions, several specific historical authorization bugs (D-03 filtered-query authorization, D-04 project object-level access, D-09 platform-owner task delete, D-16 missing role check on task creation, D-17 missing RLS role gate, assignment RBAC), audit-log rendering, email escaping/XSS, cron response envelopes, the intake-module-guard fix, and the "Permission Matrix stays non-editable" regression guard.

**Confirmed zero test coverage on: ticket/request creation (`createRequest()` itself), the service catalogue, custom fields (including field-level SLA overrides), the approval engine (`approveApproval`/`rejectApproval`/`delegateApproval`), the escalation mechanism, and attachments** (upload validation, storage RLS). Notifications have only partial coverage (failure-observability and channel-toggle tests, not the core dispatch logic itself).

**Risk for WhatsApp:** the four highest-relevance untested areas for a WhatsApp flow — ticket creation, approval, attachments, custom fields — are exactly the areas with **no regression coverage today**, and this codebase has a demonstrated, repeated history of subtle authorization/RLS bugs surviving into production in precisely these kinds of code paths (§25). A WhatsApp integration should not assume any of this untested surface is safe to build directly on top of without adding its own integration tests (the existing `tests/setup/fixtures-d03.ts`-style multi-role/multi-org fixture harness is a directly reusable pattern for doing so).

---

## 27. Representative Ticket Flows

*(Reconstructed from seed data and confirmed code paths; labeled by source. No production data exists in the repository.)*

**Flow A — Simple incident (from seed data + confirmed `createRequest()` path)**
Service: Office Supplies · Category/Sub-category: Facilities / Office Supplies · Required fields: item list (free text) · Dynamic fields: none beyond the base description · Assignment: whichever Business Rule (if any) matches `service_id`, else unassigned · Priority: `service.default_priority` (no matching sub-category `sla_priority` override in this seed row) · SLA: resolved from `sla_policies[priority]` if the service has a policy, else null · Approval: none (no `approval_workflow_id` on this service) · Escalation: only reachable via the `sla_pct_elapsed`/`unassigned_minutes` scheduled Business Rules, if configured · Status after creation: `open` · Notifications: `request_created` fan-out to the service's team.

**Flow B — Ticket with dynamic/custom fields (from seed data)**
Service: Equipment Repair · Sub-category: Peripherals & Repair · Dynamic fields: `device_type` (select: Laptop/Monitor/Keyboard-Mouse/Other) · Same creation mechanics as Flow A, but `form_data` carries the selected device type, and if a `field_sla_overrides` row exists for that specific option, SLA resolves from the override layer instead of the service-level policy.

**Flow C — Ticket requiring approval (from seed data + confirmed approval-engine code)**
Service: Laptop Request or Access Request · Both are seeded with `approval_workflow_id` set to "Manager Approval." Status after creation: `open` (approval is **not** auto-entered — confirmed §13). An agent must click "Start Working" then "Send for Approval" to move it to `pending_approval`; only then does an `approvals` row get created and the configured approver notified.

**Flow D — Ticket with SLA/escalation (confirmed code path)**
Any service with a non-null `sla_policy_id`. `response_due_at`/`resolution_due_at` are set atomically at creation (web path). If the org has a Business Rule with `schedule_check: 'sla_pct_elapsed'` and a `notify`/`reassign` action, the ticket enters that sweep once its elapsed-business-hours percentage crosses the configured threshold — entirely dependent on `resolution_due_at` being non-null (confirmed gap for intake/WhatsApp-created tickets, §11).

**Flow E — Ticket involving store/employee lookup (confirmed code path)**
Any service using the `store_address` field type: at submission, the server looks up the *requester's own* `profiles.store_id → stores.address` and force-overwrites the field value server-side, regardless of client input. This is the only master-data lookup wired into the creation path today; no service field lets a requester search/select an arbitrary store, employee, or vendor as part of ticket creation (only the separate "book on behalf of" feature does an employee lookup, and only for agent-tier users).

---

## 28. WhatsApp Readiness Matrix

| Capability | Existing | Partial | Missing | Recommended Reuse |
|---|:-:|:-:|:-:|---|
| Employee identification | | | ✓ | Add `phone` to `profiles` + normalization + uniqueness; no existing mechanism at all |
| Service selection | ✓ | | | `searchServices()` (keyword/full-text), flat list |
| Issue hierarchy | | ✓ | | Bottoms out at Sub-Category; "Issue" must be a dynamic-field dropdown, not a new taxonomy table |
| Keyword issue search | | ✓ | | `searchServices()` exists at Service level only; no fuzzy/typo tolerance investigated |
| Dynamic fields | | ✓ | | Data/validation layer fully reusable; needs a new text-prompt rendering interpreter |
| Searchable masters | | ✓ | | Employee/Agent/Project search solid; Store/Department/Team/Vendor need new search actions; Asset doesn't exist |
| Attachments | | ✓ | | Reuse the Buffer-based intake validator pattern, not the browser-File Server Action |
| Draft/resume | | | ✓ | Extend `intake_threads` with a `pending_form_data`-style column; nothing exists today |
| Ticket review | ✓ | | | Standard RLS-scoped queries work as-is |
| Ticket creation | | ✓ | | `createRequest()`'s business logic exists but is session-coupled (§21) — needs `createRequestCore()` extraction |
| Assignment | | ✓ | | Business Rules engine works, but only if the creation path calls `runRulesForTrigger()` (currently intake doesn't) |
| Priority | ✓ | | | Reuse the existing deterministic Sub-Category/Service-default resolution; don't trust WhatsApp input |
| SLA | | ✓ | | Resolution logic exists and works; currently **not called** by the intake creation path — must be fixed |
| Approval | ✓ | | | Reuse `sendAdHocApproval()`/`approveApproval()` as-is; entry remains a deliberate human/bot-triggered step by design |
| Escalation | | ✓ | | Sweep is channel-agnostic but depends on non-null SLA deadlines (same root cause as SLA gap above) |
| Notifications | | ✓ | | `notify()` dispatch is small to extend; but `api/`'s worker has no import path into it — needs its own sender module |
| My Tickets | ✓ | | | Standard RLS-scoped queries |
| Comments/replies | ✓ | | | `addComment()` already has the right side effects, including the `waiting_user→in_progress` auto-transition on requester reply |
| Reopen | ✓ | | | `updateRequestStatus()` reopen path is channel-agnostic once identity/session concerns are solved |
| Cancel | ✓ | | | Same |
| Agent handoff | | ✓ | | `request_comments` architecture supports it; needs new channel/external-id columns for threading |
| Audit logging | ✓ | | | `intake_*` audit infra already designed to be channel-agnostic |
| Webhook infrastructure | | ✓ | | Gmail/Outlook pattern (secret token, idempotency, classification) is a strong, directly-portable template; WhatsApp-specific ingestion/credential code doesn't exist yet |
| Duplicate detection | | | ✓ | Doesn't exist for any channel today |

---

## 29. Schema Changes Potentially Required

| Proposed change | Classification | Rationale |
|---|---|---|
| `profiles.phone`/`mobile` column + uniqueness | **REQUIRED** | No phone-to-employee mapping exists at all (§8); this is the hard blocker for "identify employee from WhatsApp number" |
| WhatsApp phone ↔ employee mapping (if not folded into `profiles.phone` directly, e.g. to support shared/store-generic numbers) | **LIKELY REQUIRED** | Store-generic accounts already exist for email (`sm.<code>@citykartstores.com`); the same ambiguity applies to WhatsApp and may need a dedicated mapping table rather than a 1:1 column |
| `intake_channels` row of type `whatsapp` + WhatsApp-specific `config`/credential fields | **NOT REQUIRED — reuse existing** | `intake_channel_type` already includes `'whatsapp'`; `config JSONB` is already schema-flexible |
| New `intake_messages`/`intake_threads` rows for WhatsApp | **NOT REQUIRED — reuse existing** | Schema is channel-agnostic by design once a message is stored |
| Conversation/session state for multi-turn WhatsApp Q&A (draft ticket in progress) | **REQUIRED** | No draft/resume mechanism exists (§18/§22); needs a new column (e.g. `intake_threads.pending_form_data JSONB`) or a new dedicated conversation-state table |
| `requests.source_metadata` / `intake_message_id` usage for WhatsApp-created tickets | **NOT REQUIRED — reuse existing** | Already unconstrained JSONB + nullable FK, populated today for email; the same fields work for WhatsApp with just a code change to `buildSourceMetadata()` |
| Issue search keywords/synonyms table | **OPTIONAL** | `services.keywords TEXT[]` + full-text index already exists at the Service level; a dedicated synonyms table would only be needed if search must extend below Service granularity, which the catalogue doesn't currently model anyway |
| Channel-specific field configuration (e.g. "ask this field only over WhatsApp") | **OPTIONAL** | Not present; could be deferred unless early UX requires trimming which fields are asked over chat vs. web |
| `request_comments` channel/external-message-id columns | **REQUIRED** (for bidirectional reply support) | No existing scaffolding for tracking which WhatsApp message a reply thread maps to (§15) |
| WhatsApp message log (raw payload capture, distinct from `intake_messages` if a dedicated table is preferred) | **NOT REQUIRED — reuse existing** | `intake_messages` already captures raw payload/headers/status state machine generically |
| WhatsApp media metadata | **NOT REQUIRED — reuse existing** | `intake_attachments` already generic; only a new ingestion function is needed, not a new table |
| WhatsApp template mapping | **LIKELY REQUIRED** | No template-mapping concept exists for any channel today (email uses hard-coded template functions per notification type, `lib/email/notify-email.ts`); WhatsApp Business API requires pre-approved message templates for many message types, which nothing in this schema currently models |
| WhatsApp Flow configuration/version | **OPTIONAL** | Depends entirely on whether WhatsApp Flows (Meta's structured-form UI) vs. plain chat Q&A is the chosen UX — out of scope for this discovery to decide |
| Webhook idempotency records | **NOT REQUIRED — reuse existing** | The `external_message_id` unique-constraint + guard pattern already used for Gmail/Outlook applies directly to WhatsApp's `wamid` |
| Delivery/read status tracking | **LIKELY REQUIRED** | Nothing today tracks per-message delivery/read receipts for any channel; WhatsApp Cloud API provides these natively and a table would be needed if the product wants to surface them |
| A channel-agnostic `createRequestCore()` (code, not schema) | **REQUIRED** | Not a schema change, but the most load-bearing prerequisite identified in this audit (§21) — flagged here because it gates whether any of the above schema additions actually produce *governed* tickets (with SLA/assignment/notifications) or repeat the intake module's drift |

---

## 30. API Changes Potentially Required

- `app/api/intake/webhook/whatsapp/route.ts` — new, modeled directly on the Gmail/Outlook handlers (shared-secret verification, `createAdminClient()`, fire-and-forget relay to a worker or inline processing).
- A WhatsApp credential/connect flow (new — WhatsApp Business uses a permanent system-user token + phone-number-id, not the existing 3-legged OAuth-refresh-token flow used for Gmail/Outlook) — likely a new `app/api/intake/whatsapp/connect` equivalent plus Vault storage reusing the existing `intake_store_credential`/`intake_read_credential` SECURITY DEFINER RPC pattern.
- A WhatsApp-specific ingestion module in `api/src/intake/` (e.g. `whatsapp-store.ts`), mirroring `store.ts`'s Buffer-based, service-role, idempotent message/attachment storage — simpler than email since no polling step is needed.
- A WhatsApp outbound-send function (e.g. `api/src/intake/whatsapp-send.ts`, alongside the existing `smtp.ts`), logging to a table modeled on `intake_outbound`.
- Extraction of `createRequestCore()` from `createRequest()` (§21) — not a new endpoint, but the prerequisite refactor that makes any new channel's creation calls produce governed tickets.
- New master-data search actions: `searchStores()`, `searchDepartments()`, `searchTeams()`, `searchVendors()` (§7) — small, mechanical additions following the existing `searchOrgMembers`/`searchServices` pattern.
- A new employee-identification action resolving a normalized phone number to a `profiles` row (depends on §29's schema addition).
- A WhatsApp sender module for `lib/notifications.ts`'s dispatch (§17) plus, separately, an independent WhatsApp sender in `api/src/` if outbound WhatsApp messages need to originate from the intake worker rather than the Next app.
- An approval-decision entry point callable from a webhook context (a thin wrapper around `approveApproval()`/`rejectApproval()` that resolves the acting profile via the WhatsApp-phone mapping instead of a cookie session, following the §25 webhook-auth pattern).

---

## 31. Existing Components That Must Be Reused

- **The intake channel/message/thread/attachment/audit schema** (`intake_channels`, `intake_messages`, `intake_threads`, `intake_attachments`, `intake_audit_log`) — purpose-built to be channel-agnostic; do not create parallel WhatsApp-specific tables for these concerns.
- **The `IntakeEnvelope` classification pipeline** — genuinely zero-change reusable for WhatsApp per its own source comment.
- **The webhook-auth pattern** (constant-time shared-secret comparison + `createAdminClient()` + manual org-scoping) — the established, repeated template for any non-browser caller.
- **`resolveSlaDeadlines()`, the Business Rules engine (`runRulesForTrigger`), `notify()`, `logActivity()`** — all channel-agnostic pure/near-pure functions once given the right inputs; the fix is to make sure a WhatsApp creation path actually *calls* them (the intake module's own failure to do so is the cautionary example).
- **`lib/validation/formFields.ts`** — the shared field-validation module; directly reusable for validating WhatsApp-collected answers.
- **`addComment()`** — the correct target for bidirectional WhatsApp reply threading, including its existing `waiting_user→in_progress` auto-transition.
- **The Buffer-based attachment validator pattern** (`api/src/intake/attachmentValidate.ts` / `storeAttachments()`) — the correct template for WhatsApp media, not the browser-oriented `uploadAttachment()`.
- **The employee/agent search functions** (`searchOrgMembers`, `searchManagersForApproval`, etc.) — directly reusable once a phone→profile mapping exists.
- **`approveApproval()`/`rejectApproval()`/`sendAdHocApproval()`** — the canonical, race-guarded approval-decision implementations; wrap, don't reimplement.
- **The ticket-numbering trigger** — already fully channel-agnostic; no change needed regardless of creation path.

---

## 32. Technical Risks / Architectural Debt

1. **`createRequest()` is session-coupled and the email-intake module already independently reimplemented ticket creation, dropping SLA/assignment/notifications.** The single highest risk: building WhatsApp the same way (a third independent insert) triples this drift instead of fixing it. (§21, §9, §11)
2. **The Permission Matrix admin screen is decorative** — writes real config that nothing reads. A WhatsApp module must not assume any data-driven permission system exists; it must hard-code role checks like everything else. (§25)
3. **No phone-to-employee identity exists at all** — this is a hard blocker, not a configuration gap, and needs a real design decision (uniqueness, shared/store-generic numbers, inactive-user handling) before any "identify me" flow can work. (§8)
4. **No duplicate-ticket detection and no draft/resume capability exist for any channel** — both are commonly expected for a conversational intake UX and must be built from scratch. (§18)
5. **Zero test coverage on ticket creation, approval, attachments, and custom fields** — combined with a demonstrated history of subtle authorization bugs in exactly this codebase, new WhatsApp code built on these surfaces carries elevated regression risk with no safety net. (§26)
6. **`sla_warning` notifications and the legacy `sla_escalation_rules`/`assignment_rules` tables are dead code left in place** — a WhatsApp implementer could easily be misled by their presence in the schema into thinking they're live. (§9, §12, §17)
7. **Two independent email-sending implementations already exist** (Next app's direct Resend `fetch()`, Express worker's `nodemailer`/SMTP) with an unused `resend` npm dependency in `api/` — evidence that cross-process code sharing between the Next app and the Express worker doesn't happen by default; a WhatsApp sender will likely need its own third implementation unless this is deliberately consolidated first. (§17)
8. **RLS has previously failed silently** due to mismatched `DROP POLICY` migrations (fixed, but a documented precedent) — reinforces that a WhatsApp webhook's manual org-scoping (since it bypasses RLS via the service-role client) must be reviewed carefully, as this exact class of bug has happened before. (§25)
9. **The project's own architecture docs are stale and self-contradicting** (`docs/ARCHITECTURE.md` claims single-tenant/no-hosting; the code is multi-tenant and actively deployed on Railway) — do not trust `docs/*.md` over direct code/schema inspection for anything load-bearing. (§2)
10. **`parent_request_id` (sub-request hierarchy) may be a dormant/removed feature** per `HANDOVER.md` — verify live UI usage before assuming it's a shipped, working capability if WhatsApp needs to reference parent/child tickets.

---

## 33. Unknowns Requiring Clarification

- **UNKNOWN** whether the separate Express `api/` service is actually deployed in the current production Railway setup (no `api/Dockerfile`/`api/railway.toml` found) — this determines whether a WhatsApp ingestion worker should live there or be built as new Next.js route handlers instead.
- **UNKNOWN** whether the content-based dedup hash on `intake_messages` is consulted by any code path not visible to static analysis (it is written but no read call site was found) — worth confirming before relying on it, or before assuming it's safe to leave unused for WhatsApp.
- **UNKNOWN** whether a later, unlisted migration corrected the Storage bucket's own `allowed_mime_types` (still includes `image/svg+xml` in the migrations reviewed) to match the application-level SVG exclusion — worth verifying against the live bucket config directly.
- **UNKNOWN/business decision** whether WhatsApp priority signals (if any) should be treated as pure suggestions requiring human/bot classification+review (mirroring email intake) or ignored entirely in favor of the deterministic Sub-Category mapping (§10) — this is a product decision, not something derivable from code.
- **UNKNOWN/business decision** how a store-shared WhatsApp number (if the business wants store lines, not just individual employee numbers) should resolve to a specific requester identity — the closest existing precedent (`sm.<code>@citykartstores.com`-style shared email accounts) implies the org has faced this exact ambiguity before and may have an established policy worth asking about directly.
- **UNKNOWN** whether WhatsApp Business API access (Meta app review, message template pre-approval, a verified business phone number) has already been provisioned — this is an external/business prerequisite outside the codebase and outside this audit's scope, but gates several of the schema/API items in §29-30.
- **UNKNOWN** the intended scope of "Phase 1" — whether ticket *creation* alone is in scope first, or whether bidirectional reply/comment sync (§15's `request_comments` channel-column gap) must ship simultaneously.

---

## 34. Recommended Implementation Boundaries

*(Boundaries only — no implementation plan. This section states what the evidence supports doing vs. not doing, per the audit's discovery-only mandate.)*

- **Do** treat the WhatsApp channel as an extension of the existing Intake module's data model (`intake_channels`/`intake_messages`/`intake_threads`/`intake_attachments`/`intake_audit_log`), not a parallel schema — this is what the schema's own design (the `'whatsapp'` enum value, the `IntakeEnvelope` comment) already anticipates.
- **Do not** let a WhatsApp ticket-creation path independently reimplement the SLA/assignment/notification logic the way the email-intake conversion path currently does — either extract `createRequestCore()` first (§21), or, at minimum, explicitly call `resolveSlaDeadlines()` and `runRulesForTrigger('created', ...)` from wherever the WhatsApp conversion inserts a `requests` row, matching what the web path already does.
- **Do** follow the established webhook-auth pattern exactly (dedicated shared secret, `createAdminClient()`, manual org-scoping) for any inbound WhatsApp endpoint — this is a proven, repeated template in this codebase, not something to redesign.
- **Do not** trust the Permission Matrix admin screen or `permission_overrides`/`custom_roles` tables for any authorization decision — they are not enforced anywhere in the app today.
- **Do** treat priority as DESK-calculated (Sub-Category/Service default), not WhatsApp-supplied, consistent with both existing channels.
- **Do not** assume any existing ticket/task custom-field value can be resolved back to a specific master-data row (store/employee/etc.) — they are stored as label strings, not IDs, except for the one system-populated `store_address` field.
- **Do** build phone-to-employee identity as new, explicit schema and logic — there is nothing to extend here, only to design from scratch, including a decision on shared/store-generic numbers.
- **Do** reuse `addComment()` (not a raw insert) for any WhatsApp reply landing on an existing ticket, to inherit its SLA/notification/auto-transition side effects for free — but expect to add channel/external-id columns to `request_comments` first for reliable threading.
- **Do not** attempt to call the browser-oriented `uploadAttachment()` Server Action from a webhook — mirror the Buffer-based `storeAttachments()` pattern instead.

---

## "CITYKART MUST REMAIN SYSTEM OF RECORD"

| Business Logic | Current Owner | WhatsApp Responsibility |
|---|---|---|
| SLA calculation (deadline resolution, business-hours math, pause/resume ledger) | `lib/sla/resolve.ts` + `lib/sla/business-hours.ts` (application code, invoked inline at creation) | Never compute deadlines itself; must ensure its ticket-creation call path actually invokes `resolveSlaDeadlines()` (a gap the existing intake path fails at today) |
| Priority determination | Service/Sub-Category admin-configured defaults (`lib/actions/requests.ts`) — never trusts client input on any existing channel | Send raw signal (if any) only as a suggestion for classification/review, never as the final value |
| Assignment | Business Rules engine (`lib/rules/`), invoked explicitly at creation — no DB trigger | Must ensure its creation call path invokes `runRulesForTrigger('created', ...)`, or falls back to unassigned like the web path does when no rule matches |
| Approval workflow entry | Always a deliberate human (or explicit bot-equivalent) action, never automatic on any channel today | May prompt the user/agent to request approval, but must go through `submitForApproval()`/`sendAdHocApproval()`, not a direct status write |
| Approval decisioning | `approveApproval()`/`rejectApproval()`/`delegateApproval()` (race-guarded, SLA-resume-aware) | A WhatsApp "approve" reply must call these functions (via a webhook-authenticated wrapper), never write `approvals`/`requests.status` directly |
| Ticket numbering | Postgres `BEFORE INSERT` trigger, fully channel-agnostic already | Nothing to do — any INSERT into `requests` gets a correct number automatically |
| Status transitions | Hard-coded `AGENT_TRANSITIONS`/`REQUESTER_TRANSITIONS` matrix + role check (`lib/actions/requests.ts`) | Must route status changes through `updateRequestStatus()`, not direct writes, to respect the transition matrix and mandatory-comment/field gates |
| Authorization | Hard-coded role checks throughout server actions + RLS policies (NOT the Permission Matrix — confirmed unenforced) | Must replicate the same hard-coded role-check discipline in any new webhook/action code; cannot rely on any data-driven permission table |
| Notifications | `notify()` central dispatch (`lib/notifications.ts`), respecting per-user/per-org preferences | Should register as a new channel in the existing dispatch (or a mirrored dispatcher in `api/`), not bypass user notification preferences |
| Escalation | Business Rules `schedule` trigger, cron-swept, channel-agnostic *if* SLA deadlines are set | Depends on SLA calculation being correctly invoked (see above) — no separate action needed once that's fixed |

---

## 35. Source File Index

**Ticket / core domain:**
- `supabase/migrations/20240101000000_initial_schema.sql` (base `requests`, `tasks`, `approvals`, `services`, `service_categories`, `profiles`, `teams`, `departments`, `notifications`)
- `supabase/migrations/20240101000109_category_as_form_field.sql`, `20240101000118_exclusive_category_service_tag.sql` (category/service decoupling)
- `supabase/migrations/20240101000112_unified_request_number_series.sql`, `20240101000117_ticket_number_series_cksd.sql` (ticket numbering)
- `supabase/migrations/20240101000068_request_subrequests.sql`, `20240101000114_reopen_workflow.sql`, `20240101000124_pre_approval_status.sql`, `20240101000125_paused_ms_total.sql`
- `lib/actions/requests.ts` (createRequest, assignRequest, updateRequestStatus, addComment, duplicateRequest, submitForApproval, autoCloseRequests)
- `lib/constants/request-transitions.ts`, `lib/constants/requests.ts`
- `components/forms/DynamicForm.tsx`, `components/forms/FieldRenderer.tsx`
- `app/(app)/services/[slug]/page.tsx`, `app/(app)/services/page.tsx`, `app/(app)/requests/**`

**Catalogue / dynamic fields:**
- `supabase/migrations/20240101000004_form_sections.sql`, `20240101000005_sub_categories.sql`, `20240101000022_service_governance.sql`, `20240101000037_service_governance.sql`, `20240101000108_form_templates.sql`, `20240101000120_retag_service_categories_rpc.sql`, `20240101000127_service_location_visibility.sql`
- `lib/forms/sections.ts`, `lib/validation/formFields.ts`, `lib/queries/services.ts`
- `components/admin/SectionBuilder.tsx`, `app/(app)/admin/categories/CategoriesAdminClient.tsx`, `app/(app)/admin/services/ServicesAdminClient.tsx`
- `types/index.ts` (FormField/FormSection/FormFieldOption types)
- `supabase/seed.sql`

**Master data / identity:**
- `supabase/migrations/20240101000021_org_structure.sql`, `20240101000026_master_data.sql`, `20240101000081_job_functions_designations.sql`, `20240101000128_store_master_and_oem_routing.sql`
- `lib/queries/profiles.ts`, `lib/actions/requests.ts` (searchOrgMembers/searchAgentTierMembers), `lib/actions/approvals.ts` (searchManagersForApproval/searchUsersForDelegation), `lib/queries/projects.ts`, `lib/actions/admin/org.ts`
- `types/database.ts` (profiles Row)
- `components/admin/BulkImportUsersDialog.tsx`

**Assignment / priority / SLA / escalation:**
- `supabase/migrations/20240101000020_assignment_rules.sql` (dead), `20240101000096-000098_business_rules*.sql`, `20240101000017_business_hours.sql`, `20240101000048_per_org_sla_config.sql`, `20240101000092_field_sla_overrides.sql`, `20240101000099_atomic_field_sla_override_upsert.sql`, `20240101000110_sla_policies.sql`, `20240101000125_paused_ms_total.sql`, `20240101000018_escalation.sql` (dead), `20240101000095_fix_escalation_tier_vocabulary.sql`
- `lib/rules/evaluate.ts`, `lib/rules/actions.ts`, `lib/rules/run.ts`
- `lib/sla/resolve.ts`, `lib/sla/business-hours.ts`, `lib/sla/breach.ts`
- `app/api/business-rules/run/route.ts`, `app/api/alerts/run/route.ts`
- `app/(app)/admin/business-rules/BusinessRulesClient.tsx`, `app/(app)/admin/sla-policies/page.tsx`, `app/(app)/admin/request-config/AlertRulesClient.tsx`

**Approval / status / comments:**
- `supabase/migrations/20240101000031_allow_multiple_approvals_per_request.sql`, `20240101000086_approvals_one_pending_per_request.sql`, `20240101000113_approver_visibility.sql`
- `lib/actions/approvals.ts`
- `app/(app)/admin/approvals/WorkflowBuilderClient.tsx`, `app/(app)/approvals/`

**Attachments:**
- `supabase/migrations/20240101000003_attachments.sql`, `20240101000025_attachment_security.sql`, `20240101000030_task_attachments.sql`, `20240101000094_attachment_comment_link.sql`
- `lib/attachments/validate.ts`, `lib/actions/attachments.ts`, `lib/actions/task-attachments.ts`

**Notifications:**
- `supabase/migrations/20240101000011_notifications_v2.sql`, `20240101000129_notification_rules_and_push.sql`
- `lib/notifications.ts`, `lib/email/send.ts`, `lib/email/notify-email.ts`, `lib/push/send.ts`

**Webhook / Intake (the WhatsApp precedent):**
- `supabase/migrations/20240101000052-000063_intake_*.sql`, `20240101000105_fix_intake_and_task_deps_rls.sql`, `20240101000056_intake_phase_d.sql`
- `app/api/intake/webhook/gmail/route.ts`, `app/api/intake/webhook/outlook/route.ts`, `app/api/intake/oauth/callback/route.ts`, `app/api/intake/cron/classify/route.ts`
- `api/src/intake/store.ts`, `api/src/intake/gmail-sync.ts`, `api/src/intake/graph-sync.ts`, `api/src/intake/imap.ts`, `api/src/intake/normalize.ts`, `api/src/intake/attachmentValidate.ts`, `api/src/intake/smtp.ts`, `api/src/intake/classify/types.ts`, `api/src/intake/classify/orchestrator.ts`
- `lib/actions/intake/work.ts`, `lib/actions/intake/channels.ts`, `lib/intake/oauth.ts`
- `app/(app)/intake/channels/ChannelsClient.tsx`, `app/(app)/intake/review/[id]/ReviewClient.tsx`, `app/(app)/intake/inbox/`

**Security / audit:**
- `lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/supabase/admin.ts`, `proxy.ts`
- `supabase/migrations/20240101000001_harden_rls.sql`, `20240101000016_security_hardening.sql`, `20240101000032_multitenancy.sql`, `20240101000033_org_isolation.sql`, `20240101000039_role_permissions.sql`, `20240101000080_rls_hardening_cross_tenant.sql`, `20240101000089_admin_audit_log.sql`
- `app/(app)/admin/roles/PermissionMatrixClient.tsx`
- `lib/rate-limit.ts`, `lib/cron-auth.ts`, `lib/secure-compare.ts`

**Frontend (general):**
- `app/(app)/services/[slug]/page.tsx`, `components/forms/DynamicForm.tsx`, `components/forms/FieldRenderer.tsx`, `app/(app)/requests/[id]/page.tsx`

**Tests:**
- `tests/unit/sla-breach.test.ts`, `sla-business-hours.test.ts`, `permission-matrix-not-enforced.test.tsx`, `intake-module-guard.test.ts`, `audit-log-summary.test.ts`, `email-escaping.test.ts`, `cron-health-envelope.test.ts`
- `tests/integration/d03-authorization.test.ts`, `d04-project-authorization.test.ts`, `d09-platform-owner-task-delete.test.ts`, `d16-task-creation-authorization.test.ts`, `d17-oem-notification-rules-visibility.test.ts`, `item6-assignment-rbac.test.ts`, `desk-uat-001-reopen.test.ts`

---

## "WHAT THE WHATSAPP ARCHITECT NEEDS TO KNOW"

1. **Can the existing Service Catalogue drive WhatsApp?** Yes for Service/Sub-Category selection (a flat, searchable list); no "Issue" level exists below Sub-Category — finer distinctions must be modeled as dynamic form fields, not a new taxonomy table.
2. **Can existing dynamic fields drive WhatsApp?** The data and validation layer, yes, directly. The rendering layer (React → chat text/buttons) does not exist and must be built new — this is expected, bounded work, not a redesign.
3. **Can users be identified reliably by mobile number?** No. There is no phone field on the user record at all today; this must be designed and built from scratch, including a policy for shared/store-generic numbers.
4. **Can existing search APIs support keyword-based issue discovery?** Partially — `searchServices()` works at the Service level (case-insensitive, partial, full-text-indexed) but there's no finer "Issue" level to search, and no fuzzy/typo tolerance was found.
5. **Can existing master-search APIs support WhatsApp selections?** Partially — Employee/Agent/Project search is solid and reusable; Store/Department/Team/Vendor have CRUD but no search API (small additions needed); Asset doesn't exist as an entity.
6. **Can existing attachment infrastructure be reused?** Partially — not the browser-oriented Server Action, but the email-intake module's Buffer-based, service-role ingestion pattern is a directly portable template.
7. **Can the existing ticket creation service be reused?** No, not as-is (Classification D) — `createRequest()` is session-coupled, and the one other non-web channel that already exists (email intake) proves the risk by having already reimplemented a stripped-down, drifted version of it. Extracting a channel-agnostic `createRequestCore()` is the recommended prerequisite.
8. **Will existing assignment rules execute?** Only if the WhatsApp creation path explicitly calls `runRulesForTrigger('created', ...)` — it does not happen automatically, and the existing email-intake path currently fails to call it.
9. **Will existing priority logic execute?** Yes, if the creation path uses the same Sub-Category/Service-default resolution — this logic is channel-agnostic and should not be bypassed by trusting a WhatsApp-supplied value.
10. **Will SLA automatically initialize?** Only if the creation path explicitly calls `resolveSlaDeadlines()` before insert — confirmed **not** happening today in the one channel most similar to WhatsApp (email intake), which is the most concrete, fixable gap in this audit.
11. **Will approval workflows automatically execute?** No, by design, on any existing channel — approval entry is always a deliberate action. A WhatsApp flow can prompt for it but must go through the same `submitForApproval()`/`sendAdHocApproval()` functions.
12. **Will escalation automatically work?** Only if SLA deadlines are non-null (see #10) — the escalation sweep itself is channel-agnostic.
13. **Can existing notification events be extended with a WhatsApp channel?** Yes for the in-app dispatch abstraction in the Next.js app (small, additive change); but the `api/` Express worker (where a WhatsApp webhook most naturally lives) has no import path into it and would need its own sender.
14. **Can existing comments support two-way WhatsApp replies?** Structurally yes (`addComment()` has the right side effects, including auto-resuming `waiting_user` tickets), but `request_comments` needs new channel/external-message-id columns first for reliable threading.
15. **Does Citykart already support draft/resume?** No, for tickets. `intake_threads` is a plausible foundation to extend for multi-turn WhatsApp conversations, but doesn't do this today.
16. **Five biggest technical gaps:** (1) no phone-to-employee identity; (2) `createRequest()`'s business logic isn't callable from a non-browser context, and the one existing non-web channel already reimplemented it with drift; (3) no duplicate-ticket detection for any channel; (4) no draft/resume/multi-turn conversation state for any channel; (5) zero test coverage on ticket creation, approval, attachments, and custom fields, in a codebase with a documented history of subtle authorization bugs in exactly these areas.
17. **Five strongest existing components to reuse:** (1) the entire `intake_*` channel/message/thread/audit schema, explicitly designed to be channel-agnostic and already anticipating WhatsApp; (2) the webhook-auth pattern (shared secret + service-role client + manual org-scoping), proven across three existing integrations; (3) `resolveSlaDeadlines()`/the Business Rules engine/`notify()`/`logActivity()` as channel-agnostic functions, once correctly invoked; (4) the field-definition/validation data layer (`lib/validation/formFields.ts`, `lib/forms/sections.ts`), fully React-free and reusable; (5) `addComment()` and `approveApproval()`/`rejectApproval()` as the correct, side-effect-complete targets for reply and approval-decision flows.
18. **What should NOT be changed for WhatsApp:** the ticket-numbering trigger (already fully channel-agnostic); the core `requests`/`approvals`/`request_activity` schema shape (extend via nullable columns, don't restructure); the hard-coded role-check authorization pattern (don't attempt to route WhatsApp authorization through the unenforced Permission Matrix); the status-transition matrix (route through `updateRequestStatus()`, don't write `status` directly).
19. **What requires refactoring before WhatsApp is added:** extracting `createRequestCore()` from `createRequest()` (§21) is the highest-leverage prerequisite — without it, a WhatsApp channel either can't call the real creation logic at all, or repeats the email-intake module's exact mistake of reimplementing a stripped-down version that silently loses SLA/assignment/notifications. Fixing the email-intake path to call `resolveSlaDeadlines()`/`runRulesForTrigger()` (whether or not the full core-extraction happens first) is a smaller, independently valuable fix that removes one entire class of risk before WhatsApp compounds it.
20. **Overall WhatsApp-readiness rating: PARTIALLY READY.** The schema and the channel-agnostic classification/audit foundation (built for email, explicitly designed to extend to WhatsApp) are genuinely strong and directly reusable — this is not a greenfield integration. But the one piece of business logic WhatsApp most needs to call correctly — "create a fully governed ticket" — is not currently callable from outside a browser session without either duplicating logic (as email intake already did, with documented drift) or undertaking the `createRequestCore()` refactor first. Combined with the complete absence of phone-based identity, duplicate detection, and draft/resume — none of which are schema-blocked, but all of which are genuinely unbuilt — this justifies "Partially Ready" rather than "Mostly Ready": the foundation is unusually good for a system that was never designed with WhatsApp in mind, but several must-have capabilities do not exist in any form yet, and the one existing precedent for adding a second channel is a cautionary example rather than a clean template to copy.
