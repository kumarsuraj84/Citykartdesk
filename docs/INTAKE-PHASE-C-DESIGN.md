# Citykart Desk Intake Intelligence — Phase C Design (Classification Layer + Review Center)

> **Status:** FOR APPROVAL — no Phase C code written yet.
> **Premise:** The accepted ingestion architecture (channels → poll → normalize → dedup →
> queue) is **unchanged**. Phase C adds a channel-agnostic **classification layer** and a
> **Review Center**.
> **Phase C scope:** implement **Stage 1 (Rule Engine) only** — but design the schema,
> services and APIs to be **provider-agnostic and multi-stage** so future stages drop in
> without migration redesign:
> - **Stage 1 — Rule Engine** (default, deterministic, ships in Phase C)
> - **Stage 2 — Local Models** (Qwen / Llama / Mistral) — future
> - **Stage 3 — Premium AI** (Claude / GPT) — future, invoked **only when confidence < threshold**
>
> **Companion:** `docs/INTAKE-INTELLIGENCE-BLUEPRINT.md`.

---

## 1. Architecture assessment

### What we keep (accepted, untouched)
`intake_channels → worker poll → normalize → dedup → intake_messages (+threads, +attachments)`.
This is channel-agnostic at the storage layer: every inbound item, regardless of channel,
lands as an `intake_messages` row with normalized text. Email is just the first channel.

### What Phase C adds
A **provider-agnostic, multi-stage classification pipeline** between *captured* and
*actionable*. Phase C implements Stage 1 only; the pipeline is built to escalate:

```
intake_messages (status='normalized')
   │
   ▼  ┌─────────────── Classification Pipeline (orchestrator) ───────────────┐
      │  Stage 1: Rule Engine        → confidence ≥ threshold?  ─yes─┐         │
      │     │ no                                                     │         │
      │     ▼                                                        │         │
      │  Stage 2: Local Model (Qwen/Llama/Mistral)  [future]  ──────►│ accept  │
      │     │ still < threshold                                      │         │
      │     ▼                                                        │         │
      │  Stage 3: Premium AI (Claude/GPT)           [future]  ──────►│         │
      └────────────────────────────────────────────────────────────┘─────────┘
   │      (each stage writes an intake_classifications row; winner = is_final)
   ▼
intake_classifications   (one row per stage attempt: stage, provider, model, confidence)
   │
   ▼
intake_reviews           (human triage state machine; reviewer can override)
   │
   ▼  Review Center UI: Approve / Modify / Reject
(approved) ──► Phase D: Request / Task / Approval   |   (rejected) ──► Ignore
```

In Phase C the orchestrator has exactly **one stage registered** (Rule Engine). Adding
Stage 2/3 later is *registering another provider* — no schema or API change.

### Design principles
1. **Channel-agnostic engine.** The classifier consumes a normalized *envelope*
   (`subject`, `text`, `sender`, `channel`, `metadata`) — never email-specific fields. When
   WhatsApp/Slack/Teams arrive, they populate the same envelope and reuse the same engine
   with zero changes.
2. **Suggestion ≠ decision.** `intake_classifications` records what the engine proposed
   (immutable history). `intake_reviews` records what the human decided (overridable). This
   separation is what makes the system auditable and lets us later compare AI vs human
   (Phase F feedback loop) without schema churn.
3. **Explainable, not magic.** Every suggestion stores the matched keywords/rules + a
   rationale string, so reviewers trust (or correct) it. This is the foundation a future
   LLM layer augments — it does not replace it.
4. **Where it runs:** in the **Railway worker**, right after `storeMessage`. Classification
   is async/bulk work that must stay off Vercel (same reasoning as polling). A re-classify
   endpoint backfills the existing 441 messages.
5. **Dark launch preserved.** Still gated behind the disabled `intake` module flag.

---

## 2. Required schema changes (additive only)

### 2.1 New enums
```sql
-- Work type the engine/reviewer assigns. Stable set → enum is safe.
CREATE TYPE intake_work_type AS ENUM ('request', 'task', 'approval', 'ignore');

-- Product-spec priority. NOTE: existing request_priority is low/medium/high/URGENT.
-- We keep 'critical' here (product language) and map critical→urgent at Phase D conversion.
CREATE TYPE intake_priority AS ENUM ('low', 'medium', 'high', 'critical');

-- Review triage state machine.
CREATE TYPE intake_review_state AS ENUM
  ('pending', 'in_review', 'approved', 'rejected', 'converted');

-- Pipeline stage that produced a classification. Future stages already named so no
-- enum migration is needed when Stage 2/3 ship.
CREATE TYPE intake_pipeline_stage AS ENUM
  ('rule', 'local_model', 'premium_ai', 'manual');
```

