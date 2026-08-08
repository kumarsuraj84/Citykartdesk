# Citykart Desk Intake — Classification Redesign (signal hierarchy + catalog-bound taxonomy)

> **Status:** FOR APPROVAL — design only, no engine code changed yet.
> **Trigger:** A payment notification (`payments-noreply@google.com`, "Your prepayment
> was successful") was classified **Informational** (correct) but also **IT → it_support →
> access** (wrong) — because the footer link "Sign in to your account" matched a body
> keyword. This is a structural flaw, not a missing rule.
> **Companions:** `docs/INTAKE-PHASE-C-DESIGN.md`, `docs/INTAKE-EFFICIENCY-PROPOSAL.md`.

---

## 1. Root cause of the misclassification

| Fact | Source |
|---|---|
| Sender is automated/transactional (`payments-noreply@`) | `sender_automated` rule fired → type=informational ✅ |
| But department came from the **body footer link** "Sign in to your account" | `sub_it_access` (`ruleset.ts:130`) matches `"sign in"`, `field:'both'` (whole body) |
| The spurious IT match **raised** confidence (informational score adds a dept bonus) | `rule-classifier.ts:138-142` |

Three design defects, all confirmed by the literature:

1. **No signal hierarchy.** Sender, subject and body are matched with the same flat
   weights. A footer link outranks the fact that the sender is a payments robot.
   → Research: [treat header/sender separately from body](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/6832244); [intent = subject + body + sender domain, weighted](https://krista.ai/solutions/email-classification-triage/).
2. **Whole-body, single-keyword matching.** Boilerplate (links, signatures, legal
   footers) is matched as if it were content.
   → Research: [single-keyword filters have high false-positive rates; use multi-keyword + context](https://help.proofpoint.com/Proofpoint_Essentials/Email_Security/Administrator_Topics/090_filtersandsenderlists/Word_Matching_in_Filters_and_How_to_Prevent_False_Positives), [word boundaries matter](https://www.spambrella.com/faq/word-matching-in-filters-to-prevent-false-positives/).
3. **Wrong signal inflates confidence.** Confidence rewards *any* department match, even an
   incidental one, so a wrong answer looks more certain. Confidence should reward
   **corroboration across tiers**, not single hits.

---

## 2. The taxonomy mismatch (why classification doesn't help conversion)

Intake invented a flat taxonomy (`department` / `category` / `subcategory` as free text) that
is **not connected** to how requests/tasks are actually created.

The real hierarchy (manual request creation, `lib/actions/requests.ts:34-253`):

```
service_categories (Category)
   └── services (Service)   ← has keywords[], team_id, default_priority, form_fields, sla_config, approval_workflow_id
          └── form_fields / form_sections  ← the actual fields a request needs
```

Picking a **service** is the single decision that yields `team_id`, `priority`,
`form_fields` and SLA. Yet intake conversion (`work.ts:145-177`) inserts `form_data: {}` and
the reviewer **re-picks the service and team by hand** — so classification's department/
category guesses are discarded.

**Key unused asset:** `services.keywords[]` already exists for routing/search — it is the
*designed matching vocabulary*, per service. Intake should classify against it.

---

## 3. Redesign — Part A: hierarchical signal model

Replace flat whole-body matching with **tiered, field-scoped signals** and a normalization
pass. Higher tiers gate lower ones.

### 3.1 Normalize before matching
Extend the existing normalizer (already strips signatures/quotes into `normalized.text`) to
also remove **link anchor text, footers, legal boilerplate, and unsubscribe blocks** before
body matching. "Sign in to your account" in a footer must not be treated as content.

### 3.2 Sender class (Tier 0 — identity, decided first)
Classify the *sender*, not the words, using the From address + headers
(`List-Unsubscribe`, `Auto-Submitted`, `Precedence: bulk`):

| Class | Signal | Effect |
|---|---|---|
| `automated` / `transactional` | `noreply`, `payments@`, receipt/confirmation subject | → **informational**; **suppress** body-derived request/task/approval and incidental department/subcategory |
| `bulk` / `marketing` | `List-Unsubscribe`, `newsletter@`, `Precedence: bulk` | → **ignore** |
| `human` / `internal` | normal mailbox, org domain | → eligible for actionable intent |

This single gate fixes the screenshot: a payments robot can no longer become an IT request
because of a "sign in" link.

### 3.3 Subject (Tier 1) > Body (Tier 2, de-boilerplated)
- Topic/department and intent are taken **from the subject first**; body only corroborates,
  at a lower weight.
- A department/category may be set from the body **only** if the subject or sender supports
  it (no department from a lone body token).

### 3.4 Subcategory requires a confident parent
Never emit a subcategory (e.g. `access`) unless its parent category was chosen by a
**higher-tier** signal. Subcategories are corroboration, not primary evidence.

### 3.5 Confidence = corroboration
Confidence rises when **independent tiers agree** (sender + subject + body), and stays low on
single-signal matches so they escalate (to Stage-2 model) or land for human review —
instead of a lone body keyword reading as 88%.

---

## 4. Redesign — Part B: catalog-bound taxonomy (hierarchy order)

Bind classification and conversion to the **real service catalog**, in the order a human uses
the form:

1. **Category** ← `service_categories` (match on slug/name).
2. **Service** ← `services` (match on `services.keywords[]` within the category). This is the
   decision that matters — it yields team, priority, form fields.
3. **Priority** ← `service.default_priority`, overridden only by a genuine urgency signal.
4. **Form fields** ← autofill `form_data` from extracted entities (amounts, dates, IDs) where
   `field.id` matches; leave unknown required fields for the reviewer.

Effects:
- Conversion stops inserting empty `form_data`; it resolves a real `service_id` →
  `team_id` + `default_priority` + `form_schema_snapshot`, and routing
  (`assignment_rules`, service > sub_category > category) runs as for manual requests.
- The **custom-rules** feature already points Category → `service_categories` and
  Subcategory → `services`; the engine is aligned to the same hierarchy (one vocabulary).
- `department` (free text) is demoted to a display hint; the **team** comes from the
  service, which is the system of record.

---

## 5. Phased plan

| Phase | Scope | Outcome | Risk |
|---|---|---|---|
| **F1** | Normalize boilerplate + **sender-class gating** + field-tiered weights | Fixes the screenshot class of bug; deterministic, cheap | Low — rules only |
| **F2** | **Catalog-bound matching**: classify against `services.keywords` / `service_categories`; conversion resolves real `service_id` (team, priority from service) | Classification feeds conversion; reviewer stops re-picking | Medium — touches conversion + review UI |
| **F3** | `form_data` autofill from entities + **confidence recalibration** (corroboration) | Well-formed requests; honest confidence | Medium |
| **F4** | LLM Stage-2 structured extraction for ambiguous mail (existing escalation seam) | 90–95% accuracy on the hard tail (vs ~40–50% rules) | Cost/infra — gated on API key |

**Recommended order: F1 → F2 → F3 → F4.** F1 is the immediate fix and is safe; F2 is the
structural payoff (intake finally produces a real request); F4 layers on later via the
pipeline's existing escalation.

---

## 6. Open decisions

1. **Engine direction:** ship the deterministic signal-hierarchy redesign (F1–F3) now and
   keep the LLM as the Stage-2 escalation? Or invest in the LLM classifier first?
2. **Catalog binding depth (F2):** classify only to **Category** (safer, reviewer picks the
   service), or all the way to a specific **Service** when `services.keywords` match
   confidently?
3. **Auto-fill form_data (F3):** attempt entity→field autofill, or leave `form_data` for the
   reviewer and only pre-resolve service/team/priority?
