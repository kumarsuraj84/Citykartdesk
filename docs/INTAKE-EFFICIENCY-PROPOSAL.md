# Cognix Intake — Triage Efficiency Proposal (Action Layer)

> **Status:** FOR APPROVAL — diagnosis + phased plan, no module code written yet (the two
> shipped changes referenced in §2 are the only code so far).
> **Premise:** Phase C (classification) and Phase D (work conversion) are accepted and
> **unchanged**. This proposal adds the **action layer** on top of them — the part that
> turns "every mail gets classified" into "the human only touches what needs a human."
> **Companions:** `docs/INTAKE-INTELLIGENCE-BLUEPRINT.md`, `docs/INTAKE-PHASE-C-DESIGN.md`.

---

## 1. The problem (why intake doesn't feel like it's saving time)

The owner's words: *"if I need to review this much, I'll just read the mail."* That is the
correct diagnosis. Today Cognix Intake is **a classifier bolted onto a second inbox**:

```
mail → classify (type/dept/priority/confidence)  ✅ good
     → drop almost everything into "Needs Review"  ❌ the problem
     → human opens each one, reads it, picks 5 dropdowns,
       fills title/description, picks team/service, clicks "Create"  ❌ 3–5 clicks, 1-by-1
```

Concretely, from the codebase:

| Symptom | Evidence | Why it hurts |
|---|---|---|
| Per-item manual conversion | `ReviewClient.tsx` right sidebar = classification form + work form; 3–5 clicks per message | Same effort as just reading the email |
| No bulk / no keyboard | `InboxList.tsx:68–112` — no multi-select, no shortcuts, one row at a time | High-volume senders = death by a thousand clicks |
| Queue sorted by **arrival time**, not importance | `InboxList.tsx:94–102` client-side `date`/`confidence` sort only | System never answers *"what do I do first?"* |
| Rich signals captured then ignored | `intake_messages.headers`, `intake_threads.message_count`/`participant_emails`, `intake_classifications.entities` JSONB — all dead | No basis for smart priority |
| No feedback loop | `intake_reviews.was_overridden` stored on every correction, never read | Accuracy never improves; can't safely automate |
| Manual work-item creation even at 95% confidence | `work.ts:74–295` `approveAndCreate()` always human-triggered | The actual value (actionable mail) stays 100% manual |

**Net:** we automate away only high-confidence FYI/junk (see §2). Everything with real value
still lands on the desk, fully manual, in arrival order. That is additive work, not saved work.

---

## 2. Already shipped (foundation for this proposal)

Two changes landed before this doc and the rest builds on them:

1. **Auto-resolve high-confidence FYI/junk** (`orchestrator.ts:170–175`) — `informational`/`ignore`
   at confidence ≥ 80 are resolved by the pipeline (review state `approved`, `reviewed_by`
   null so a forced re-classify can revisit), junk archived. This removed ~411 of ~446 items
   from the queue. **This proposal is the inverse of that idea applied to actionable mail.**
2. **"Needs Review" KPI** now counts the review state machine, not `message.status`
   (`lib/queries/intake/index.ts`), so the card matches the worklist.

---

## 3. What efficient triage products actually do (market research, Jun 2026)

The market has moved past "classify + manual queue." The throughline is **"only touch the
messages that need your brain"** — the AI acts *before* a human sees it.

