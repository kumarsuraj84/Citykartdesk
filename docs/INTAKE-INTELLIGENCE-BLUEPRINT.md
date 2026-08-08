# Citykart Desk Intake Intelligence — Architecture & Implementation Blueprint

> **Status:** FOR APPROVAL — no module code written yet. This blueprint covers the 10
> required deliverables (architecture assessment → implementation plan) plus the
> worker/deployment design and the zero-regression strategy.
> **Scope:** built **inside** the existing Citykart Desk monorepo (`suraj2build/cognix` at
> the time this doc was written — since renamed),
> reusing its RLS, RBAC, audit, notifications, tenancy, module-gating and design system.
> **Companion context:** `docs/ARCHITECTURE.md`, `docs/DATABASE.md`.

---

## 1. Architecture assessment (current platform — what we build on)

| Concern | How Citykart Desk does it today | Intake reuses it by… |
|---|---|---|
| Tenancy | `org_id` on every domain table; `current_org_id()` (SECURITY DEFINER) in RLS | Same `org_id` + `current_org_id()` on all `intake.*` tables |
| AuthZ (coarse) | `user_role` enum: `user, agent, manager, admin, platform_owner` | Reused as `role_key`s |
| AuthZ (fine) | `permission_overrides(org_id, role_key, action_key, allowed)` + `custom_roles` + a `PERMISSION_MATRIX` | `intake.*` become **action_keys** in the matrix |
| Module licensing | `module_slug` enum + `org_module_access` + `proxy.ts` `MODULE_ROUTES` + sidebar `has(module)` | Add `'intake'` module slug, gate `/intake` |
| Audit | Append-only `request_activity`/`task_activity`, written via **service-role admin client**; `lib/activity.ts` | New `intake.intake_audit_log`, same append-only/admin-write pattern |
| Notifications | `notify()` (`lib/notifications.ts`) + prefs + Resend email | Reused as-is for reviewer assignment, SLA, etc. |
| Async/cron | `app/api/{alerts,escalation}/run` guarded by `x-cron-secret` + `CRON_SECRET` | Worker uses the same secret pattern; **but polling runs off-Vercel** |
| Storage | Private buckets (`request-attachments`, 25 MB, MIME allowlist) + `lib/attachments/validate.ts` | New private `intake-attachments` bucket, same validator |
| Work engine | Server Actions: `createRequest`, `createTask`, `sendAdHocApproval` | Called as the **public interface** → zero coupling to internals |
| UI | Next.js 16 RSC + Server Actions, shadcn, sidebar nav, `loading.tsx`, `staleTimes` cache | New `(app)/intake/**` route group, same patterns |
| Hosting | UI/RSC on Vercel (`bom1`); HRMS worker already on **Railway** | Intake worker → Railway (proven in-house pattern) |

**Conclusion:** every cross-cutting concern Intake needs already exists. The module is
overwhelmingly *composition*, not new infrastructure. The one genuinely new piece is the
**off-Vercel worker** for mailbox polling/classification — and the ecosystem already runs
a Railway worker (HRMS), so the deployment pattern is established.

---

## 2. Gap analysis (what's missing → what we add)

| Capability | Exists? | Action |
|---|---|---|
| Channel ingestion / mailbox polling | ❌ | New **worker** (Railway) + `intake_channels` config |
| Raw message capture & normalization | ❌ | `intake_messages`, `intake_threads` + worker normalizer |
| Reviewer workspace / triage queue | ❌ | New `/intake/review`, `/intake/queue` UI + `intake_reviews` |
| Classification / rules / confidence | ❌ | `intake_rules`, `intake_classifications`, `intake_feedback` |
| Convert message → Request/Task/Approval | Partial (engine exists) | Orchestration layer calling existing actions + source linkage |
| `intake` module slug + gating | ❌ | `ALTER TYPE module_slug ADD VALUE 'intake'` + gating wiring |
| `intake.*` permissions | ❌ | Add action_keys to `PERMISSION_MATRIX` + defaults |
| Intake audit | ❌ (pattern exists) | `intake_audit_log` mirroring `request_activity` |
| Dedicated bounded-context schema | ❌ (all in `public`) | **Decision §3.0** — dedicated `intake` schema vs `intake_` prefix |
| Encrypted mailbox credentials | ❌ | Supabase Vault / pgcrypto for `intake_channels.credentials` |

