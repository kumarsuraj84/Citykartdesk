# 03 — Smoke and sanity

**Smoke** = "does it start and are all doors there". **Sanity** = "after a fix, does the touched area still do its main job". Both were run on the QA copy of the app (`localhost:3310`) on the isolated stack. Evidence: `evidence/03-smoke.jsonl`, `evidence/06-e2e.jsonl`.

## Smoke (before the fixes and again after the last fix)

| Check | Result |
|---|---|
| App starts under the guard with the audit environment; `/api/health` = ok, db ok | **PASS** |
| `/api/version` answers | **PASS** |
| 54 page and API routes fetched as admin (home, requests, queue, approvals, purchase orders, services, tasks, projects, dashboards, reports, intake pages, every admin page, vendor pages, health, version): all HTTP 200 and no error page; the 6 "digest" hits were only normal redirects (admin → users, logs tabs, intake queue → inbox) | **PASS** |
| `/vendor` and `/vendor/pos` sent a non-vendor to Home | **PASS** (correct behaviour) |
| Sign-in works for requester, technician, manager, vendor, approver, CVM, admin | **PASS** |
| Static checks: `tsc --noEmit` 0 errors, eslint 0 errors (5 old warnings) | **PASS** |
| Unauthenticated probes: health ok; webhooks without signature are refused or ignored; job routes 401 without secret; file routes redirect to sign-in; unsafe `next=` addresses ignored | **PASS** |

## Sanity after each fix (the touched area, quickly, in the browser or by its test)

| Fix | Quick check after the fix | Result |
|---|---|---|
| QA-D003 forms post | sign in as the seven roles used in the journeys after the change | PASS |
| QA-D008 / D009 vendor screens | vendor list, ticket, PMS tab, PO register opened at desktop and phone width | PASS |
| QA-D010–D012 accessibility | each changed page opened and axe re-run (pages render; buttons were not all clicked) | PASS |
| QA-D016 sign-in message | wrong password still says "Invalid login credentials"; with the service stopped says "temporarily unavailable"; recovers | PASS |
| QA-D017 attachment route | file opens normally; 503 only when storage is down | PASS |
| QA-D018 round robin | rules tests (26) pass; burst is spread | PASS |
| QA-D019 integrity check | System Log screen check runs over 568k rows and still finds a changed record (test 105) | PASS (see 07) |

Verdict: **PASS.** After the last fix the complete regression (report 07) was run again.
