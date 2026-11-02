# 12. Security and failure tests

Status: LOCAL. What was **actually run** on the CKDesk side, and what is the CKOneAI session's to run. Totals at the end of the pack run: see doc 11.

## 1. Security tests run (CKDesk side)

| What | Where | Result |
|---|---|---|
| Signing reproduces the four published vectors byte for byte; any change to method, address, person, roles, time, one-time number, body or secret changes the signature | `tests/unit/ckoneai-sign.test.ts` (11) | pass |
| Only an exact list of addresses and methods is forwarded; `..`, `%`, backslash, empty parts, wrong ids, closed paths (question library, coverage, handoff, admin), a fragment or second `?` in the query, wrong methods are refused **before** CKOneAI is called | `ckoneai-path-config.test.ts` (53) | pass |
| Settings: off unless exactly `1`; missing/short secret, bad address, empty or invalid pilot list switch it off; the reason never contains the secret | same file | pass |
| Roles recomputed per call; vendor logins refused; person not on the pilot list refused; switched off = 503; no session = 401 | `ckoneai-roles-access.test.ts` (10), forwarding test | pass |
| Browser-sent `x-ckdesk-*`, `Authorization`, `Cookie`, `X-Forwarded-For` are dropped; the CKDesk session cookie never reaches CKOneAI; CKOneAI's `Set-Cookie`, `Server` and redirects are not passed back | `ckoneai-forward.test.ts` | pass |
| Raw body bytes (odd spacing, Hindi, en dash) sent unchanged and their hash signed | same | pass |
| New one-time number every call; whole-second stamp | same | pass |
| Message over 256 KB refused (413) without being sent on | same | pass |
| Per-person limit: 20 questions a minute, others 240 | same | pass |
| Who asked and when is logged, never the question text | same; and the real System Log row seen on the local stack (action `ckoneai.ask`, roles, byte count) | pass |
| End to end through the running app: no session 401; not on pilot 403; page 404 for them; menu entry shown only to the pilot person; forged headers ignored; chat streamed in three pieces 0.7 s apart; a 130-second stream delivered whole | local dev app + stand-in that verifies the signature (removed afterwards) | pass |
| CKDesk's real row security vs the tools' per-person filters (no leak; three differences) | `tests/vapt/68` (5) on the isolated stack, `evidence/authz-differential.json` | pass; differences in doc 07 |
| Data contract (nulls, offsets, duplicates, statuses, SLA flags, store mapping, freshness, identifiers, CSAT) | `tests/vapt/69` (12) | pass |
| Question-bank and synthetic-article validators (no real personal data, labels present) | `ckoneai-question-bank.test.ts`, `ckoneai-synthetic-kb.test.ts` | pass |

## 2. Failure modes (the brief's list)

| Failure | What happens | How shown |
|---|---|---|
| CKOneAI unavailable | CKDesk answers 502 "did not answer, try again"; logs a warning; **nothing else in CKDesk calls CKOneAI** (menu, tickets, approvals, dashboards, creation do not depend on it) | forwarding test; the chat frame shows a plain sentence "The rest of CK Desk is not affected" |
| Model timeout | not applicable in this scope today (no model is called); the forwarder gives up waiting for the first byte after 60 s (15 s for page files) and cuts a whole answer at 10 minutes | code; long-stream test shows 130 s works |
| Embedding service unavailable | not applicable (documents closed for this scope); future: document route must say "documents are unavailable" and still answer data questions | design (doc 04) |
| Gold dataset stale / missing | CKOneAI states "stale / cannot read refresh time" with the as-of time (their rule: platform state or older than 180 min) | reported by CKOneAI; question bank `freshness` |
| Invalid signed identity | CKOneAI answers 401 "Not authorised"; CKDesk passes the status through | forwarding test (401 passed through) |
| Unauthorized ticket | reads exactly like a ticket that does not exist | CKOneAI rule; bank `unknown_ticket` |
| Missing Knowledge Base article | refusal "no approved article" | bank `howto_*` |
| Conflicting SOP versions | design: newest **approved** version wins, older ones are excluded from the index; if two approved versions share one number the document is withheld and reported | doc 04 |
| Deleted ticket | the nightly `ids` comparison removes it from the platform; until then the tool may show it, and CKDesk's link then opens the normal "not found" | data API test (ids drop a deleted ticket) |
| Unknown store mapping | `store_code` null for head office (tested); a store missing from `store` gets no name (shown by code) | contract test |
| Large result set | at most 50 rows, then "showing 50 of N" | CKOneAI rule (MAX_ROWS) |
| Multiple matching ticket numbers | the router asks which one | bank `ambiguous` |
| Network interruption | a cut mid-answer ends that answer with an error; the next call works | forwarding test (17 pass) |

## 3. Not run here

CKOneAI's own tests (140 CKDesk tests, signatures, replay, window, scope, injection, refusals) were **not seen or re-run**: no local copy of that repository exists on this PC; they are reported by the CKOneAI session. The 217-question bank has not been run (doc 11). The full chain with the real CKOneAI chat page has not been tried (their `/ckoneai-ui/` build is not made yet). TLS: the pilot runs on plain HTTP (the owner's choice, doc 14).