**No existing module needs modification** to deliver Phases A–F (work creation reuses
public action interfaces). The only optional touch to existing tables is a *nullable*
source-reference column on `requests`/`tasks` (see §3.4) — additive, zero behaviour change.

---

## 3. Database design

### 3.0 Decision: dedicated `intake` schema vs `public` with `intake_` prefix
The charter mandates an **independent database schema / separate bounded context**.

- **Recommended — real Postgres `intake` schema.** True isolation; clear bounded context;
  cannot accidentally collide with `public` tables. Requires:
  - `config.toml`: `schemas = ["public","graphql_public","intake"]`,
    `extra_search_path = ["public","extensions","intake"]`.
  - supabase-js access via `.schema('intake')` (a thin `intakeDb()` helper wraps it).
  - Cross-schema FKs to `public.organizations/profiles/requests` are fully supported.
  - RLS helpers (`current_org_id()`, `current_user_role()`, `is_team_member()`) live in
    `public` and are reachable because `public` stays in the search_path.
- **Alternative — `public.intake_*` tables.** Zero new infra/config, matches today's
  "everything in public" convention, but weaker bounded-context guarantee.

**This blueprint assumes the dedicated `intake` schema** (honoring the charter). Flip to
the prefix variant at approval if you'd rather minimize config surface — the table designs
below are identical either way.

### 3.1 Entities (all carry `org_id UUID NOT NULL` + standard timestamps; RLS on every table)

- **`intake_channels`** — a configured source. `id, org_id, type ('email'|'portal'|'whatsapp'|'teams'|'slack'|'api'), name, provider ('imap'|'m365'|'gmail'), config jsonb (host/folder/etc.), credentials_ref (Vault secret id — never plaintext), status ('active'|'paused'|'error'), last_polled_at, last_error, default_team_id (FK public.teams, nullable), created_by`. Unique `(org_id, type, name)`.
- **`intake_threads`** — conversation grouping. `id, org_id, channel_id, external_thread_key (provider thread/conversation id), subject, participant_emails text[], message_count, status ('open'|'linked'|'closed'), first_message_at, last_message_at`. Unique `(org_id, channel_id, external_thread_key)`.
- **`intake_messages`** — one inbound communication (immutable raw capture). `id, org_id, channel_id, thread_id, external_message_id (provider id, for idempotency), direction ('inbound'), from_address, to_addresses text[], cc_addresses text[], subject, body_text, body_html, headers jsonb, received_at, normalized jsonb (cleaned text, stripped signature/quote), status ('new'|'normalized'|'classified'|'in_review'|'actioned'|'rejected'|'duplicate'), dedup_hash`. Unique `(org_id, channel_id, external_message_id)` → **idempotent ingestion**.
- **`intake_attachments`** — `id, org_id, message_id, file_name, file_size (≤25MB CHECK), mime_type, storage_path (unique), scan_status, created_at`. Private bucket `intake-attachments`; reuse `validateAttachment`.
- **`intake_classifications`** — system/rule/AI output per message. `id, org_id, message_id, source ('rule'|'model'|'manual'), suggested_type ('request'|'task'|'approval'|'spam'|'noise'), suggested_service_id (FK public.services, nullable), suggested_team_id, suggested_priority, confidence numeric(4,3), entities jsonb (extracted), rationale text, rule_id (nullable), created_at`. Multiple rows allowed (history of suggestions).
- **`intake_reviews`** — the human-triage record / state machine. `id, org_id, message_id (unique), thread_id, assigned_reviewer_id (FK profiles), state ('pending'|'in_review'|'approved'|'edited'|'rejected'|'converted'), decision_notes, chosen_classification_id, sla_due_at, reviewed_by, reviewed_at`. **Work linkage:** `created_request_id, created_task_id, created_approval_id` (FKs → public, `ON DELETE SET NULL`).
- **`intake_rules`** — deterministic rules (Phase E). `id, org_id, name, is_active, priority int, match jsonb (keyword/sender/subject/regex conditions), action jsonb (set type/service/team/priority/auto_convert bool), created_by`. Ordered by `priority`.
- **`intake_feedback`** — learning signal (Phase F). `id, org_id, message_id, classification_id, reviewer_id, was_correct bool, corrected_type, corrected_service_id, corrected_team_id, created_at`. Feeds model/rule tuning.
- **`intake_audit_log`** — append-only. `id, org_id, actor_id (nullable — system/worker), entity_type, entity_id, action, metadata jsonb, created_at`. **Insert denied to `authenticated`; written only via service-role**, exactly like `request_activity`.