**Department is NOT an enum.** Org departments are free-form (`departments.name`, per org).
Classification stores a **canonical department slug** (`hr|payroll|finance|it|admin|
facilities|operations|unknown`) as `TEXT`. Phase D maps the slug → the org's real
`departments`/`teams` row for routing. This keeps the taxonomy editable per org later
without enum migrations.

### 2.2 `intake_classifications` (provider-agnostic — one row per stage attempt)
Designed so Stage 1/2/3 all write the **same shape**. No column is email- or rule-specific.
```
id, org_id, message_id (FK intake_messages),
stage               intake_pipeline_stage ('rule'|'local_model'|'premium_ai'|'manual')
provider            TEXT          -- 'rule_engine' | 'qwen2.5' | 'llama3.1' | 'mistral' | 'claude' | 'gpt-4o' | 'human'
model_version       TEXT          -- specific model/ruleset version, e.g. 'ruleset@2026-06' or 'qwen2.5:7b'
suggested_type      intake_work_type
suggested_department TEXT          -- canonical slug, nullable
suggested_priority  intake_priority
confidence          INTEGER CHECK (0..100)
is_final            BOOLEAN DEFAULT false   -- the row the pipeline settled on for this message
evidence            JSONB          -- stage-agnostic "why": rules→matched_terms; models→tokens/logprobs/raw
entities            JSONB          -- extracted hints (amounts, dates, deadlines) — light in C
rationale           TEXT           -- human-readable explanation
latency_ms          INTEGER        -- per-stage timing (ops/cost visibility; ~0 for rules)
cost_microcents     INTEGER        -- per-call cost for paid stages (0 for rule/local); future-proofs billing
created_at
```
- **Multiple rows per message** = the audit trail of every stage that ran. `is_final=true`
  marks the accepted one (what the Review Center shows and what Phase D converts).
- `stage`/`provider`/`model_version` make the source fully traceable and let Phase F compare
  rule vs local vs premium accuracy with **no schema change**.
- `evidence` is a generic JSONB so each stage stores its native explanation (rule matches,
  or model logits/raw response) under one column.

### 2.3 `intake_reviews` (human triage — one per message, overridable)
```
id, org_id, message_id (UNIQUE, FK intake_messages),
thread_id            (FK intake_threads, nullable)
state                intake_review_state DEFAULT 'pending'
assigned_reviewer_id (FK profiles, nullable)
suggested_classification_id (FK intake_classifications, nullable)  -- what engine proposed
-- Reviewer's chosen (possibly overridden) values; seeded from the suggestion:
chosen_type          intake_work_type
chosen_department    TEXT
chosen_priority      intake_priority
was_overridden       BOOLEAN DEFAULT false   -- true if chosen_* differs from suggested_*
decision_notes       TEXT
reviewed_by          (FK profiles, nullable)
reviewed_at          TIMESTAMPTZ
-- Phase D linkage (added now, nullable, unused until D):
created_request_id   UUID  -- soft ref, ON DELETE SET NULL
created_task_id      UUID
created_approval_id  UUID
created_at, updated_at
```

### 2.4 Message status flow
Reuse the existing `intake_message_status` enum (already has `classified`, `in_review`,
`actioned`, `rejected`). Pipeline transitions:
`normalized → classified` (engine done) → `in_review` (reviewer claims) →
`actioned` (Phase D) | `rejected` (ignored).

### 2.5 Indexes (perf-by-design)
```
intake_classifications (message_id, created_at DESC)
intake_reviews (org_id, state, created_at DESC)         -- queue list
intake_reviews (org_id, assigned_reviewer_id, state)    -- "my reviews"
intake_reviews (message_id) UNIQUE
```

### 2.6 RLS (same model as Phase A)
- Both tables: `org_id = current_org_id()` + role gate (`agent|manager|admin|platform_owner`)
  for SELECT.
- `intake_reviews` UPDATE: reviewer/manager/admin (the `intake.review` capability).
- `intake_classifications` is **worker-written** (service-role) → no authenticated INSERT;
  authenticated gets SELECT only. Manual re-classify also runs via worker/service-role.
- Reuses `current_org_id()`, `current_user_role()` — no new helpers.

