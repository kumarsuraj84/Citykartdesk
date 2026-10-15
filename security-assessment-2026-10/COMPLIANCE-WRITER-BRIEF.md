# Writer brief — ISO 27001 / SOC 2 / VAPT report documents (shared rules)

You are writing deliverable documents for the internal security and compliance readiness assessment of Citykart Desk (CKDesk) on 2026-10-15. Write real, specific content for THIS application; no generic templates, no filler. Write in plain, simple English that a business owner can follow (short sentences, explain any term once), while keeping technical references precise.

## Hard safety rules
- Write only the files named in your task (inside `security-assessment-2026-10/`). Do not edit source code, tests or any other file. No git commands that change anything.
- Do not connect to production (10.0.1.98, 10.0.0.205, 10.0.0.25, 10.0.1.12, 182.72.84.10) or any network host; no ssh. Do not read `.env*` files. You may read the repository and `docker exec supabase_db_ckdesk_audit psql -U postgres -tAc "<SELECT only>"` (the disposable audit DB) if you need a fact.
- Never print passwords, keys, tokens, or real employee data.

## Evidence honesty rules (mandatory)
Classify every piece of evidence: **A** verified LOCAL technical evidence (our own tests on the isolated stack) · **B** repository evidence (source, migrations, scripts, procedures written down) · **C** authorised organisational evidence (approved policies, real access-review records, backup/restore records, training records, management approvals — NONE has been supplied so far, so you must not claim any) · **D** documentation-only · **E** missing / not verified.
- A document or script existing is NOT proof a control operates. Use the states: Designed · Implemented · Tested · Operating with evidence · Not implemented · Not verified · Not applicable (with justification).
- Do NOT invent: training records, approvals or signatures, management reviews, incident exercises, physical-security inspections, access reviews, restore tests, vendor assessments, auditor statements, dates of events that did not happen. Do NOT backdate. Policies you draft are labelled **DRAFT — not approved** and carry "Owner: to be assigned by management". Never mark missing evidence as passed.
- Never claim ISO 27001 certification, SOC 2 Type I/II attestation, or "compliance". This is an internal readiness assessment; only an accredited certification body (ISO) or an independent CPA firm (SOC 2) can issue those.
- Where a mapping to the standard is uncertain, or you cannot recall an exact requirement/control wording, mark it "PROVISIONAL — confirm against the licensed standard" instead of inventing wording. Use control identifiers you are confident about (ISO/IEC 27001:2022 Annex A has 93 controls: A.5.1–A.5.37 organisational (37), A.6.1–A.6.8 people (8), A.7.1–A.7.14 physical (14), A.8.1–A.8.34 technological (34); clauses 4–10. SOC 2 Trust Services Criteria: Common Criteria CC1–CC9, Availability A1, Confidentiality C1, Processing Integrity PI1, Privacy P1–P8).
- Do not treat a LOCAL fix as deployed: **nothing from this assessment is deployed**. Production runs build 20261015-145217 (main `717e5c6`), which does NOT contain the assessment's fixes.
- Describe facts about the organisation only where the repository shows them. Where something would be known only to management (who is the owner, headcount, policies, contracts), write "Not known from the repository — management to confirm" and list it as a data request.

## Facts you can rely on (read these files first; they are the authoritative inputs)
- `security-assessment-2026-10/01-BASELINE/01-APPLICATION-AND-SECURITY-BASELINE.md` (application, modules, roles, boundaries)
- `security-assessment-2026-10/01-BASELINE/02-LOCAL-ISOLATION-CERTIFICATION.md`
- `security-assessment-2026-10/01-BASELINE/03-EXISTING-AUDIT-RECONCILIATION.md` (75 earlier findings classified)
- `security-assessment-2026-10/01-BASELINE/04-CONTROL-EVIDENCE-INVENTORY.md` (what the repo shows about management controls, with gaps) — THE main input for ISO/SOC 2 work
- `security-assessment-2026-10/05-REMEDIATION/00-FINDING-STATUS-TABLE.md` (authoritative status of every VAPT finding)
- the raw source reviews in `vapt-2026-10/work/review-*.md` (ticket actions, admin/report actions, API/proxy/auth, database/RLS, uploads/e-mail/WhatsApp) and `vapt-2026-10/work/npm-audit*.json`
- `CLAUDE.md`, `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md`, `docs/POST-AUDIT-BATCH-2.md`
Key facts: production = app server 10.0.1.98 (Windows, Next.js app behind a port forward at http://182.72.84.10:3210, plain HTTP today), database server 10.0.0.205, NAS 10.0.0.25 (attachments); Supabase self-hosted (Postgres, PostgREST, GoTrue); ~553 users, 278 tickets at last count; roles requester/technician/manager/admin/platform owner; one developer identity commits everything; no CI; no off-server backup recorded ("Not done yet" in the docs); System Log with hash chain exists; HTTPS not in place; backups are described in prose (nightly 02:30, 30 days) but the script is not in the repo and no restore test is recorded.

## Format
Markdown. Start each file with a title, the date 2026-10-15, the status line "DRAFT for management review — internal readiness assessment, not an audit report or attestation", and a short "How to read this" paragraph. Use tables where they help. End each file with "Open questions / evidence requests for management" listing exactly what management must supply (owner names, records) — numbered. Be complete: the matrices must cover every item requested, not a sample.
