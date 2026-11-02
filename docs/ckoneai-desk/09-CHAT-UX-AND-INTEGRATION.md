# 09. Chat experience and integration

Status: LOCAL. What is built and verified in the browser pane (same-origin frame in CKDesk, stand-in assistant, desktop and phone width), and what the CKOneAI chat page itself must provide.

## 1. How it is embedded (built)

- **A round bot button at the bottom right of every page** (like CK Pulse; owner request 2 Nov 2026), shown only to people the gate lets in (switch on, pilot list, not a vendor login). A click opens a small chat window (400 px wide on a computer, almost full screen on a phone) with CKOneAI's chat page inside. The page is loaded on the first click and kept when the window is closed, so the conversation stays. Esc or the X closes it; an "Open on a full page" icon goes to `/ckoneai`. The page's messages (ready, online/offline, busy, escape) are read only from its own frame and own address. There is **no sidebar entry** any more. **Motion (owner decision 2 Nov 2026):** the button always animates (hover or keyboard focus: the label slides out, the robot blinks every 3.2 s, it lifts 3 px; open: the robot turns into a gold X), even when the computer asks for reduced motion; CKOneAI itself switches its motion off in that case. At rest the icon is still, exactly like CKOneAI (no idle motion).
- Full-page version `/ckoneai`: the same chat page in a frame sized to the screen with no second scroll bar (desktop and phone checked). A person who may not use it gets the normal "page not found".
- The chat page calls only `/api/ckoneai/...` on CKDesk (cookies stay with CKDesk). CKDesk signs every call. No token is passed to the page (the DC360 postMessage handshake is **off** for `bridge=ckdesk`, confirmed by the CKOneAI session; their `/ckoneai-ui/` build is not made yet).
- If the assistant is down the frame shows one sentence ("did not answer ... the rest of CK Desk is not affected"); nothing else in CKDesk calls it.
- A local stand-in that verifies the signature loaded in this frame and streamed a three-part answer (verified, screenshots taken, stand-in then removed).

## 2. The experience the owner asked for, and who delivers each part

| Requirement | Delivered by | State |
|---|---|---|
| Round bot button, bottom right |  CKDesk (component `components/ckoneai/AssistantLauncher.tsx`, 6 tests) | done, seen in the browser pane |
| Light theme consistent with CKDesk | CKOneAI page (its palette is navy `#0D2338`, gold `#D6AE59`, warm white); CKDesk frame has a white background and a soft border | frame done; palette match is a look-and-feel decision for the owner after seeing the real page |
| Reusable component rather than a second app | **Decision**: embed CKOneAI's page (agreed, built) vs a native CKDesk panel that talks to the same `/api/ckoneai/*` | owner decides (doc 14, decision 6); a native panel would need CKOneAI's streamed-event format, not yet seen by this side |
| Starter questions by role | `GET /api/ckoneai/starters` (CKOneAI lists only what the caller's roles open) | CKOneAI |
| Conversation history | `conversations` and `messages` calls (stored by CKOneAI under `ckdesk:<person>`, apart from Pulse) | CKOneAI; CKDesk allows the calls |
| Source citations, data freshness | in every answer (as-of time, basis, period; document citations when documents open) | CKOneAI |
| Loading states, friendly errors | CKOneAI page; CKDesk contributes the plain-sentence failures (502, 429 "wait a little", 413 "too large", 503 off) | partly done |
| Feedback on answer quality | `POST /api/ckoneai/feedback` (allowed) | CKOneAI |
| Open-in-CKDesk links | the answer carries the ticket's CKDesk id; the link is `/requests/<id>` | see 3 |
| Suggested questions that fit the role | `starters` | CKOneAI |

## 3. Ticket links must be authorised again by CKDesk

An answer may offer "Open in CKDesk" for a ticket the person is shown. Opening it goes to the normal CKDesk page, which checks the person again with the real row-security rule (a person who cannot see it gets "not found"). A link is therefore never a grant. Vendor logins are not served; a vendor who somehow follows a staff link is already redirected to `/vendor/tickets/<id>` by CKDesk. Request numbers are shown as `CKSD-000123`.

## 4. Settings the owner controls (no release needed)

`CKONEAI_ENABLED` (kill switch), `CKONEAI_PILOT_USER_IDS` (who), `CKONEAI_BASE_URL`, `CKONEAI_BRIDGE_SECRET_CKDESK` (typed by the owner on the server). See `docs/CKDESK-BOT-VIA-CKONEAI.md` section 3.

## 5. Not done

A native CKDesk panel; the real chat page in the frame (waits for the CKOneAI build); a phone-specific design of the chat page itself (the frame fits a phone, the page inside is CKOneAI's).