### 2.7 `intake_pipeline_config` (provider-agnostic pipeline settings — per org)
So Stage 2/3 need **no migration** to turn on, the pipeline is configured by data, not code:
```
org_id              UUID UNIQUE (FK organizations)
config              JSONB   -- see shape below
updated_by, updated_at
```
`config` shape (Phase C seeds a Stage-1-only default):
```json
{
  "stages": [
    { "stage": "rule",        "provider": "rule_engine", "enabled": true,  "min_confidence": 0 },
    { "stage": "local_model", "provider": "qwen2.5",     "enabled": false, "min_confidence": 70 },
    { "stage": "premium_ai",  "provider": "claude",      "enabled": false, "min_confidence": 70 }
  ],
  "escalate_below_confidence": 70,   -- run next enabled stage if best-so-far < this
  "auto_accept_at_confidence": 90    -- stop early if a stage clears this
}
```
Turning on Stage 2 later = flip `enabled:true` (a config write), not a migration. Thresholds
are per-org tunable from day one.

### 2.8 Rules storage (Stage-1 content)
- **(Phase C) Code-defined default ruleset** in the worker
  (`api/src/intake/classify/ruleset.ts`), versioned in git — the Stage-1 provider's content.
  Fastest to ship, classifies all 441 immediately, deterministic, tuned via PRs.
- **(Phase E) `intake_rules` table + management UI** layered on top: org admins add/override
  rules; the Rule provider merges org rules over defaults. Deferred so C stays focused.

The Rule provider reads rules through one interface (`getRules(orgId)`) returning the default
set in C and `default + org` in E — no engine rewrite.

---

## 3. Classification pipeline design (provider-agnostic; Stage 1 only in C)

### 3.0 The provider-agnostic contract (the keystone)
Every stage — rules now, local models and premium AI later — implements **one interface**.
The orchestrator knows nothing about *how* a classifier works, only this contract:

```ts
// Channel-agnostic AND provider-agnostic input.
interface IntakeEnvelope {
  subject: string | null
  text: string                 // normalized body (signatures/quotes stripped)
  sender: string | null        // email / phone / handle — channel-dependent
  channelType: string          // 'email' | 'whatsapp' | ...
  metadata?: Record<string, unknown>
}

interface ClassificationResult {
  suggestedType: 'request' | 'task' | 'approval' | 'ignore'
  suggestedDepartment: string | null   // canonical slug
  suggestedPriority: 'low' | 'medium' | 'high' | 'critical'
  confidence: number                   // 0–100
  evidence: Record<string, unknown>    // native explanation (rule matches | model logits | raw)
  rationale: string
  entities?: Record<string, unknown>
}

// EVERY stage implements this — Stage 1/2/3 are interchangeable to the orchestrator.
interface Classifier {
  readonly stage: 'rule' | 'local_model' | 'premium_ai'
  readonly provider: string            // 'rule_engine' | 'qwen2.5' | 'claude' | ...
  readonly modelVersion: string
  classify(env: IntakeEnvelope): Promise<ClassificationResult>
}
```

Phase C ships exactly one implementation: `RuleClassifier`. A future `LocalModelClassifier`
or `PremiumAiClassifier` implements the same interface and is registered with the
orchestrator — **no orchestrator, schema, or API change**.

### 3.1 Orchestrator (escalation logic)
```
load intake_pipeline_config(orgId)
best = null
for stage in config.stages where enabled (in order):
    result = registry[stage.provider].classify(envelope)
    persist intake_classifications row (stage, provider, model_version, confidence, ...)
    best = max(best, result) by confidence
    if best.confidence >= config.auto_accept_at_confidence: break
    if best.confidence >= config.escalate_below_confidence: break   # good enough; don't escalate
mark best row is_final = true
create/refresh intake_reviews(state='pending', suggested_classification_id = best)
set message.status = 'classified'
```
- In Phase C only the `rule` stage is enabled, so the loop runs once. The escalation
  machinery exists and is exercised the moment Stage 2 is flipped on.
- **Stage 3 (premium AI) only fires when confidence is below threshold** — exactly the
  cost-control requirement — because it's the last enabled stage and the loop reaches it
  only if earlier stages stayed under `escalate_below_confidence`.