| Pattern | Source | Cognix gap |
|---|---|---|
| **Auto-route before a human looks** — intent → category + team + queue automatically | [Front "Topics"](https://front.com/blog/ai-email-management); [Missive AI Rules](https://missiveapp.com/blog/autopilot-for-your-inbox-ai-rules-have-arrived) | No auto-routing; `suggested_department` never maps to a team/service |
| **Chained auto-actions on arrival** — assign, label, create task, log to CRM | [Missive](https://missiveapp.com/blog/6-ways-to-use-ai-in-your-email-inbox) | Conversion is 100% manual |
| **Auto-extract tasks + deadlines** — "send by Thursday" → task with due date | [alfred_](https://get-alfred.ai/blog/what-is-ai-inbox-triage); [Jotform](https://www.jotform.com/ai/agents/email-triage/) | Deadline phrases matched for *priority* only, never become due dates |
| **Confidence-gated autonomy** — mature LLM triage **90–95%** accuracy vs **40–50%** for keyword rules | [Robylon](https://www.robylon.ai/blog/ai-email-triage-classify-route-prioritize) | Stage 1 is keyword rules; no learning loop to climb toward auto-action-safe accuracy |
| **Draft the reply** for routine threads — approve, don't compose | [Front/Superhuman Copilot](https://front.com/blog/ai-email-management) | No draft generation |
| **Prioritize by urgency + importance + sentiment + VIP** | [BoldDesk](https://www.bolddesk.com/blogs/ai-email-triage); [Kommunicate](https://www.kommunicate.io/blog/ai-email-routing-and-prioritization/) | Queue is chronological |

**Takeaway:** Cognix already owns the hard part — a clean, provider-agnostic, multi-stage
pipeline. What's missing is the **action layer**. Everything below is additive and reuses
existing infrastructure (RLS, audit, the public `createRequest`/`createTask` actions).

---

## 4. Proposed roadmap (ranked by leverage)

Sequenced so each phase **de-risks the next**: prove the scores are trustworthy (E1) before
acting on them autonomously (E2).

### Phase E1 — Prioritized queue *(fastest win, ~2–3 days)*
Replace chronological ordering with a server-side **urgency score** computed from signals
**already stored but unused**.

- **Signals:** deadline phrases + "urgent/ASAP/critical" (already in `ruleset.ts` priority
  rules), thread `message_count` + `participant_emails` length (`intake_threads`), sender
  reputation (new lightweight rollup), money/amounts from `entities` JSONB, age.
- **Where:** add `priority_score INT` (or compute in `getIntakeReviewQueue`,
  `lib/queries/intake/index.ts:128–174`); order the queue by it; surface a "Top 3 to handle
  now" band at the top of the review folder.
- **No new model calls.** Pure scoring over existing columns.
- **Win:** the queue finally answers *"what first?"* and proves whether confidence/priority
  are trustworthy — the prerequisite for E2.

### Phase E2 — Auto-convert high-confidence actionable mail *(highest volume reduction, ~3–5 days)*
The inverse of the FYI auto-resolve. When confidence ≥ threshold **and** a
`department → service/team` mapping resolves, the pipeline **creates the request/task itself**.

- **New:** small `intake_routing_rules` table (org-scoped: `department`/`category` →
  `service_id`/`team_id`/default priority). Reuses the existing `default_team_id` per channel
  as fallback.
- **Where:** extend `orchestrator.ts` post-classification (mirror the §2 auto-resolve branch)
  to call the existing `approveAndCreate()` (`work.ts:74–295`) with `reviewed_by` null.
- **Safety:** land auto-created items in an **"Auto-created — undo"** lane for a grace window;
  audit every machine conversion; never auto-convert below threshold or without a mapping.
- **Win:** the ~35 actionable items that currently demand full manual handling convert
  themselves when confident; humans see only the ambiguous remainder.

### Phase E3 — Bulk + keyboard triage *(clears the remainder, ~2–3 days)*
For whatever still needs a human, cut per-item cost ~80%.

- **Where:** `InboxList.tsx` — checkbox multi-select + batch approve/convert/reject;
  `j/k` to move, `e` to convert, `r` to reject. Add inline quick-action buttons on rows.
- **Win:** the residual queue is handled in seconds, in batches, not one modal at a time.

### Phase E4 — Learning loop *(compounding accuracy, ~3–4 days)*
Use the corrections we already record.

- **Where:** read `intake_reviews.was_overridden` + final-vs-suggested deltas; per-org,
  nudge `ruleset.ts` weights (or build few-shot examples for the Stage 2 model in
  `local-model-classifier.ts`).
- **Win:** accuracy climbs toward the 90%+ band that makes E2's threshold safe to lower →
  more auto-conversion over time. Self-reinforcing.

### Phase E5 — Draft-reply / auto-acknowledge *(optional, model-dependent)*
For routine requests, generate a draft acknowledgement/reply the human approves instead of
writing. Requires Stage 2/3 model enabled. Lowest priority; highest model cost.

---

## 5. Recommended starting point

**E1 → E2 → E3.** E1 is the cheapest and immediately makes the product feel useful (top-3
ranking), and it generates the evidence needed to trust E2's auto-conversion. E4 runs in the
background to compound accuracy; E5 is optional polish.

---

## 6. Risk & rollback

- **Every phase is additive** and gated. E2 auto-conversion is behind a per-org threshold +
  routing-rule requirement + undo lane; disabling it reverts to today's manual flow with zero
  data change (same `approveAndCreate` path, just human-triggered).
- **No existing module is modified** — work creation continues through the public
  `createRequest`/`createTask` interfaces (`work.ts`), preserving the zero-coupling guarantee
  from the blueprint.
- **Machine decisions are reversible** — consistent with the shipped FYI auto-resolve,
  `reviewed_by` stays null on all pipeline-made decisions so a forced re-classify can revisit,
  and humans can override anything.

---

## 7. Open questions for the owner

1. **Auto-convert threshold** — start conservative (e.g. ≥ 90, same as `auto_accept_at_confidence`)
   and lower as E4 proves accuracy? Or stay manual until E4 lands?
2. **Routing rules** — author them in an admin UI, or seed a sensible `department → service`
   default and refine later?
3. **Undo window** for auto-created work items — minutes, hours, or a manual "confirm batch"?
