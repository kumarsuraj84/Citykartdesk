# Local features and the order they go to main (one by one)

Everything below is built and tested on the local branch `feature/sheet-masters`. **Nothing here is pushed to git or main or deployed.** A feature is pushed only when you say so, one feature per push, in its own branch, with its own database step (if any).

Local testing uses the full build (all features together) so the screens look like main plus everything new. Each push branch is built so it contains **only its own feature** and is tested on its own before it goes.

| # | Feature (what you say to push it) | What changes for the people | Needs a database step on 205? | Needs first |
|---|---|---|---|---|
| 1 | **"push AC one"** - Sheet Masters foundation + AC | The AC Google Sheet becomes the master. Copied to the database at 11:00, 15:00, 19:00 (and "Update now" button). The ticket form shows only the store's Active ACs. The AC OEM e-mail comes from the sheet (one e-mail, OEM in To, company people in CC). When the store reopens a resolved AC ticket, the OEM is e-mailed again. Store address and opening date come from the sheet. Old OEM-bucket screens are retired. Admin > Sheet Masters (connect Google, update now, health, AC e-mail wording). | Yes (new tables) | nothing |
| 2 | **"push genset one"** | The Genset Google Sheet becomes the master. Genset tickets go to the OEM(s) listed for the store, one e-mail. Genset e-mail wording and genset card on Sheet Masters. | Yes (one small table) | 1 |
| 3 | **"push CVM one"** - CVM sheet + automatic approval | The CVM Google Sheet gives each store's CVM. Fixtures / Fixture Attachments / Hangers tickets go to that CVM for approval automatically. Old CVM-tag screen is retired. | Yes (one small table) | 1 |
| 4 | **"push FSR and engineer one"** - AC visits | Public page `/engineer` (store code + the store's daily visit code). The OEM engineer reports per AC: resolved or not, parts, FSR photo. The store confirms or disputes. 48 hours (adjustable) with no store answer = resolved automatically (24 h reminder). Engineer says resolved but store says not = ONE e-mail to the OEM to send an engineer again. Parts that need a purchase order go to the technician's "Parts to order" list. Reports screens for the technician and the store. | Yes (new tables) + `VISIT_CODE_SECRET` on 98 + two scheduled tasks | 1 |
| 5 | **"push AC and genset dashboards one"** (suggested, not built yet) | Dashboard and reports can use the AC / Genset fields (brand, tonnage, age, AMC vendor, counts per store...) straight from the copied tables. | No | 1 and 2 |

Notes that apply to every feature:
- Each feature that needs the database ships with its own run sheet (backup first, one step at a time, restart CkDeskPostgrest on 98 afterwards) and its own rollback file.
- Nothing is switched on by the push alone: the Google connection, the sheet addresses, the category switches (AC / Genset OEM, CVM approval) and the AC field are admin settings done in the app after the push (the list is in `docs/SHEET-MASTERS-GUIDE.md`).
- The local database is a mirror of main's configuration (services, categories, templates). E-mail never leaves the local PC: it is saved as files in `local-mail-outbox/`.