### 3.2 Rule shape (Stage-1 provider content)
```ts
interface ClassificationRule {
  key: string                 // stable id e.g. 'payroll_keywords'
  dimension: 'type' | 'department' | 'priority'
  match: {
    anyKeywords?: string[]    // case-insensitive, word-boundary
    regex?: string            // optional pattern
    senderDomain?: string[]   // e.g. ['@payroll.acme.com']
    field?: 'subject' | 'text' | 'both'  // default 'both'
  }
  output: { type?; department?; priority? }
  weight: number              // contribution to confidence (1–10)
}
```

### 3.3 Default ruleset (seed — covers the given examples)
| Dimension | Trigger keywords (examples) | Output |
|---|---|---|
| department=payroll, type=request | salary, payroll, bonus, arrears, payslip, reimbursement | Payroll Request |
| department=hr, type=request | leave, attendance, onboarding, resignation, appraisal | HR Request |
| department=finance, type=request | invoice, payment, budget, expense, vendor | Finance Request |
| department=it, type=request | password, laptop, access, VPN, software, error, bug | IT Request |
| department=facilities | desk, seating, AC, cleaning, maintenance | Facilities |
| type=approval | approve, approval, sanction, authorbize, sign-off, authorized | Approval |
| type=task | update, complete, submit, review, prepare, "before friday", deadline | Task |
| priority=critical | urgent, asap, critical, immediately, "right away", outage, "system down" | Critical |
| priority=high | "end of day", EOD, "by today", "before friday", escalate | High |
| (no match) | — | type=ignore, confidence low → needs review |

### 3.4 Scoring & confidence (transparent formula)
1. Evaluate all rules against the envelope; collect matches per dimension with weights.
2. For each dimension, the **highest-weighted matching output wins**; ties → first by rule
   order.
3. **Confidence (0–100)** = blend of:
   - coverage: did we resolve type? (+40 if a non-ignore type matched)
   - corroboration: number/weight of matching rules for the chosen type/department
     (normalized, up to +40)
   - signal clarity: department resolved (+10), priority signal present (+10)
   - Floor/ceiling clamped to [0,100]. No match → type=ignore, confidence ≤ 20.
4. `rationale` lists the matched terms per dimension (e.g. *"type=approval (matched:
   'approve','sign-off'); dept=payroll (matched: 'salary','arrears')"*).

Deterministic, explainable, unit-testable — and the exact substrate Stages 2/3 augment.
A local/premium model later produces an alternative `intake_classifications` row (its own
`stage`/`provider`), and the feedback loop compares stages with no schema change.

### 3.5 Where & when it runs
- **New messages:** worker runs the **pipeline orchestrator** immediately after
  `storeMessage`, which writes one `intake_classifications` row per enabled stage, marks the
  winner `is_final`, creates `intake_reviews(state='pending')`, and sets message status
  `classified`.
- **Backfill (the 441):** a worker endpoint `POST /intake/reclassify` (worker-secret) runs
  the pipeline over messages lacking a final classification, in batches. Idempotent: replaces
  this message's stage rows and re-marks `is_final`.
- **Re-run after rule/config changes (Phase E+):** same endpoint.
- **Provider isolation:** Stage 2/3 calls (HTTP to a local model server or a premium API)
  live entirely in the worker; Vercel never calls models. A stage failure is caught, logged,
  and the pipeline falls back to the best result so far — ingestion/queue keep working.

---

## 4. Review Center design

### 4.1 Queue — `/intake/queue` (upgraded)
Columns exactly per spec:

| Subject | Sender | Suggested Type | Suggested Dept | Suggested Priority | Confidence | Status |
|---|---|---|---|---|---|---|

- Confidence rendered as a chip with band colour (e.g. ≥70 green, 40–69 amber, <40 grey).
- Filters: channel, type, department, priority, state, "assigned to me", confidence band.
- Low-confidence rows visually flagged ("needs review").
- Sort: newest, or lowest-confidence first (triage hardest first).
- Driven by `intake_reviews` ⨝ `intake_messages` ⨝ `intake_classifications WHERE is_final`.
- Confidence chip may show the winning stage/provider on hover (e.g. "rule_engine · 82") so
  reviewers see *which* stage produced it — meaningful once Stage 2/3 are live.
- No `count:'exact'` on the hot list (estimated counts), per perf rules.

### 4.2 Review screen — `/intake/review/[id]`
Two-pane, per spec:

**Left — the source (read-only):**
- Full message: subject, sender, recipients, received time, body (rendered safely).
- Attachments (download via server-generated signed URL from `intake-attachments`).
- Thread context (other messages in the same `intake_threads` row).