### 3.2 Tenant isolation & RLS
- Every table: `org_id NOT NULL` + RLS `USING (org_id = current_org_id())`.
- Write policies layered with permission action_keys (§4): e.g. `intake_reviews` UPDATE
  requires reviewer/manager; `intake_channels`/`intake_rules` writes require intake-admin.
- `intake_audit_log`: `SELECT` org-scoped to managers/admins; **RESTRICTIVE INSERT deny**
  for `authenticated` (mirrors `request_activity`).
- Worker uses the **service-role** key → bypasses RLS, but always sets `org_id` explicitly
  from the channel's org (channels are org-owned), preserving isolation.
- Reuses the **migration-045 pattern** (STABLE SECURITY DEFINER helpers) — no per-row
  subqueries, no recursion.

### 3.3 Indexes (designed up front, learning from the perf audit)
`intake_messages (org_id, status, received_at DESC)`, `(org_id, channel_id, external_message_id)` unique, `dedup_hash`; `intake_reviews (org_id, state, sla_due_at)`, `(org_id, assigned_reviewer_id, state)`; `intake_threads (org_id, channel_id, external_thread_key)` unique; trigram on `intake_messages.subject` for search. Counts via indexed predicates (no `count:'exact'` on hot lists).

### 3.4 Source linkage (zero-coupling)
Primary linkage lives **on the intake side** (`intake_reviews.created_request_id` etc.).
*Optionally* add a nullable `intake_message_id UUID` (+ `source text`) to `requests`/`tasks`
for reverse "where did this come from?" — **additive, nullable, no behaviour change, no FK
into intake required** (can be a soft reference). Recommend deferring this to Phase D and
gating it behind a tiny migration so existing modules stay untouched until then.

---

## 4. RBAC design (integrated with the existing matrix — not a parallel system)

The charter's four roles map to **capability bundles** expressed as `action_key`s added to
`PERMISSION_MATRIX`, granted per `role_key`, overridable per-org via `permission_overrides`.

**New action_keys:** `intake.view`, `intake.review`, `intake.convert` (create work),
`intake.manage_rules`, `intake.manage_channels`, `intake.admin`.

**Default grants (system roles → action_keys):**

| role_key | view | review | convert | manage_rules | manage_channels | admin |
|---|---|---|---|---|---|---|
| `intake.viewer` (≈ agent, read) | ✓ | | | | | |
| `intake.reviewer` (≈ agent) | ✓ | ✓ | ✓ | | | |
| `intake.manager` (≈ manager) | ✓ | ✓ | ✓ | ✓ | | |
| `intake.admin` (≈ admin) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `platform_owner` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

- The named "intake.* roles" are surfaced in the existing **`/admin/roles`** matrix UI as a
  new permission group — no new RBAC engine.
- Server Actions and RLS both check the action_key (defence in depth), reusing the existing
  `permission_overrides` lookup.

---

## 5. API design

### 5.1 In-app (Vercel) — Server Actions (`lib/actions/intake/*.ts`) + queries (`lib/queries/intake/*.ts`)
All RLS-respecting (user-session client), permission-gated, audited:
- **Channels:** `createChannel`, `updateChannel`, `pauseChannel`, `testChannel` (validates creds via worker callback), `deleteChannel`.
- **Queue/Review:** `getIntakeQueue(filters)`, `getMessage(id)`, `claimReview`, `approveClassification`, `editClassification`, `rejectMessage`, `assignReviewer`.
- **Work creation (orchestration):** `convertToRequest(messageId, payload)` → calls existing `createRequest(...)`; `convertToTask(...)` → `createTask(...)`; `convertToApproval(...)` → `sendAdHocApproval(...)`. Writes linkage to `intake_reviews`, logs `intake_audit_log`, notifies via `notify()`. **Never imports request-engine internals — only the public actions.**
- **Rules:** `createRule`, `updateRule`, `reorderRules`, `testRule(sampleMessage)`.

### 5.2 Worker ↔ platform (off-Vercel) — see §8
- Worker writes directly to `intake.*` via **service-role** (ingestion/normalization/classification).
- A thin authenticated callback surface on Vercel (or direct DB) for: channel credential test, "reprocess message", and health. Auth via `x-intake-worker-secret` (same shape as `x-cron-secret`).
- **Idempotency:** unique `(org_id, channel_id, external_message_id)` makes re-polling safe.

