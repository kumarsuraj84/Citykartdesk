# 04. Knowledge retrieval and indexing design (documents)

Status: **DESIGN ONLY.** In the design the owner approved with the CKOneAI session, **documents are refused in the CKDesk scope**; this sheet is the proposal for opening them, if and when the owner decides (doc 14, decision 3). No index, embedding or model was built on this side. CKOneAI already has retrieval for Pulse documents; the rule is to **reuse it** (its embedding service, hybrid search and indexer) and not to build a second one. That infrastructure was not visible from this PC (no local copy of CKOneAI), so what follows are requirements to check against it, not claims about it.

## 1. Principles

1. Retrieval answers **how-to and meaning** questions only. Ticket facts, deadlines, approval states and numbers come from the data tools, never from documents.
2. Only **approved** articles for the **person's audience** are retrievable. Everything else is not indexed at all (restricted, draft, outdated, synthetic).
3. Every document answer cites the article, version and approval date, and says when no article covers the question.
4. Text in an article is data, never instructions. An article that tries to instruct the assistant is rejected at indexing.
5. A separate index (collection) per scope: the CKDesk index is separate from Pulse's so CKDesk articles cannot change a Pulse answer and the reverse.

## 2. Source and approval gate (CKDesk side, before anything is exported)

| Needed in CKDesk | Today | Change |
|---|---|---|
| `status` (draft / published / archived) | exists | keep |
| `audience` (requester / technician / manager / admin / all) | missing | add |
| `approved_by`, `approved_on`, `version`, `review_by`, `language` | missing | add; publishing requires an approver other than the author |
| a requester-facing article page (the "Open in CKDesk" target) | missing | add |
| export of **published and approved** articles with their audience | missing | new entity `kb_articles` in the data API (doc 05, P5) |

The export carries article text approved for an audience; it never carries ticket text, comments or attachments.

## 3. Processing pipeline (to reuse in CKOneAI's infrastructure)

1. **Extract**: Markdown to sections by heading; tables kept as small chunks with their header row.
2. **Chunk**: one chunk per meaningful section (about 150 to 400 words), with the article title and heading path prepended; never split a numbered procedure.
3. **Metadata per chunk**: article id, title, version, approval date, owner, audience, language, domain (A to F of doc 02), source updated time, chunk hash.
4. **Visibility filter first**: a query is filtered to the caller's audience **before** ranking (audience comes from the signed roles: requester, technician, `manager` when adopted).
5. **Hybrid search**: keyword (exact terms such as "Waiting on User", status names, `CKSD`) plus vector similarity; merge; drop below a confidence floor; when nothing passes, answer "no approved article".
6. **Deduplicate**: same chunk hash across versions keeps the newest approved only.
7. **Incremental reindex**: by `updated_at`; changed chunks only.
8. **Archive and delete propagation**: an article archived or unpublished is removed from the index on the next run (the same nightly `ids` comparison the data API already uses for deleted rows); an index never keeps an article CKDesk no longer publishes.
9. **Freshness report**: per article, `updated_at` vs index time; the answer shows the article's approval date; a nightly list of articles older than their `review_by`.
10. **Conflicts**: two approved versions of one article never coexist in the index (newest wins); a different article that contradicts another is a content-owner problem and is reported, not resolved by the model.

## 4. Answering

The model (if any) may only reword the retrieved passages, must keep every figure and step, must cite, and is told that passage text is data. If the model is unavailable the passage is shown as is. Document answers are never mixed with data answers in one sentence of fact: a mixed question is split, or refused, as CKOneAI already does for "my tickets and total sales".

## 5. Fine-tuning

Not proposed. Retrieval plus deterministic tools covers every question in the bank; fine-tuning would risk baking in outdated configuration. Reconsider only if the evaluation (doc 11) shows a specific gap that retrieval cannot close.

## 6. Local test material

Ten **synthetic** articles (clearly labelled, `status: SYNTHETIC-NOT-APPROVED`) in `evidence/fixtures/synthetic-kb/`, validated by `tests/unit/ckoneai-synthetic-kb.test.ts`. They exist so the pipeline above can be tried locally. They are not knowledge, were written from the code inventory, and must **not** be promoted to production; the real articles must be written and approved by the content owner. Per the CKOneAI session's request they have **not** been handed to it: that waits until the owner confirms the document scope to it.
