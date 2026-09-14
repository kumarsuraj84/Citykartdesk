# PRE-PILOT CONFIGURATION DECISIONS

Business/admin ownership decisions only — no code defects here (all real code defects were fixed in Stage 7/7.1; see `STAGE_7_1_IMPLEMENTATION_REPORT.md`). Nothing in this document has been changed. Each item needs a decision from a real configuration owner before or during the pilot.

---

## 1. Dead Business Rules

**Current state**: 3 of the org's 4 `business_rules` rows are flagged `is_active=true` (1 on IT Support, 2 on HR Support), but each references a `category_id` that has since been deleted from `service_categories` — their match condition can never be satisfied. Confirmed via `business_rule_events`: exactly 1 fire in the table's entire history, and it belongs to the one rule that is *not* active (a disabled test schedule rule).

**Impact**: these 3 rules silently do nothing. An admin looking at the rules list would reasonably assume they're working.

**Recommended option**: repoint each rule's `conditions` to a currently-valid `category_id` under the correct service, if the original intent is still relevant.

**Alternative**: explicitly disable (`is_active=false`) if the routing intent is obsolete — cleaner than leaving a rule that looks active but is dead.

**Decision required from**: IT Support and HR Support service/rule owners (whoever originally configured "Kaushlesh IT Executive Rule," "Sweta HR Support Rule," "Suraj Rule for HR exit").

---

## 2. `assignment_rules` Empty Org-Wide

**Current state**: zero rows in `assignment_rules` for the entire organization. Every ticket — web or WhatsApp — falls through to its service's default team, unassigned to any individual.

**Impact**: no automatic direct/round-robin/load-balanced routing exists anywhere today. This is confirmed to be channel-neutral (WhatsApp doesn't bypass anything — there's nothing to bypass) — Stage 7's UAT-18c proved the engine *would* correctly evaluate a rule if one existed.

**Recommended option**: configure assignment rules for at least the services in the initial pilot scope (see item 6), so pilot tickets land with a named owner rather than only a team queue.

**Alternative**: accept "lands in the team queue, a human picks it up" as the deliberate pilot-phase behavior — valid if team sizes are small enough that queue-based pickup is already the normal workflow.

**Decision required from**: whoever owns ticket-routing policy (likely the same admin/platform owner who'd configure Business Rules).

---

## 3. Unstaffed Services

**Current state**: only IT Support and HR Support have a staffed default team (3 active members each). Finance & Accounts, L&D, BD, Legal, and Vendor Creation Support all route to a default team with **zero active members**.

**Impact**: a real WhatsApp (or web) ticket for any of these 5 services would be created correctly but have no one assigned to notice/work it, beyond whoever happens to check the team's queue.

**Recommended option**: staff each team with at least one active member before including that service in a pilot.

**Alternative**: exclude the 5 unstaffed services from the initial pilot scope entirely (see item 6) and add them once staffed.

**Decision required from**: whoever owns team membership/HR staffing for each of those 5 service areas.

---

## 4. BD Support Team Naming

**Current state**: BD Support's `default_team_id` resolves to a team literally named "ADMIN Support" — a naming/config mismatch (cosmetic, not functional; tickets still route somewhere, just to a confusingly-named team).

**Impact**: low — purely a source of admin confusion when reviewing team assignments, not a functional defect.

**Recommended option**: either rename the team to something BD-appropriate, or repoint BD Support's `default_team_id` to a correctly-named team if "ADMIN Support" was never actually meant to own BD tickets.

**Decision required from**: whoever owns BD Support's configuration.

---

## 5. WiFi/Network Support Catalogue Gap

**Current state**: real WhatsApp issue-search testing (Stage 7) confirmed the query "wifi" returns **zero** matching sub-categories under IT Support — there is no WiFi/network-connectivity sub-category in the real catalogue at all. Every other tested term (printer, laptop, password, salary, vendor, invoice, refund) returned reasonable results; this is a content gap, not a search-algorithm defect, and no search code was changed.

**Impact**: a real requester with a WiFi/connectivity issue gets no relevant match and would need to phrase their issue differently or ask an agent to file it manually.

**Recommended option**: add a WiFi/Network Connectivity sub-category under IT Support if this is a real, recurring request type.

**Alternative**: leave as-is if WiFi issues are genuinely rare/out of scope for this desk, or already covered under a differently-named existing sub-category not surfaced by this exact query.

**Decision required from**: IT Support's service/catalogue owner.

---

## 6. Pilot Scope

**Recommendation**: start the controlled pilot with **IT Support and HR Support only** — the only 2 of 7 real services with a staffed default team today (item 3), meaning a real pilot ticket will actually reach a person. Both also have solid mandatory-field coverage exercised end-to-end in Stage 7/7.1 (including the real semantic-role Subject/Description fix, proven live against IT Support's actual template).

**Alternative**: include additional services once their teams are staffed (item 3) and, if desired, assignment/business-rule routing is configured for them (items 1-2) — otherwise pilot testers on those services will only see queue-based, unassigned tickets.

**Decision required from**: whoever owns the overall WhatsApp pilot rollout plan.