### 5.3 Event-driven integration
- Conversions emit an `intake_audit_log` event + an in-app notification; they do **not**
  reach into Requests/Tasks/Approvals tables directly — they call the actions, which already
  fire their own activity + notifications. One-directional, decoupled.

---

## 6. UI design (new primary nav: **Intake Intelligence**, gated by `has('intake')` + `intake.view`)

Route group `app/(app)/intake/**` (each route gets a `loading.tsx`; reuses shadcn + sidebar):

| Page | Route | Purpose | Min permission |
|---|---|---|---|
| Dashboard | `/intake` | KPIs: new, in-review, SLA-at-risk, conversion mix, channel health | `intake.view` |
| Intake Queue | `/intake/queue` | Triage list (filter by channel/state/assignee), bulk actions | `intake.view` |
| Review Center | `/intake/review/[id]` | Email viewer + suggested classification + Approve/Edit/Reject + Convert | `intake.review` |
| Channels | `/intake/channels` | Connect/manage mailboxes, status, last poll | `intake.manage_channels` |
| Rules Engine | `/intake/rules` | Keyword/classification/routing/priority rules + test | `intake.manage_rules` |
| Learning Center | `/intake/learning` | Feedback, accuracy, corrections | `intake.manager` |
| Analytics | `/intake/analytics` | Volume, SLA, conversion, source breakdown | `intake.view` |
| Settings | `/intake/settings` | Module defaults, reviewer routing, retention | `intake.admin` |

Sidebar: add an "Intake Intelligence" group rendered only when the org has the `intake`
module **and** the user holds `intake.view` (same `has(...)`/role pattern already in
`Sidebar.tsx`). `proxy.ts` `MODULE_ROUTES` gains `['/intake','intake']`.

---

## 7. Migration plan (additive, ordered, zero-regression)

Each is a standalone numbered migration in `supabase/migrations/` (continuing from 051).
All additive — no `ALTER`/`DROP` on existing module tables except the optional §3.4 nullable column.

1. `…_intake_module.sql` — `ALTER TYPE module_slug ADD VALUE 'intake'`; seed `org_module_access` default (disabled by default; enabled per-org by owner portal).
2. `…_intake_schema.sql` — create `intake` schema; `config.toml` exposure (separate ops step).
3. `…_intake_core_tables.sql` — channels, threads, messages, attachments (Phase A/B).
4. `…_intake_review_tables.sql` — classifications, reviews (Phase C/D).
5. `…_intake_rules_feedback.sql` — rules, feedback (Phase E/F).
6. `…_intake_audit.sql` — audit log + RESTRICTIVE insert-deny.
7. `…_intake_rls.sql` — all RLS policies + permission action_keys integration.
8. `…_intake_indexes.sql` — the §3.3 indexes.
9. `…_intake_source_link.sql` *(optional, Phase D)* — nullable `requests.intake_message_id` / `tasks.intake_message_id`.
10. `…_intake_storage.sql` / dashboard step — `intake-attachments` bucket.

> **Apply discipline:** `module_slug` `ADD VALUE` cannot run inside a txn with later use of
> the value in the *same* migration — keep the enum change in its own migration (consistent
> with how `activity_action` values were added historically).

---

## 8. Deployment & worker architecture (per the charter: **no polling on Vercel**)

```
            ┌─────────────────────────── Vercel (existing) ───────────────────────────┐
            │  Next.js RSC UI · Review Center · Dashboard · Channels/Rules config       │
            │  Server Actions (RLS) · convert→ existing createRequest/Task/Approval     │
            └───────────────▲───────────────────────────────────┬──────────────────────┘
                            │ reads/writes (RLS, user session)   │ notify(), audit
                            │                                     ▼
                   ┌────────┴───────────────── Supabase (Citykart Desk: jhdz…) ────────────┐
                   │  intake schema (RLS) · public (requests/tasks/…) · Storage · Vault  │
                   └────────▲───────────────────────────────────────────────────────────┘
                            │ service-role (bypasses RLS, sets org_id explicitly)
            ┌───────────────┴──────────── Intake Worker (Railway — like HRMS) ───────────┐
            │  Scheduler → mailbox poll (IMAP / MS Graph / Gmail API)                      │
            │  → normalize → dedup → store message+attachments → classify (rules/AI)       │
            │  → write intake_messages/classifications · update channel health             │
            └──────────────────────────────────────────────────────────────────────────┘
```

