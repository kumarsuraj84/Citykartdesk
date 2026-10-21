# Local features and the order they go to main (one by one)

Everything below is built and tested locally. **Nothing is pushed to git or main and nothing is deployed.** A feature is pushed only when you say so, one feature per push, from its own branch.

## Two things exist side by side
- **The full local build** = branch `feature/sheet-masters` (the folder you run on http://localhost:3210). All features together, so you can test the whole workflow the way it will look on main.
- **One branch per feature** (`push/...`, each in its own folder next to this one). Each contains only its own feature and was tested on its own. Merged in any order they combine without clashes.

| # | You say | Branch | What changes | Database step on 205 | Needs first |
|---|---|---|---|---|---|
| 1 | **"push AC one"** | `push/1-sheet-masters-ac` | AC Google Sheet is the master (copied to the database at 11:00, 15:00, 19:00 and by the "Update now" button); store AC list in the ticket form; AC OEM e-mail from the sheet (also again when the store **reopens** a resolved ticket); store address/opening date from the sheet; Admin > Sheet Masters; scheduled task. Genset and CVM keep working as today. | migration **175** (`deploy-bundle-migration-175`) | nothing |
| 2 | **"push genset one"** | `push/2-genset-sheet` | Genset Google Sheet is the master for genset tickets (one e-mail to every OEM address of the store's genset rows); genset e-mail wording | migration **176** (`deploy-bundle-migration-176`) | 1 |
| 3 | **"push CVM one"** | `push/3-cvm-sheet` | CVM Google Sheet gives each store's CVM; Fixtures / Fixture Attachments / Hangers tickets go to that CVM for approval automatically; CVM offered as approver | migration **177** (`deploy-bundle-migration-177`) | 1 |
| 4 | **"push FSR and engineer one"** | `push/4-engineer-visits` | Public `/engineer` page (store code + daily visit code), per-AC engineer report with FSR photos, store confirmation, 48 h auto-resolve with 24 h reminder, one e-mail asking the OEM to send an engineer again, parts-to-order list | migration **178** (`deploy-bundle-migration-178`) + `VISIT_CODE_SECRET` on 98 + scheduled task `CitykartDesk-Cron-Visits` | 1 |
| 5 | **"push AC and genset master screens one"** | `push/5-ac-genset-master-screens` | AC master / Genset master lists with filters, counts by brand/tonnage/region, Excel (CSV) download; the same columns serve the dashboards. (The Genset list shows only once release 2 is in.) | none | 1 |
| 6 | **"push the clean-up one"** | `push/6-retire-old-oem-cvm-screens` | Removes the old OEM-bucket and CVM-tag screens and actions (no longer used once 1, 2 and 3 are live) | none | 1, 2 and 3 |
| 7 | **"push number limits one"** | `push/7-number-field-limits` | In the form builder the administrator sets, for any number field, the **smallest number**, the **largest number** and **whole numbers only**; for a text or long-text field the **shortest** and **longest length**. Checked in the browser and again on the server, also for fields that come from the Field Library. Needs no database step. | none | nothing |

Why no dashboards item yet: the AC and Genset columns are ready to use (see release 5). Which dashboard figures you want (for example ACs by brand, by region, by AMC vendor, repeat-failure ACs) is for you to choose; each one is a small separate addition.

## How one push will go (when you say so)
1. I re-run that branch's checks (type check, lint, unit tests, integration tests on the isolated test stack, production build).
2. You run that release's database run sheet on 205 (backup first), I restart `CkDeskPostgrest` on 98.
3. I merge that branch into `main`, push `origin main`, build and deploy to 10.0.1.98.
4. You do the admin steps for that release (listed in `docs/SHEET-MASTERS-GUIDE.md` / `docs/AC-VISITS-GUIDE.md`): Google connection, sheet addresses, the category switches.
Nothing is switched on by the push alone.

## What was checked
- Every branch: type check, lint (0 errors), all unit tests, the integration tests that apply to it, and a production build (releases 1, 4 and 6; release 6 contains 1, 2 and 3).
- All six merged together in six different orders: no clashes; the result passes everything (1478 unit tests, 41 integration tests of the new parts).

## Local setup (this PC only)
- The local database mirrors main's configuration (services, categories, templates). E-mail never leaves this PC: it is saved as files in `local-mail-outbox/`.
- Local test logins and the Google connection steps: `local-testing/README-LOCAL-TESTING.md` (not committed).
