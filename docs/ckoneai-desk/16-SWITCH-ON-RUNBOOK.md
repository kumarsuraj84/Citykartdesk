# 16. Switch-on runbook: Ask CK Desk on live

Status: PREPARED 2 Nov 2026. The CKDesk side is already on live (build 20261102-170030-a6cff58) with the assistant **off**. This sheet is what happens on the day it is switched on. Nothing here is done yet. The owner gives a separate go for the day.

## 0. Gate: all of these must be true first

| # | Condition | Who | How it is checked |
|---|---|---|---|
| 1 | CKOneAI's fixed version is running on its test copy | 04-CKOneAI | it tells me the commit |
| 2 | Question bank v2 (229) re-run: routing 95% or more, refusals 95% or more, no other-person data | me | `run-bank.cjs` against the test copy; numbers in doc 11 |
| 3 | The owner has tried the fixed version with his own login (first question after idle answers without error) | owner | he says so |
| 4 | CKOneAI's **dedicated CKDesk-only instance** is ready (decided 2 Nov 2026: separate, port **8101** on 10.0.0.82; the shared live service on 8100 for Pulse and DC360 is never touched or restarted): ckdesk scope, new roles, built page, read-only data login, its own conversation database, accepts calls from **10.0.1.98 only**, Pulse and DC360 closed | 04-CKOneAI | it tells me the instance exists and the owner agrees; then I do one read-only GET of its health from 10.0.1.98 |
| 5 | The owner's separate go for the switch-on day | owner | in chat |

## 1. On the day: steps

**A0. On the CKOneAI server (the owner types, about 30 minutes window with 04-CKOneAI):** in the file `ckdesk_live.env`, on the line `CKONEAI_BRIDGE_SECRET_CKDESK=`, a NEW random secret of 32 or more characters (the start refuses a shorter one or one equal to a test secret). The same value goes into 98 below.

**A. The owner types (on 10.0.1.98, in `D:\Citykart_Applications\Citykart_Ckdesk_App\app\standalone\.env.local`):**

```
CKONEAI_ENABLED=1
CKONEAI_BASE_URL=http://10.0.0.82:8101
CKONEAI_BRIDGE_SECRET_CKDESK=<a new random secret of 32 or more characters, the same value as on the CKOneAI server>
CKONEAI_PILOT_USER_IDS=<the owner's own profile id>
```

- The secret is **new** (never the test one). It is typed by the owner on both servers and is never put in chat or in a file in the repository.
- The owner's profile id: open the owner's own user in Admin > Users; the id is the long code in the address of that page.
- First day: the pilot list holds only the owner's id.

**B. Restart the app** (Services: restart `CkDeskApp`; about 15 seconds without CKDesk).

**C. Checks (me, read-only, over ssh):** health and version; `CKONEAI` setting names present (values never read); the CKOneAI health reachable from 10.0.1.98.

**D. The owner opens CKDesk, clicks the robot button** and asks: "Show my open tickets", "Show my approval requests", "Which approvals are pending with me?" (it must say it cannot yet), "Create a ticket" (it must say it only reads), and, as an admin, "Tickets by category and status this month". The first answer after the start can be slow (cold start): press Retry once if it errors.

**E. Everyone:** if all is good, the owner changes `CKONEAI_PILOT_USER_IDS=*` (everyone except vendor logins) and restarts the app again.

## 2. Roll-back (any time, a minute)

- **Switch off:** change `CKONEAI_ENABLED=1` to `CKONEAI_ENABLED=0` (or delete the line) and restart `CkDeskApp`. The robot button disappears and every assistant address answers "off". Nothing else in CKDesk is affected.
- **Stop the secret:** delete the secret line on 10.0.1.98 and on the CKOneAI server.
- **CKOneAI side:** stop that one dedicated instance (04-CKOneAI does it); the shared live service on 8100 is not involved.
- **Whole CKDesk release back:** `D:\release\deploy-app-2026-10-31\rollback-app.ps1` (the rollback copy of the 2 Nov release is `standalone-bak-20261102-1703`; keep it for 24 hours).

## 3. After the first day

- Read the System Log lines `ckoneai.ask` (who asked, when, how many bytes, roles: never the question) and `ckoneai.unreachable` (CKOneAI did not answer).
- Weekly: the review of questions the assistant could not answer (CKOneAI's Improvement Center, ckdesk scope), proposed in `DESIGN_PHASE3.md` of the CKOneAI session.
- Fill the **Manager** box on the user accounts: only 10 of 555 people have a manager on 2 Nov, so the manager hierarchy view is thin until that is done.

## 4. What the people see

- Requester: own tickets, status of own tickets, approvals they requested. The company-wide summaries are refused ("ask your manager").
- Technician: the same, plus tickets assigned to them ("assigned to me").
- Manager: the hierarchy view is "not ready yet" until the Manager boxes and team data are in place.
- Admin / platform owner: the company-wide summaries (tickets by category, SLA by store, ratings).
- Vendor (OEM) logins: not served.
- "Approvals waiting for me": until CKOneAI builds on the new approval-step list, it says it cannot answer yet and points to the Approvals page.
- How-to questions: refused politely until the document step (phase 2) is switched on.