- **Worker** (Node, Railway): long-running scheduler; per-channel poll intervals; backoff on
  error; **idempotent** via unique external ids; reads channel creds from **Supabase Vault**
  (never plaintext, never in Vercel env). Deployable & scalable independently of the UI.
- **Vercel** does **zero** polling/long-running work (matches the platform's serverless model
  and the charter). Conversions (human-triggered) run as normal Server Actions.
- **Secrets:** mailbox credentials in Vault (decrypted only in the worker); worker holds the
  service-role key; any worker→Vercel callback uses a shared `x-intake-worker-secret`.
- **Failure isolation:** worker outage degrades *ingestion latency only* — the UI, review of
  already-captured mail, and all other modules keep working.

---

## 9. Implementation plan (phased; each phase shippable, gated by the `intake` module flag)

| Phase | Scope | Migrations | App work | Worker | Exit criteria |
|---|---|---|---|---|---|
| **A Foundation** | schema, module slug, RBAC, nav, dashboard, queue, channels CRUD, audit | 1–2,3(partial),6,7,8 | nav + `/intake`, `/intake/queue`, `/intake/channels`, `/intake/settings` | — | Module toggled on for a pilot org; empty queue renders; audit works |
| **B Email ingestion** | mailbox connect, retrieval, normalization, attachments, threads | 3(complete),10 | channel connect/test UI | **worker v1** (poll→store) | Real mail lands in `intake_messages` idempotently |
| **C Review Center** | reviewer workspace, email viewer, suggested classification, approve/edit/reject | 4 | `/intake/review/[id]` | — | Reviewer can triage a message end-to-end |
| **D Work creation** | convert → Request/Task/Approval + source linkage | 4,9 | convert actions + linkage UI | — | Message becomes a Request/Task/Approval, fully linked + audited |
| **E Rules engine** | keyword/classification/routing/priority rules + test | 5 | `/intake/rules` | worker applies rules | Rule auto-suggests type/service/team/priority |
| **F Intelligence** | confidence scoring, classification model, entity extraction, feedback loop | 5 | learning center | worker classifier + feedback ingestion | Suggestions carry confidence; corrections feed back |
| **G Omnichannel** | WhatsApp / Teams / Slack / API adapters | (channel-type rows only) | per-channel config | worker adapters | New channel types ingest via the same pipeline |

**Sequencing rules:** Phase A merges behind the module flag (off by default) → **zero user
impact** until enabled. Each later phase is independently deployable. Work-creation (D)
only ever *calls* existing actions.

---

## 10. Zero-regression & risk strategy

- **Module-flag dark launch:** `intake` defaults **disabled**; only pilot orgs see it. No nav,
  no routes, no queries for everyone else → impossible to affect Requests/Tasks/Approvals/SLA/KB.
- **No edits to existing module code** for Phases A–F (work creation uses public actions).
  The single optional touch (§3.4 nullable column) is additive and deferred to D.
- **RLS-first + permission action_keys** on every table and action (defence in depth).
- **HRMS untouched:** Intake lives only in the Citykart Desk project (`jhdz…`); the worker uses
  that project's service-role only. Zero contact with HRMS / `kxvd…`.
- **Idempotent ingestion** (unique external ids) → safe re-polling, no duplicate work.
- **Worker isolation:** off-Vercel; its failure never blocks the UI or other modules.
- **Audit everywhere:** `intake_audit_log` + reuse of action-level activity logs → every
  capture, classification, decision and conversion is traceable.
- **Perf-by-design:** indexes + RLS helper pattern from the recent perf/security work baked in
  from day one (no `count:'exact'` hot paths, no cross-org service-role reads).

---

## Decisions — locked ✅

| # | Decision | Chosen |
|---|----------|--------|
| 1 | Schema strategy | `public.intake_*` prefix (simpler, no schema switching overhead) |
| 2 | Worker host | Railway — separate `cognix/api` service matching `@hrms/api` pattern |
| 3 | Credential storage | Supabase Vault |
| 4 | Phase F classifier | Claude-based classifier in the Railway worker (Anthropic API) |
| 5 | Reverse source-link | Include `intake_message_id` on `requests` + `tasks` (better traceability) |

Blueprint approved. Build starts at **Phase A** behind the disabled module flag.
