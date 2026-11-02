# 15. Local pilot readiness

Status: LOCAL, 2 Nov 2026. Nothing pushed, merged, deployed or touched on 10.0.1.98, 10.0.0.205, the NAS or CKOneAI. All CKDesk changes are in the working tree, **uncommitted** (no commit was asked for).

## Verdict

**The CKDesk side is ready to try locally with the real CKOneAI. The pilot as a whole is not ready**, because the CKOneAI chat page build for `/ckoneai-ui/` is not made, the question bank has not been run, and four owner decisions are open (doc 14: pilot people, aggregate-tool scope, HTTP, documents).

## Checklist

| Item | State |
|---|---|
| Signer to the published vectors | done, tested |
| Forwarding routes with an exact allow-list, header stripping, streaming, limits, friendly failures | done, tested, run end to end |
| Gate: kill switch, pilot list, vendor refusal, roles per call, audit line without text | done, tested |
| Menu entry and frame page (desktop and phone) | done, checked in the browser pane |
| Settings and secret handling (`.env.example`, `lib/secrets.ts`, off unless complete) | done |
| Docs for the owner (`docs/CKDESK-BOT-VIA-CKONEAI.md`, this pack) | done |
| Authorisation compared with CKDesk's real row security | done; **three differences need the owner** (W1, W2, N1) |
| Data contract through the real API | done, passing |
| Question bank | written (217), validated, **not run** |
| CKOneAI tools (7) | built by the CKOneAI session (branch `v3-ckdesk`), not seen or run from here |
| CKOneAI chat page for `/ckoneai-ui/` with `bridge=ckdesk` | **not built** (CKOneAI will build it when the owner says go) |
| Knowledge (documents) | **none approved**; refused in this scope; ten synthetic articles exist for local trials only |
| `manager` role | helper `isManagerTier` ready and tested; **not sent**, not in spec v1 |
| Approval-step / team / manager entities in the data API | proposed, not built |
| Real-data check of `gold_ckdesk` columns by CKOneAI | pending (their next step) |

## Demonstrable locally today

With the real CKOneAI on a spare local port and its chat page built, CKDesk can show: the menu entry, the frame, signed calls, streamed answers, refusals, history. Until then the stand-in used for the checks can be started again on request (it was removed after use; **no demo address is running now**).

## Before connecting the live CKDesk application

1. The owner decides 1, 2, 4, 14 of doc 14 (and 3 if documents are wanted).
2. CKOneAI: build the chat page, run the question bank on a non-live `gold_ckdesk`, fix what fails, report the numbers; the owner reads doc 11 again with real figures.
3. A local run of the **real pair** (CKDesk dev app + CKOneAI) on this PC.
4. The owner types the shared secret on 98 and on the CKOneAI server (never in chat or a file in the repository); CKOneAI allows calls from 10.0.1.98 only.
5. A separate release: one CKDesk build (this work) and one CKOneAI release; rollback = remove the four settings (`CKONEAI_ENABLED` off) and restart, or the usual app rollback.
6. First week: pilot list of a few people; read the System Log lines `ckoneai.ask` and `ckoneai.unreachable`; check the first answers with the person.

## Future ticket creation by chat (design only; not active in Phase 1)

Steps: service, issue keywords, matching sub-category, parent category derived automatically (as CKDesk already does from the sub-category), the form's mandatory requester fields, a review screen, an explicit **Confirm**. It must **reuse** the existing creation engine (`createRequestCore`, with its location rule, mandatory-field gate, priority from the sub-category, double-submit guard and automation steps), may help with wording only, may not bypass mandatory fields, priority rules or the location rule, and never creates a ticket because a question was asked. It needs a separate write-enabled design: a signed **write** scope distinct from the read scope, a per-action confirmation token, an idempotency key, an audit line with the full proposed ticket, rate limits, and the owner's approval. The older service-suggestion idea (`CKDESK-BOT-RAG-PLAN.md`) is the starting point for the matching step, not for the creation step.
