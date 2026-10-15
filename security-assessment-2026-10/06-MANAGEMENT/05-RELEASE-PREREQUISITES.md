# 06 / 05 — What must happen before anything from this assessment goes to production

Status: DRAFT for management. Nothing in this folder has been pushed, merged, migrated or deployed. I will not do any of the steps below without your explicit approval for each one (project rule: test locally, get the owner's OK before every push/deploy).

## Step 0 — the urgent one (can be done on its own, before everything else)
**Upgrade the web framework on production (Next.js 16.2.9 → 16.3.8).** Why: the version in production has published critical flaws, including an unauthenticated remote-code-execution advisory for Windows servers (CVSS 9.0) — and production is a Windows server reachable from the internet. Conditions for that specific flaw are rated "high complexity" and no public exploit was tested here, but it should not wait for the rest of the work. This is an app-only release (no database change). It rides on the same normal release route used for the last deployment (build, zip, swap folder, health check, rollback folder kept). Because the upgrade is already inside commit `35922ad` together with the other fixes, you can either (a) release everything in Step 1–3, or (b) ask me to prepare a **separate, framework-only branch** (package files only) for an immediate release. Recommended: (b) first, then the rest.

## Step 1 — before the database migration
1. Take a fresh backup of `ckdesk` (`CK_Backup_CKDESK` or a manual `pg_dump -Fc`) and note its file name. (The earlier release used this procedure.) A restore test of that backup has never been recorded — do one on a spare machine if you can; it is also the best SOC 2 / ISO evidence you can create this week.
2. Read the live migration table on the database server (`auth.schema_migrations`) and confirm migrations 156–163 are applied (the repository cannot prove it). Migration 164 must go on top of 163.
3. Review `supabase/migrations/20240101000164_vapt_security_hardening.sql` and `supabase/rollback/164_vapt_security_hardening_rollback.sql` with the person who owns the database. The migration is idempotent and runs in one transaction; the rollback restores the previous rules.
4. Choose a quiet time. The migration removes the right to insert tickets directly (the server does it), the right to upload straight into the task-attachment store, and tightens several policies. **The new application code must be live before or together with the migration** (old code inserts tickets as the user and would fail after the migration). Release order: app first only if the old app keeps working with the old database (it does); then migration; then restart PostgREST (the schema cache) as in the earlier release notes. If you prefer one step: stop the app, run the migration, deploy, start.
5. Tell users nothing changes for them; do a smoke test with a test account: create a ticket, add an internal note with a file, resolve it, approve by e-mail link.

## Step 2 — release the application
Normal procedure in `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` §4 (build with the production script, copy zip, swap the standalone folder, keep the rollback folder, check `/api/health` and `/api/version`). Extra checks for this release: sign in as a technician and confirm priority is a plain badge; send a test e-mail approval (code arrives in the mail body, not the subject); upload a 15–20 MB attachment to confirm the upload-size setting works (never fully tested here).

## Step 3 — configuration changes that are not code
- Set `TRUSTED_PROXY_HOPS` correctly (so sign-in is limited per address), and set separate `APPROVAL_LINK_SECRET`, `CSAT_LINK_SECRET`, `INTAKE_WEBHOOK_TOKEN` values (so one leaked secret does not open everything).
- Confirm on the live login service that self sign-up is **disabled** (`GOTRUE_DISABLE_SIGNUP=true`) and the minimum password length is at least 8.
- Decide HTTPS (a certificate and a reverse proxy, or keep access to the LAN/VPN only). When the site URL becomes https, set `NEXT_PUBLIC_APP_URL` to the https address and rebuild: cookies become Secure and HSTS is sent automatically.
- Check whether any live account still uses the shared default import password and force a reset if so (do not test it by signing in; ask the user admin to check the user list or reset those accounts).

## Rollback
Application: rename the saved `standalone-bak-…` folder back and start the service. Database: run `164_vapt_security_hardening_rollback.sql` (it restores the previous rules; it does not undo the harmless TRUNCATE/TRIGGER/REFERENCES revoke or the internal-flag back-fill). An application rollback never reverses a database change.

## Decisions I need from you before the release
HTTPS (yes/no/VPN), the default import password policy, whether managers may author Business Rules and workflow steps, and whether the remaining partly-closed ticket-edit rights should be tightened in this release or a later one (see `05-REMEDIATION/04-REMAINING-TECHNICAL-RISKS.md`).