**Right — the classification (editable):**
- Suggested Type ▸ editable dropdown (request/task/approval/ignore)
- Suggested Department ▸ editable dropdown (canonical slugs; "unknown" allowed)
- Suggested Priority ▸ editable dropdown (low/medium/high/critical)
- Confidence ▸ read-only chip + rationale ("why")
- Decision notes ▸ free text

**Actions:**
- **Approve Suggestion** → `state='approved'`, `chosen_*` = suggested_*, `was_overridden=false`.
- **Modify Suggestion** → `state='approved'`, `chosen_*` = edited values, `was_overridden=true`.
  (Modify is approve-with-overrides — same terminal state, flagged for the Phase-F feedback loop.)
- **Reject** → `state='rejected'`, message status `rejected` (the "Ignore" branch).
- **Claim/Assign** → `state='in_review'`, `assigned_reviewer_id`.
- **No "Convert" button yet** — that arrives in Phase D, enabled only for `approved` reviews.

Every action writes `intake_audit_log` and is permission-gated (`intake.review`).

### 4.3 Permissions
- View queue/review: `intake.view` (agent+).
- Approve/Modify/Reject/Assign: `intake.review` (agent+ acting as reviewer; manager/admin).
- Same role-based RLS as Phase A; app-layer action checks for defence in depth.

---

## 5. Migration strategy (additive, ordered, zero-regression)

| # | Migration | Contents |
|---|---|---|
| 055 | `intake_classification.sql` | new enums (work_type, priority, review_state, **pipeline_stage**); `intake_classifications` (stage/provider/model/is_final/confidence/...), `intake_reviews`, **`intake_pipeline_config`** tables; indexes; RLS; grants; seed a Stage-1-only pipeline config per org |
| (worker) | pipeline + Stage-1 provider + `/intake/reclassify` | `Classifier` interface, orchestrator, `RuleClassifier` + default ruleset, backfill |
| (app) | Review Center | upgraded `/intake/queue`, new `/intake/review/[id]`, queries + review actions |

**Sequencing & safety:**
1. Apply 055 (additive — no change to existing tables; `intake_*` only).
2. Deploy worker with the engine; classification auto-runs on new mail.
3. Hit `/intake/reclassify` once to classify the existing 441.
4. Ship the Review Center UI (behind the existing disabled module flag → zero user impact).
5. **Priority mapping note for Phase D:** `intake_priority.critical` → `request_priority.urgent`
   when converting; document the map in the Phase D conversion layer.
6. **No existing module touched.** Departments/teams/requests untouched until Phase D
   (which only *reads* them to route, and only *calls* existing public actions).

---

## Provider-agnostic guarantees (how future stages drop in with no migration)
| Concern | Made future-proof by |
|---|---|
| New stage/provider | `intake_pipeline_stage` enum already lists `local_model`/`premium_ai`; `provider`/`model_version` are free TEXT |
| Turning a stage on | flip `enabled:true` in `intake_pipeline_config.config` (data write, **no migration**) |
| Per-org thresholds | `escalate_below_confidence` / `auto_accept_at_confidence` in config from day one |
| Stage results & audit | every stage writes the same `intake_classifications` shape; `is_final` picks the winner |
| Cost/latency tracking | `cost_microcents` / `latency_ms` columns exist now (0 for rule stage) |
| Service contract | one `Classifier` interface; orchestrator is provider-blind |
| Explanations | generic `evidence` JSONB holds rule matches *or* model output |

Stage 2 (local models) and Stage 3 (premium AI) are therefore **additive code + a config
flip** — no schema redesign, ever.

## Open decisions for approval
1. **Department storage:** canonical **TEXT slug** (recommended) vs enum vs immediate map to
   the org `departments` table.
2. **Priority set:** keep product-spec **`critical`** in intake + map to `urgent` at Phase D
   (recommended) vs align intake to existing `urgent` now.
3. **Rules location for C:** **code-defined default ruleset** now, `intake_rules` table + UI
   in Phase E (recommended) vs build the rules table/UI inside Phase C.
4. **"Modify" modelling:** approve-with-overrides (`was_overridden=true`, recommended) vs a
   distinct `modified` state.
5. **Backfill the 441 now** via `/intake/reclassify` (recommended) vs only classify
   go-forward mail.
6. **Default thresholds:** `escalate_below_confidence=70`, `auto_accept_at_confidence=90`
   (recommended starting values) — tunable per org later.

Nothing is built until these are confirmed.
