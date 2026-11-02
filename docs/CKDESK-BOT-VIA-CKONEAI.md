# Ask CK Desk: the assistant through CKOneAI

Written 2 November 2026; updated the same day when the CK Desk side was built (local only, **not released**). Plain language.

## 1. What it is

A chat window inside CK Desk, "Ask CK Desk" (menu, under Home). The questions and answers come from **CKOneAI**, a separate service on the Pulse / CKOneAI server (10.0.0.82, port 8100). CK Desk only does three things: it checks who you are, tells CKOneAI who you are (signed, so it cannot be faked), and passes the chat through.

- It answers **read-only** questions (for example "my open tickets", "tickets by category and status", "my pending approvals"). It never approves, changes or creates anything; that stays in CK Desk with your own login.
- **Numbers never come from the model.** CKOneAI reads only the published `gold_*` views of the data platform (fed by the data API, see `CKDESK-DATA-API.md`).
- The questions and answers are **not stored in CK Desk**. CK Desk keeps only a line in the System Log: who asked and when (and how many bytes, and which roles), never the text.

## 2. How a question travels

```
browser --(your CK Desk login)--> CK Desk server 10.0.1.98 --(signed call)--> CKOneAI 10.0.0.82:8100
```

1. The browser talks only to CK Desk (`/ckoneai` page, `/ckoneai-ui/...` chat files, `/api/ckoneai/...` chat calls). It never holds a secret and never calls CKOneAI itself.
2. CK Desk checks the session. Refused **before** CKOneAI is called: not signed in, no profile, a deactivated person, a password change still pending, a vendor (OEM engineer) login, a person not on the pilot list, the switch off.
3. CK Desk decides the person's roles **on every call** (nothing is remembered): `requester` (everybody), `technician` (agent, manager, admin, platform owner), `approver` (manager, admin, platform owner, or anybody named on an approval step). CKOneAI never works this out itself.
4. CK Desk signs the call (id, roles, scope `ckdesk`, time, one-time number, hash of the body) with a shared secret and sends it. CKOneAI checks the signature, the time (plus or minus 60 seconds) and that the one-time number was not used before.
5. The answer comes back piece by piece (no waiting for the full answer); a streamed answer of more than 2 minutes was tested.

What CK Desk **never** passes on: the browser's own cookies (the CK Desk login cookie never leaves CK Desk), any `Authorization` header, any `x-ckdesk-*` header the browser sent, the browser's address. Only an **exact list** of addresses is forwarded (agreed with the CKOneAI session): `health`, `capabilities`, `starters`, `chat`, `chat/stop`, `feedback`, `events/navigation`, `conversations`, `conversations/{id}`, `history`, `messages/{id}` under `/api/ckoneai/`, and `/ckoneai-ui`, `/ckoneai-ui/<file>`, `/ckoneai-ui/assets/<file>`. Everything else (question library, coverage, handoff, admin, anything with `..`, a `%`, a backslash or a wrong method) is refused before CKOneAI is called. The chat page files are served by CKOneAI from its own root, so `/ckoneai-ui/<x>` is sent to CKOneAI as `/<x>` (and signed with that address); the API paths are sent unchanged. A message larger than 256 KB is refused (413). Each person may send 20 questions a minute (then "wait a little", 429); other calls 240 a minute.

The signing rules (spec v1, with the four published test vectors) are in `lib/ckoneai/sign.ts` and `tests/unit/ckoneai-sign.test.ts`.

## 3. Switching it on (the owner, on the app server 10.0.1.98)

It is **off** until all four settings exist in `app\standalone\.env.local`, and then the app is restarted. The owner types the secret himself; nobody else sees it.

| Setting | Meaning |
|---|---|
| `CKONEAI_ENABLED=1` | the kill switch. Anything else (or removing the line) switches the assistant off at once: menu hidden, every route answers "off" |
| `CKONEAI_BASE_URL=http://10.0.0.82:8100` | where CKOneAI listens (a plain address only) |
| `CKONEAI_BRIDGE_SECRET_CKDESK=...` | the shared signing secret, at least 32 random characters, the same value as in CKOneAI's own settings. Its own secret: never the cron secret |
| `CKONEAI_PILOT_USER_IDS=id,id,...` | who may use it: profile ids, comma separated. `*` = everybody except vendor logins. Empty = off |

To widen the pilot or stop it later, change these lines and restart the app: no release is needed. CKOneAI's own firewall must allow calls from 10.0.1.98 only.

Any missing or wrong setting switches the assistant **off** (the reason is written to the app log, never the secret); it never opens anything.

## 4. What to know before the pilot

- **Plain HTTP.** CK Desk runs on `http://182.72.84.10:3210`, so the chat between the browser and CK Desk can be read on the network like every other CK Desk page. The leg CK Desk to CKOneAI is inside the company network; the signature protects who is asking and that nothing was changed on the way, but the content is readable on that network. Accepting this for the pilot, or asking for HTTPS first, is the owner's decision.
- **The chat page is code from CKOneAI shown on CK Desk's own address**, so it must be trusted like CK Desk's own code (both belong to the company). The page is only in the menu for people on the pilot list.
- **Names.** The data platform has people's full names (never e-mail or mobile). CKOneAI's rule: a name is shown only on the person's own tickets or approvals.
- **CKOneAI's side** (the `ckdesk` scope, the CK Desk tools and the chat page built for the address `/ckoneai-ui/`, with `?embed=1&bridge=ckdesk`) is built by the CKOneAI team and is not part of this release.

## 5. Where things are

- `lib/ckoneai/sign.ts` (the signing), `config.ts` (the four settings), `path.ts` (allowed addresses), `roles.ts` (the roles rule), `access.ts` (who may use it), `forward.ts` (the forwarding).
- `app/api/ckoneai/[...path]/route.ts`, `app/ckoneai-ui/[[...path]]/route.ts`, `app/(app)/ckoneai/page.tsx` (the page), the menu entry in `components/layout/Sidebar.tsx`.
- Tests: `tests/unit/ckoneai-*.test.ts` (signing vectors, path refusal, settings, roles and access, forwarding against a stand-in CKOneAI incl. no cookie forwarded, forged headers ignored, streaming, rate limit, no question text logged). `CKONEAI_LONG_TEST=1` also runs the 2-minute stream.

## 6. The wider pilot pack

Knowledge sources, the evaluation question bank, the authorisation findings, the data contract proposal and the readiness report are in `docs/ckoneai-desk/` (15 documents). Read `14-OPEN-OWNER-AND-DBA-DECISIONS.md` first.

## 7. What is not part of this

- Service suggestion and "raise a ticket for me" (older plans `CKDESK-BOT-RAG-PLAN.md`, `CKDESK-BOT-COMBINED-PLAN.md`) are a separate, later decision.
- The knowledge base in CK Desk is still empty, so document answers have nothing to read yet.
