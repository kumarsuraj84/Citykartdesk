# CK Desk bot through CKOneAI: the plan

Written 2 November 2026 after the CKOneAI session described its structure. Plain language. Nothing of the bot is built yet; the data API it needs is (see `CKDESK-DATA-API.md`).

## 1. How CKOneAI works (what the CKOneAI session told us)

- It is a **separate service** (Python / FastAPI, port 8100, on the Pulse / CKOneAI server), with a small local model on the same server. It is not part of the CK Desk app.
- A question goes: chat window -> rules decide the route (no model) -> a **fixed read-only tool** (a table spec: table, date column, measures, dimensions, caveats) -> typed answer (numbers, table, chart, basis, data-as-of time).
- **Numbers never come from the model.** The model only helps with open chat, rewording a document passage and, last of all, reading a question the rules cannot read. It never writes figures or SQL.
- It reads only the data platform's `gold_*` views (database `data_extraction`) through a read-only login. A new dataset = a spec + tests, and the data must first be published there by the DBA team.
- Other apps plug in through a **signed-header bridge** (the way DC360 does): the host app's server calls CKOneAI with the user, a scope, a timestamp and a one-time number, signed with a shared secret. The scope limits which tools may be used and forces the caller's identity into every query.

## 2. What that means for CK Desk

| Piece | Owner | Status |
|---|---|---|
| CK Desk data into the platform (read-only token API, pull) | CK Desk + DBA | API built and tested on the dev PC; not on live |
| `gold_ckdesk` views (tickets by store/day/category/status, SLA, CSAT, my tickets / approvals) | DBA | to be agreed after the API is live |
| A `ckdesk` scope and the CK Desk tools (specs + tests) | CKOneAI | not started; waits for the owner |
| A chat window inside CK Desk, calling CKOneAI with the signed headers | CK Desk | not started; waits for the network decision |

The bot answers **read-only** questions only (my open tickets, ticket status and SLA by store, tickets by category and status, CSAT summary, my pending approvals). Approving, changing or creating anything stays in CK Desk with the person's own login.

Identity: people are opaque CK Desk ids in the platform. The CK Desk server sends the signed-in person's id; the scope forces `requester_id` (or `assigned_to` for technicians) to that id in the query.

## 3. Decisions the owner must take

1. **Network.** CKOneAI's bridge only accepts calls from the same machine today, and CK Desk runs on 10.0.1.98. Either CKOneAI accepts the CK Desk server's address, or CK Desk embeds CKOneAI's chat page (a token minted by CK Desk).
2. **Who may use it first** (CKOneAI has an allow-list; today it is owner-only).
3. **What the platform receives** (today: ids and flags only, no text; widening is one column at a time).
4. **When the data API goes to live** (needs the token set on 98 and a network rule platform -> 98:3210).

## 4. What is not decided or not possible

- The older CK Desk Bot plans (`CKDESK-BOT-RAG-PLAN.md`, `CKDESK-BOT-COMBINED-PLAN.md`) described a bot built inside CK Desk (service suggestion, help articles, ticket draft). CKOneAI's design is a different shape (analytics and lookups over published data). Service suggestion and "raise a ticket for me" are not part of the CKOneAI route; they stay a separate, later decision.
- The knowledge base in CK Desk is still empty, so document answers have nothing to read yet.
