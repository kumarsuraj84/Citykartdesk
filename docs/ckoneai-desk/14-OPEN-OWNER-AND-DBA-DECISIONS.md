# 14. Open owner and DBA decisions

Status: LOCAL, 2 Nov 2026. Plain language. Each line says what is asked, my recommendation, and what it blocks.

## Owner answers recorded 2 Nov 2026 (given to the CKDesk session in chat)

| # | Question | Owner's answer |
|---|---|---|
| 1 | Who may use it first | **Everyone except vendor logins** (setting `CKONEAI_PILOT_USER_IDS=*`) |
| 2 | Company-wide summaries (category, SLA by store, CSAT) | **Managers and above only** (new signed role `manager`; sent only after CKOneAI confirms it accepts it) |
| 3 | Plain HTTP for the trial | **Accepted** |
| 4 | How-to answers from documents | **Not in the trial; second step later** |
| 5 | Approval steps to the data platform ("approvals waiting for me") | **Yes, prepare** (local; 01-DBA told first) |
| 6 | Team membership and manager id to the data platform | **Yes, prepare now with the approval steps** |
| 7 | "About to breach" | **4 hours, same as the At risk badge** |
| 8 | Chat window | **CKOneAI's page in a frame** |

**Knowledge (2 Nov 2026, later answers):** the owner approves every help article himself; the first set is 8 articles (raise a ticket, status meanings, check status, reply to a technician, reopen, feedback, SLA in plain words, approvals); catalogue and AC PMS / vendor articles are a second round; for service-suggestion questions only the route and tool are stored, not the typed text (owner accepted this with CKOneAI). The 8 articles in `docs/knowledge-base-drafts/` were **approved by Ankur (owner) in chat on 2 Nov 2026** (version 1, review by 2 Feb 2027). Order agreed with CKOneAI: phase 1 first (data tools, signed bridge, frame page), phase 2a/2b (documents, service suggestion) after phase 1 is live; no general chat, no model-written answers, no Pulse data, no writes.

**2 Nov 2026:** CKOneAI's verifier accepts the roles manager and orgwide (commit c62c664); CKDesk now sends them (local only; 7 signing vectors pass). Still open: the **separate go for any release** (nothing is released), the names of the article owner and approver (decision 5 of the first table, needed only when documents open), 11 (one organisation), 12 (vendors stay out), 13 (no writes). The CKOneAI session said it wants to hear decisions 1 and 2 from the owner itself; it has been told what was chosen and asked to confirm.

## Owner decisions (original list)

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| 1 | **Who may use the assistant first** (the pilot list) | the owner, 2 to 3 technicians of one team, one manager | switching on |
| 2 | **Aggregate tools for technicians** (category counts, SLA by store, CSAT): (i) manager and above only, with a new signed role `manager`, or (ii) organisation-wide counts for technicians as today | **(i)**: it matches CKDesk's own rule (an agent sees only their teams' tickets and no surveys). CKDesk has the role ready and will not send it until told; CKOneAI will not change its tools until told | the first release of the three tools |
| 3 | **Open documents (how-to answers) in this scope?** Today they are refused | yes, **but only after** a first set of ten articles is written and approved by a named owner (doc 03), and CKDesk gets audience, approval and version fields (doc 04) | the whole knowledge side |
| 4 | **Accept plain HTTP** for the pilot, or ask for HTTPS first | the chat is as readable on the network as every other CKDesk page; for a small pilot of staff it is the owner's call. The CKDesk to CKOneAI leg is signed, not encrypted | pilot start |
| 5 | **Who writes and approves the articles** (owner, reviewer, review date) | name one content owner and one approver | decision 3 |
| 6 | **Embed CKOneAI's page (built) or build a native CKDesk panel** | embed for the pilot; a native panel only if the real page does not fit CKDesk's look | UX |
| 7 | **Names in answers**: full names only on a person's own tickets and approvals | already the rule on CKOneAI's side | none (confirm) |
| 8 | **Wider visibility for technicians and managers** (see their team's tickets, their reports' tickets): needs proposals P2 and P3 (team membership, manager id) | do after the pilot starts, not before | exact scope for technicians and managers |
| 9 | **"Approvals waiting for me"**: needs proposal P1 (approval-step entity) | yes: it is the question people will ask first | that question |
| 10 | **The definition of "about to breach"** | open, not paused, `resolution_due_at` within the next 4 hours (same as CKDesk's "At risk" badge); separately "late and still open" | the SLA-risk tool |
| 11 | **A second organisation ever?** The signed spec has no organisation field | confirm "one organisation"; otherwise add the field before any second org | future only |
| 12 | **Vendor / OEM tools** | not in the pilot; vendor logins stay refused | vendor questions |
| 13 | **Write actions** (raise a ticket by chat) | separate later design (doc 15, section on ticket creation); never in the pilot | none |
| 14 | **Separate go for the release** (one CKDesk release, a secret typed on 98, one CKOneAI release) | after 1, 2, 4 are decided and the real page has been tried in local together | release |

## DBA decisions (the CKDesk side asks; 01-DBA is told before any change)

| # | Ask | Notes |
|---|---|---|
| D1 | Agree the new entities P1 (approval steps), P2 (team members), P3 (`manager_id` on users) and, if documents open, P5 (published approved articles) | CKDesk adds them to the data API only after the owner agrees and 01-DBA is told; the rule "do not change column names or the timestamp format" stays |
| D2 | Keep the first-load and 30-minute refresh; show the refresh time of each dataset in `meta.v_dataset_freshness` | already the case per CKOneAI's description |
| D3 | `sent_at` read as an IST day and one `store` row per site code | these are CKOneAI's own readings (their note); confirm with real data |
| D4 | Provide a non-live copy of `gold_ckdesk` for the pilot run of the question bank | needed to test without touching live |

## What the CKDesk side will NOT do without a word from the owner

Push, merge, deploy, set the secret on 98, change the data API, send the `manager` role, copy the synthetic articles to CKOneAI, or open documents.
