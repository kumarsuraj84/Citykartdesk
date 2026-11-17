# 16 — Remaining Risks and Owner Decisions

## Plain summary
Nothing found blocks a release by itself. The decisions below are yours. The first four matter most.

## Decisions needed (ordered by importance)
| # | Decision | Why it matters | My recommendation |
|---|---|---|---|
| 1 | **Plan the framework upgrade** (Next.js 16.3.8 → ≥ 16.4.6; also zod ≥ 4.6.6, nodemailer/mailparser, sanitize-html) | two critical and one high published advisories on the framework; not reachable the way the app is set up, but the denial-of-service advisory cannot be ruled out | upgrade on its own branch, run all four test layers + this audit's browser, security and load scripts, then release separately from feature work |
| 2 | **Dashboard and report scale**: Executive dashboard (18.6 MB page, 30,000-ticket cap), Admin Reports (13–16 s at 500k tickets), Admin Users (2.4 MB) | fine at today's volumes (3k: all pages under 2 s up to 50 users) but becomes slow and then truncated as tickets grow | set a trigger (for example "live tickets > 20,000") and schedule server-side summarising before it; until then keep the on-screen "oldest tickets left out" notice |
| 3 | **Bulk imports and the scheduler**: each overdue open ticket costs ~12.5 ms per rule per run | importing many old *open* tickets (the on-hold ManageEngine migration) would make every scheduled run slow and overlapping runs pile up | before any import: import old tickets as closed/resolved, or first change the engine to filter in the database |
| 4 | **Security settings already on your list**: enforce the browser security policy (CSP), HttpOnly session cookie, TLS/HTTPS, `TRUSTED_PROXY_HOPS` | passwords currently cross the network unencrypted; an injected script (none found) would not be blocked; client addresses are not logged | check `TRUSTED_PROXY_HOPS` on live now (cheap); decide the HTTPS date |
| 5 | **Security-log gaps**: log forbidden attempts and rejected machine calls; name the person on service-key changes; state a retention period; test alert delivery | a SOC would be blind to insider probing and to secret guessing | accept as a small hardening task (report 14) |
| 6 | Rule engine **at-most-once** and "notify managers = all managers" | rare silent loss of one escalation; broad notifications | add a daily "claimed but nothing done" check; confirm the manager rule |
| 7 | Restrict `app_settings` read to staff (one migration) | vendors can read retention days, policy flags, PO approver id | yes, but not urgent |
| 8 | Design points: calendar cell with nested buttons, small-text contrast, 24 px touch targets, Escape on the assistant dock | accessibility (WCAG 2.2 AA) polish | schedule with the next UI pass |
| 9 | Confirm the **real** settings on live that this audit could not look at (no production access): is `TRUSTED_PROXY_HOPS` set? does the live build bundle `local-testing/*.csv` (staff e-mail list, F-007)? is the vendor **PO approver** configured? are mail/SMTP failures alerting someone? | each is a one-minute read-only check | ask for a read-only check with your OK |
| 10 | Shared form-template fields (UI-006): the fix de-duplicates the report field list; the label of a shared field no longer carries one service's name | saved reports reference `form:<id>` keys, which are unchanged | no action unless a saved report looks different |
| 11 | **Role-based alerts send nothing** (ALERT-001): the "unassigned request" alert and other alert rules set to notify a **role** read a column that does not exist, so the recipient list is always empty | alerts you may believe are working are not; fixing it makes them start notifying managers (including about old tickets) | decide first whether you want those alerts on; then a one-line fix + a test, and switch on in a quiet hour |

### Read-only SQL you can run on the live database to see how many services share a template field
```sql
select f->>'id' as field_id, count(distinct s.id) as services
from services s left join form_templates t on t.id = s.template_id,
     jsonb_array_elements(coalesce(nullif(s.form_sections,'[]'::jsonb), t.form_sections, '[]'::jsonb)) sec,
     jsonb_array_elements(coalesce(sec->'fields','[]'::jsonb)) f
where s.is_active group by 1 having count(distinct s.id) > 1 order by 2 desc;
```
(Reads only. In the audit copy it shows `f_desc` and `f_subject` shared by 4 services.)

## Residual risks that remain even after the fixes
| Risk | Level | Comment |
|---|---|---|
| Plain HTTP between users and the server | medium | known and accepted for now |
| Framework/library advisories until upgraded | medium | see decision 1 |
| Slow pages as data grows | medium | see decision 2 |
| Not tested in Firefox, Safari, iPhone, real Android | medium | recommended manual pass |
| Real integrations never exercised in this audit: live mail send, WhatsApp send, Google/Microsoft mailbox sync, DeskTime, Google Sheet API, Web Push, the real CKOneAI machine | medium | need a staged check with test accounts |
| Restore from backup never rehearsed in this audit | medium | schedule a drill |
| Business acceptance of all scenarios | — | **pending owner/business sign-off** |

## Things this audit did not and could not decide
Whether the business rules themselves are right (SLA percentages, who approves what, who is a "manager"), whether vendors may see the settings above, and whether the 30,000-ticket cap is acceptable. Those are business decisions.
