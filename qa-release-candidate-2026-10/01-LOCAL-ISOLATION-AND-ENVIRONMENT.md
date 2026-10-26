# 01 — Local isolation and environment

Date of the run: 26 Oct 2026 (IST). Branch: `qa/release-candidate-2026-10` (local only). Nothing was pushed. `main` was not touched. No production server, database, NAS, sheet, mail or weather service was contacted.

## 1. What "isolated" means here

| Item | Value | Evidence |
|---|---|---|
| Test database | a separate Docker stack, container `supabase_db_ckdesk_audit`, API port 55421 | `evidence/01-isolation-gate-1.txt` (D1–D5) |
| The developer database (port 54321, holds production-derived data) | **not used** for any destructive, load, fuzz or fault test | gate check D5, C4 |
| App under test | the QA copy of the app on `http://localhost:3310`, started by `.claude/launch.json` entry `citykart-desk-qa` (`tooling/qa-start.cjs`) | gate check C5 |
| Mail | goes to a folder on this PC (`evidence/mail-sink/`), never sent | gate C3, `QA-START.txt` |
| Sheets | demo CSV files in `tooling/sheets/` (no Google call) | page "Connected as demo files on this computer" |
| Files | Docker volume on this PC (no NAS) | gate D3 |
| Data | synthetic only (`*.qa@audit.test`, `*@example.test`, stores QSA…QSE) | gate B3, B4 |

## 2. The isolation gate (21 checks) — PASSED 21/21

Run before every group of tests. A test refuses to start if any check fails (`tests/setup/audit-only.ts`). Result file: `evidence/01-isolation-gate-1.txt`. It was re-run automatically before **every** vitest run in this QA (more than 25 runs, all "ISOLATION GATE: PASSED (21/21)").

Checks, in plain words: every URL setting points to this PC; no setting names a production address; mail, WhatsApp, Google and AI settings are blank; the database is the audit stack and not the developer stack; no developer-stack key falls through; the outbound-connection guard is loaded; the audit mail trap is the only mail target; the file store is local; no mailbox or WhatsApp channel is active; every user and ticket in the audit database is synthetic; and no program on this PC holds a connection to 10.0.1.98 / 10.0.0.205 / 10.0.0.25 / 10.0.1.12 / 182.72.84.10.

One honest note: check N1 saw the user's own Chrome holding a connection to the public production address. That is the user's browser, not this QA (the QA never used it), and the gate reports it as such.

## 3. Outbound-connection proof

`evidence/01-egress-proof.txt`: with the guard loaded, a connection attempt to the production app (10.0.1.98), production database (10.0.0.205), NAS (10.0.0.25), retired server (10.0.1.12), the public production address, `example.com`, the weather service, `sheets.googleapis.com` and `smtp.gmail.com` was **refused before any socket opened**. Only `127.0.0.1:55421` (the audit stack) connected. Result line: *"every outside connection was refused or never made"*.

## 4. Same shape as the real system

`evidence/01-schema-parity.txt`: dev stack and audit stack both have 128 tables, 1,278 columns, 98 functions. The audit stack also carries migration **185** (see QA-D002). The audit stack was backed up before the QA started (`evidence/db/audit-before-qa.dump`, git-ignored).

## 5. Tools used

vitest 3.2.7 (1,500+ tests of the project plus the new QA tests), the Claude desktop browser pane (Chromium, Chrome 152), axe-core (accessibility), curl, Docker (fault injection on the audit containers only), psql inside the audit container.

## 6. What was changed in the project during QA (local working tree, not pushed)

Code fixes for the defects in `15-MASTER-DEFECT-REGISTER.md`, new tests under `tests/unit/`, `qa-release-candidate-2026-10/tests/`, migration `20240101000185_config_tables_admin_only.sql` (+ rollback), the QA tooling and this report folder. Existing uncommitted work of the user was kept (the files listed as modified at the start of the session were not reverted).

Temporary item: `public/qa-axe-tmp.js` (accessibility test script) was copied into `public/` for the accessibility sweep, excluded from git, and removed at the end.

## 7. Verdict for this section

Isolation **verified** (gate 21/21, egress proof). Dynamic testing was therefore allowed. **PASS.**
