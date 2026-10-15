# 04 — Authentication, Role Access (RBAC) and Database Rules (RLS) (VAPT of Citykart Desk, CKDesk)

Date: 2026-10-15
Status: DRAFT for management review — internal readiness assessment, not an audit report or attestation

## How to read this

This file covers three things: how people sign in and stay signed in; what each of the five roles can and cannot do; and the rules inside the database (row-level security, called RLS, plus triggers and grants) that must hold even when someone skips the screens.

Every finding uses the same plain-language template. Statuses come only from `05-REMEDIATION/00-FINDING-STATUS-TABLE.md`; this file never claims more than that table says. Words used:
- **Fixed in LOCAL** — changed in the working copy and tested on the disposable stack. **Not deployed.**
- **Partially Fixed**, **Requires Decision** (the owner must choose), **Open**, **Not Verified** — as in the table.

Evidence classes: **A** verified LOCAL technical evidence; **B** repository evidence; **E** missing or not verified. Production runs build `20261015-145217` (main `717e5c6`), which contains **none** of these fixes. No finding here was tested on production.

Where each database finding is written up (to avoid saying the same thing twice): the ticket-integrity findings VA-DB-01, VA-DB-02 and VA-TKT-01 are in file 05; the attachment and storage findings VA-DB-05, VA-DB-06 (internal-file part), VA-INT-01, VA-INT-10 are in file 06. They appear in the index in section 5 with a pointer.

---

## 1. How identity works (the facts the findings rest on)

1. A person signs in at `/login`; the login service (GoTrue) issues a token stored in a browser cookie. The browser keeps that cookie and the public key.
2. `proxy.ts` checks the cookie on every page and route except the allowlist (file 01 §4.2). It deletes any client-supplied "verified user" header and sets its own, signed with a server-only key. A client therefore cannot choose its user id (reviewed as sound; D-001 fix present).
3. `getCurrentProfile()` reads the person's **role from the database on every request**. A demotion takes effect at once.
4. Normal reads and writes use the person's own database login, so RLS applies. About 104 source files use the all-powerful service key; there the role check inside the code is the only barrier.
5. **The browser holds the same login as the server actions.** A person can open the browser console and send the same requests the screens send, or others. Any rule that exists only in a server action or a page is therefore a **screen rule**, not a real rule. The database must repeat any rule that matters. Most High and Medium findings in this assessment are of this kind.

---

## 2. Role-by-role access results

"By design" means the owner chose it. "Fixed in LOCAL" means the exploit worked before and is refused now on the disposable stack. Tests: T10, T11, T12, TU, TB (named in file 03 §1).

| Role | Tickets it can read | Internal notes and files | Configuration it can write (database) | Configuration it can write (app screens) | Reports | Users and identities | Result and status |
|---|---|---|---|---|---|---|---|
| **Requester** (`user`) | own tickets, tickets they collaborate on or approve, direct reports' tickets. Read-only simulation: sees no other ticket | note hidden. Files on internal notes and note text in notifications **leaked before**; fixed (T10) | none. But could **create a ticket directly** with a forged priority (**fixed**, T11) and create tasks for anyone (VA-TKT-09 open) | none | own tickets only; technician-only form fields in Report Builder **leaked** (VA-ADM-04, fixed in code) | could read the whole staff list and, before the fix, all mobile numbers (numbers **fixed**, T10; staff list VA-DB-07 **open**) | Blocked for ticket reading. Leaks found and mostly fixed. Open: org-wide staff, team, workflow and alert-rule reading |
| **Technician** (`agent`) | tickets of own group(s) | sees internal notes of own group's tickets | could change priority and deadlines of own group's tickets (**fixed**, T11); can still change assignee, description, form data, resolved/closed times via the data API (VA-TKT-01 rest, **Partially Fixed**) | none in admin area | own group scope | none | Priority and deadlines fixed. Rest open. Can add self to any project through the API (VA-TKT-09, open) and change intake review rows (VA-DB-10, open) |
| **Manager** | **every ticket in the organisation (by design, D-005)** | sees internal notes | could write services, SLA policies, global SLA config, field SLA overrides (**fixed**, T11 tests 5-6). About 20 other config tables still writable (VA-DB-03 rest, **Requires Decision**) | settings, sender name, test e-mail, Business Rules, workflow steps, org lists, holidays, business hours, priorities (VA-ADM-03, VA-TKT-02, VA-ADM-06: **Requires Decision**) | org-wide | could edit administrators, attach phone numbers, set reporting lines, add self to groups; **fixed** by the target guard (TU, unit level) | Org-wide reading is a recorded decision. Wide write list needs an owner decision |
| **Admin** | all in organisation | all | all config tables | all admin screens | org-wide | cannot change another admin or platform owner, cannot grant `admin`/`platform_owner`, cannot change own role or deactivate self (existing guard, TU) | As designed. Default bulk-import password is a **Requires Decision** item (VA-API-02) |
| **Platform owner** | all | all | all; the only role the database allows to write company-wide settings (business hours, holidays, priorities, app settings) | all; only role that may grant `admin` or `platform_owner` | all | all | As designed. Two accounts in the audit sample; the owner count in production is not known from the repository |

Source for this table: `review-database-rls.md`, `review-ticket-actions.md`, `review-admin-report-actions.md`, `00-FINDING-STATUS-TABLE.md`. Role simulations were read-only (`BEGIN; SET LOCAL ROLE ...; SELECT ...; ROLLBACK;`). Exploit tests T10 and T11 wrote only to the disposable audit stack.

---

## 3. Database rules: what is in place (verified, audit database, read-only)

| Fact | Value / result | Class |
|---|---|---|
| Row-security policies in `public` | 221 (222 before migration 164 removed the direct ticket-insert policy) | A |
| Tables with RLS on | 105 of 106; the one without, `system_log_chain_head`, has no rights for `anon` or `authenticated` | A |
| Tables with RLS on and no policy and no user rights (deny all) | 8: `approval_email_codes`, `system_log_archive`, `app_event_log`, `email_smtp_settings`, `org_signup_requests`, `processed_inbound_emails`, `conversation_events`, `conversation_attachments` | A (review) |
| Anonymous access | as `anon`, every table returned zero rows (read-only loop); no policy is true without a login | A (review) |
| `SECURITY DEFINER` functions | 39, **all with a pinned `search_path`**. The one function with dynamic SQL (`owner_delete_org`) quotes names with `%I`, binds the id, and re-checks `is_owner_org()`; EXECUTE is revoked from users | A |
| Who may run the definer functions | 19 service role only (secrets, system log, SLA upsert, e-mail replacement, deletion); 20 `anon`/signed-in (15 helpers keyed on the caller, `get_home_dashboard`, `request_identity_unchanged`, 3 trigger functions) | A |
| Profiles | signed-in users have `UPDATE` only on name, avatar (and, until M164, the reset flag); a trigger rejects any change of id, organisation, role, active flag, manager, store, department, location, employee id, job title, WhatsApp flag. Self-promotion is not possible | A (review) |
| Tickets | organisation test first; non-staff limited to own; `request_identity_unchanged()` freezes organisation, requester, service and team on update; status moves limited to an allowed list; ticket number and creation time frozen | A (review + M164) |
| Audit and System Log | `authenticated` has `SELECT` only; update, delete and truncate refused by trigger; hash chain with verify function; actor taken from the login, not a header (a user token cannot claim another actor) | A (review) |
| Approvals, decisions, activity | cannot be inserted or updated by users (restrictive deny policies) | A (review) |
| Storage buckets | `request-attachments`, `task-attachments`, `intake-attachments` private, 25 MB, type allow-list; `icons` is the only public bucket | A (review) |
| Engine settings | `postgres` is not a superuser; statement timeouts `anon` 3 s, `authenticated` 8 s; `row_security = on`; no `dblink`, `http`, `file_fdw`, `pg_cron` extension; user roles cannot create objects in `public` | A (review) |
| Excess rights | `TRUNCATE`, `TRIGGER`, `REFERENCES` revoked from `anon` and `authenticated` by M164 (0 tables hold TRUNCATE now). `anon` still holds table-level `INSERT/UPDATE/DELETE` on 18 tables and `SELECT` on 31; every policy fails for `anon` | A |
| The permission matrix screen (`custom_roles`, `permission_overrides`) | stores choices that no policy or code reads. **It is not a control.** | B |

**Not checked (not allowed):** the real production database 10.0.0.205, PostgREST and login-service settings on 10.0.1.98. Production uses a login role `citykart_desk_app`, not the Supabase `authenticator`. Whether the revokes of migrations 156 to 163 exist the same way there is **not verified**. The audit database carries a demonstration JWT secret; production must use its own.

---

## 4. Findings

### VA-API-01 — Sign-in and session cookies travel over plain HTTP, can be read by scripts and last over a year; no HSTS; the browser policy only reports
- **Severity:** High (as found).
- **Where found:** `proxy.ts` (cookie options copied straight from the library), `lib/supabase/server.ts`, `lib/supabase/client.ts`, `next.config.ts` (no `Strict-Transport-Security`; `Content-Security-Policy-Report-Only` only), `lib/http/csp.ts` (allows inline and eval scripts). Production URL is `http://182.72.84.10:3210`.
- **What is wrong?** The site is served without encryption, so passwords and login cookies cross the network in readable form. The login cookie is readable by page scripts and, from the library default, lasts about 400 days. The browser security policy only reports problems and does not block anything.
- **Why does it matter to Citykart?** Anyone on the network path (a store's Wi-Fi, an ISP, a compromised router) could capture a password or a login cookie and act as that person, including an administrator.
- **How was it checked?** Source review: confirmed by code that no override of cookie flags exists (class B). The exact cookie attributes on the live site were not looked at; this was not tested on production. HTTP probes did not cover cookie flags.
- **What was changed?** Nothing for this finding. The only related change is that the framework banner header `X-Powered-By` was removed (VA-API-14).
- **What happened after the fix?** Not applicable.
- **Status:** **Requires Decision** (earlier IDs D-018, D-037). It needs HTTPS in front of the app, which is a deployment decision.
- **What remains:** all of it. Put TLS in front (a reverse proxy with a certificate). Then set `Secure` and a bounded lifetime on the cookies, add HSTS, and move the policy from report-only to enforced once the reports are clean. Until then, do not expose port 3210 to the internet without a VPN. The "verified" cookie used on the approval page is `Secure` only when the app URL starts with `https`, so it also travels in clear text for its 30 minutes (VA-INT-11).
- **Technical evidence:** `vapt-2026-10/work/review-api-proxy-auth.md` VA-API-01; control inventory §3 and §11; `proxy.ts:96-115`; `next.config.ts:78-86`; `lib/http/csp.ts`.

### VA-API-02 — Bulk-created users share one default password written in the code, and "must change password" is only a page redirect (also VA-ADM-02, VA-DB-04, VA-TKT-18 part e)
- **Severity:** High (as found; conditional on bulk import with the password column blank).
- **Where found:** `lib/actions/admin/users.ts` (constant `DEFAULT_BULK_PASSWORD`, line 542; used at line 719; flag set at import), `app/(app)/layout.tsx:37` (the only place the flag is enforced), migration 156 (let a user clear their own flag), login-service minimum password length 6 in the local config (the app's rule is 8).
- **What is wrong?** Every account created by bulk import without a password starts with the same password, which is written in the source code (not repeated here). The only push to change it is a redirect when a page is opened; someone who calls the server directly never meets it. Until the fix, a signed-in person could also tell the database "reset not needed" and keep the default password forever.
- **Why does it matter to Citykart?** Staff e-mail addresses are easy to guess. Anyone who knows the pattern could sign in as an imported colleague who never changed it, and then act as that person. Which live accounts, if any, still have it is not known.
- **How was it checked?** Source review (confirmed by code). Exploit test T10 test 5: the user tries to clear their own flag through the data API (worked before, refused after). Unit test TU: the application code has no way for a user to clear the flag. Signing in with the default password was not tried.
- **What was changed?** Migration 164 removes the column right and the trigger refuses any client change of the flag. The server clears the flag itself, with the service key, only after a real password change (`lib/actions/auth.ts`). Changing your own password is limited to 5 tries per 10 minutes. (The page that sets a new password enforces an 8-character minimum only; it does not refuse the default password as a new password.)
- **What happened after the fix?** On the isolated stack the flag stays on after the user tries to clear it (T10 test 5 passes). Older remediation tests that expected the old behaviour were updated.
- **Status:** **Partially Fixed** (flag part, Fixed in LOCAL). The default password and server-side enforcement beyond the page layout: **Requires Decision** (earlier ID D-011).
- **What remains:** the default password constant is still in the code. Enforcement is still only in the layout (not in the proxy or `getCurrentProfile()`). Decision needed: random one-time passwords per user, or invitation e-mails only. The login-service minimum length (6) is below the app rule (8) and is a service setting, not code (D-036). **Production check:** whether any live account still has the default password (an authorised person to check on the live database without sharing the password).
- **Technical evidence:** `review-api-proxy-auth.md` VA-API-02; `review-database-rls.md` VA-DB-04; `review-admin-report-actions.md` VA-ADM-02; `tests/vapt/10-confidentiality-exploits.test.ts` test 5; `tests/unit/vapt-hardening-units.test.ts`; `supabase/migrations/20240101000164_vapt_security_hardening.sql` (flag block); `lib/actions/auth.ts`; `docs/POST-AUDIT-BATCH-2.md` ("Deliberately not changed").

### VA-API-03 — Sign-in and reset throttling is per account, in memory and can be turned against users (also VA-API-11, VA-TKT-18 parts b and c)
- **Severity:** Medium (VA-API-11 part: Low).
- **Where found:** `lib/rate-limit.ts`, `lib/actions/auth.ts`, `lib/email/auth-mail.ts`.
- **What is wrong?** The login page slows repeated guesses on one account (10 per minute) but does not slow someone trying one common password on every account, and a stranger can keep a named colleague locked out. The counters live in memory and vanish at every restart. The limit per sender address is switched off until the proxy chain is configured (`TRUSTED_PROXY_HOPS`). The forgot-password page answers the same text for every address, but known and unknown addresses take different time, and the form can be used to send reset e-mails to staff (3 per address per hour).
- **Why does it matter to Citykart?** Password spraying with the default password (VA-API-02) is the realistic attack. A lock-out of a named person is a nuisance attack. Sign-in failures in the System Log carry no source address, which weakens an investigation.
- **How was it checked?** Source review only (confirmed by code for the design; eviction and timing effects are "plausible"). The "100 different accounts in a minute" recipe was not run.
- **What was changed?** The limiter key is capped at 200 characters; changing your own password is limited to 5 per 10 minutes.
- **What happened after the fix?** Code-level evidence only (CODE). No test result was recorded.
- **Status:** **Partially Fixed**.
- **What remains:** set `TRUSTED_PROXY_HOPS` in production so a per-address limit works; decide a lock-out policy (a progressive delay is suggested over a hard block); a global hourly cap on reset e-mails; equal work for known and unknown addresses; consider a second factor for admin and platform owner (no MFA exists today). VA-API-11 is **Open**.
- **Technical evidence:** `review-api-proxy-auth.md` VA-API-03, VA-API-11; `lib/rate-limit.ts` (key cap); `lib/actions/auth.ts`; `tests/unit/rate-limit-client-ip.test.ts`.

### VA-API-09 — A deactivated person's open session kept working until the token ran out; a password change did not end other sessions (also VA-TKT-18 part a)
- **Severity:** Low (up to the token lifetime, 1 hour in the production template).
- **Where found:** `proxy.ts` (`getClaims()` checks the token locally), `lib/actions/admin/users.ts` (deactivation bans sign-in but does not end the open session), `lib/queries/profiles.ts`, `lib/actions/auth.ts`.
- **What is wrong?** When an administrator turns a person off, a session that is already open can keep using the app until its token expires. Changing a password did not end the person's other sessions.
- **Why does it matter to Citykart?** A leaver or a stolen session could keep working for up to an hour. The database already refused such a person any data (the organisation and role functions require an active profile), so the exposure was the app's own screens and actions.
- **How was it checked?** Source review and the database rule (class B). No dynamic test.
- **What was changed?** `getCurrentProfile()` now treats an inactive profile as signed out. A password change now ends the person's other sessions (`signOut` with scope "others").
- **What happened after the fix?** Code-level evidence only (CODE). Not run as a test.
- **Status:** **Fixed in LOCAL** (CODE evidence).
- **What remains:** a dynamic test (sign in, deactivate, repeat a request); confirm the production token lifetime (`GOTRUE_JWT_EXP`); the fix is not deployed.
- **Technical evidence:** `review-api-proxy-auth.md` VA-API-09; `lib/queries/profiles.ts`; `lib/actions/auth.ts`; `lib/actions/admin/users.ts`; `deploy/windows/config/auth.env.example:7`.

### VA-API-08 — Login CSRF: a web page on another site could sign a visitor in as the attacker (`/auth/confirm`)
- **Severity:** Low.
- **Where found:** `app/auth/confirm/route.ts` (POST).
- **What is wrong?** The address that consumes a one-time sign-in or reset token accepted a form posted from any other website. An attacker could submit their own valid token so the visitor's browser becomes signed in as the attacker, and anything the visitor then types is recorded under the attacker.
- **Why does it matter to Citykart?** Low direct harm (the attacker gains nothing from the victim directly), but it undermines trust in who is signed in.
- **How was it checked?** HTTP probe H4 on the audit app: a cross-site POST was processed (303 redirect) on the old build and refused (403) on the fixed build; a same-origin POST still works. Class A.
- **What was changed?** The route now refuses a POST whose `Origin` is not the site's own and refuses `Sec-Fetch-Site: cross-site`.
- **What happened after the fix?** 403 for cross-site; same-origin works (H4).
- **Status:** **Fixed in LOCAL**.
- **What remains:** deploy it; align the `GET /auth/callback` redirect base with the same configured address (hygiene).
- **Technical evidence:** `app/auth/confirm/route.ts` (modified); `review-api-proxy-auth.md` VA-API-08; probe H4 in file 03 §4.

### VA-DB-08 — Self sign-up may be switched on in the live login service, and every new account would land in the first organisation
- **Severity:** Medium if sign-up is enabled in production, Low otherwise.
- **Where found:** `supabase/config.toml:176,221` (`enable_signup = true`, local), trigger `on_auth_user_created` → `handle_new_user()` (puts the new person into the oldest organisation as a requester). The production template `deploy/windows/config/auth.env.example:51` sets `GOTRUE_DISABLE_SIGNUP="true"`, but also `GOTRUE_MAILER_AUTOCONFIRM="true"`.
- **What is wrong?** If the live login service allows self-registration, anyone holding the public key (it is in every page) could create an account that automatically becomes an employee of the first company, able to read the staff list and raise tickets.
- **Why does it matter to Citykart?** An outsider would become an insider with employee rights.
- **How was it checked?** Source and template reading only. The live service configuration was not read (not allowed).
- **What was changed?** Nothing.
- **What happened after the fix?** Not applicable.
- **Status:** **Not Verified** (depends on the real login-service setting on 10.0.1.98).
- **What remains:** an authorised person to confirm `GOTRUE_DISABLE_SIGNUP=true` on the server; set `enable_signup = false` in the local config; make `handle_new_user` create the profile inactive until an administrator activates it.
- **Technical evidence:** `review-database-rls.md` VA-DB-08; `deploy/windows/config/auth.env.example`; control inventory §2.1.

### VA-DB-03 — The database lets a manager write configuration that the screens reserve for administrators
- **Severity:** Medium.
- **Where found:** policies `services_admin`, `sla_policies_admin`, `sla_config_admin` on `global_sla_config`, `field_sla_overrides_write` and about 20 more (form templates, field library, categories, locations, departments, designations, job functions, cost centres, stores, OEMs, assignment rules, notification and alert rules, approval workflows and steps, team-member inserts). The app actions for services and SLA policies already accept only admin and platform owner.
- **What is wrong?** The screens say only an Administrator may edit services and SLA policies, but the database accepts the same edit from any Manager who talks to it directly with their own login.
- **Why does it matter to Citykart?** A manager, or anyone who steals a manager login, could lengthen every SLA or rewire services for the whole company. The changes are logged (detectable) but not prevented.
- **How was it checked?** Exploit tests T11 tests 5 and 6 on the isolated stack: a manager's update to a service and an SLA policy worked before and was refused after; the administrator can still write.
- **What was changed?** Migration 164 limits `services`, `sla_policies`, `global_sla_config` and `field_sla_overrides` to admin and platform owner.
- **What happened after the fix?** T11 tests 5 and 6 pass (manager refused, admin allowed).
- **Status:** **Fixed in LOCAL** for these four tables; the rest is **Requires Decision**.
- **What remains:** about 20 other configuration tables are still writable by managers; the permission matrix is not enforced; the owner must decide per table whether managers keep write access, then align the policies or revoke direct writes. Whether managers should see every ticket company-wide (today they do) is the separate recorded decision D-005.
- **Technical evidence:** `review-database-rls.md` VA-DB-03; `tests/vapt/11-integrity-exploits.test.ts`; migration 164 lines 140-155; `00-FINDING-STATUS-TABLE.md` rows "VA-DB-03".

### VA-DB-07 — Every signed-in employee can read organisation-wide personal and configuration data (also VA-INT-13)
- **Severity:** Medium (mobile numbers: Medium → fixed; others Medium open).
- **Where found:** policies `profile_mobile_numbers_select`, `profiles_select`, `team_members_select`, `alert_rules_select`, `escalation_policies_select`, `approval_workflows` and steps select, `saved_reports_select`, `scheduled_reports_select`, `stores`, `permission_overrides_select`.
- **What is wrong?** These tables only test "same organisation", so any of the ~300 ordinary employees can read the full staff list with role, manager and employee id, which technicians belong to which group, and the alert and escalation rules. Before the fix they could also read every colleague's mobile number, and a manager could attach a number to anyone.
- **Why does it matter to Citykart?** Mobile numbers are personal data. A phone attached to another person's account lets WhatsApp messages raise tickets in that person's name.
- **How was it checked?** Read-only role simulation (a requester with no tickets read 336 profiles, 25 team members, 418 workflows, 4 alert rules, 200 stores). Exploit test T10 test 3 for the mobile numbers (before and after).
- **What was changed?** Migration 164: mobile numbers readable by the owner of the row or by staff; written by admin and platform owner only. App side: `targetGuardError` extended so a manager cannot attach numbers (VA-ADM-05).
- **What happened after the fix?** T10 test 3 passes: a requester sees at most their own number; a manager cannot attach one to someone else.
- **Status:** **Fixed in LOCAL** for mobile numbers; the remaining tables are **Open**.
- **What remains:** restrict saved and scheduled reports to the creator or manager and above; consider hiding `employee_id`, `manager_id`, `role` from role `user`; restrict alert rules, escalation policies and workflows to staff. Ad-hoc approval workflow names no longer contain ticket titles (VA-TKT-06), but the workflow list is still readable by every employee.
- **Technical evidence:** `review-database-rls.md` VA-DB-07; `review-uploads-email-whatsapp.md` VA-INT-13; `tests/vapt/10-confidentiality-exploits.test.ts` test 3; migration 164 lines 97-107.

### VA-DB-06 (rest) — Several write policies test the role but not the organisation, so a second company's staff could reach the first company's rows
- **Severity:** Medium (Low while only one organisation is hosted).
- **Where found:** `request_comments_insert` and `request_attachments_insert` (manager/admin branch has no organisation test); similar patterns in `lib/actions/admin/*` (VA-ADM-12: referenced ids not checked against the organisation: SLA override function, org lists, team members, reviewer assignment, service tags).
- **What is wrong?** Some "may write" rules check the person's role but not that the ticket or record belongs to their own organisation.
- **Why does it matter to Citykart?** Today there is one organisation, so there is no practical effect. If a second organisation is ever hosted, a manager of one could write into the other's records.
- **How was it checked?** Policy text and code reading. The audit database has one organisation, so no cross-company test could run.
- **What was changed?** The file-store read rule was tightened with the organisation and internal-flag tests (migration 164, see VA-INT-01 in file 06). The comment and attachment insert policies were not changed.
- **What happened after the fix?** Not applicable for the open part.
- **Status:** **Open** (insert policies, VA-ADM-12).
- **What remains:** add `org_id = current_org_id()` to the manager/admin branches; use the existing `assertRefsInOrg` helper for every referenced id; re-run with a second synthetic organisation in the audit data.
- **Technical evidence:** `review-database-rls.md` VA-DB-06; `review-admin-report-actions.md` VA-ADM-12.

### VA-DB-09 — The home dashboard function trusts caller-supplied role flags (also VA-TKT-19)
- **Severity:** Low.
- **Where found:** `get_home_dashboard(p_is_manager, p_is_agent, p_team_id, p_has_tasks)` (SECURITY DEFINER, executable by `anon` and signed-in users).
- **What is wrong?** A requester can call it and say "I am a manager". The count of waiting "any manager" approvals then covers the whole database, and a task linked to any ticket shows that ticket's number.
- **Why does it matter to Citykart?** Small leaks of counts and ticket numbers, not content.
- **How was it checked?** Source and catalog reading (confirmed by code). Not executed.
- **What was changed?** Nothing.
- **What happened after the fix?** Not applicable.
- **Status:** **Open** (listed among the Low items).
- **What remains:** derive the flags from `current_user_role()` inside the function, add the organisation test, and revoke execute from `anon`.
- **Technical evidence:** `review-database-rls.md` VA-DB-09; `review-ticket-actions.md` VA-TKT-19.

### VA-DB-10 / VA-TKT-09 — Project, task, task-file and review rows trust the user to send honest ids
- **Severity:** Medium for cross-group reach to projects; Low for the rest.
- **Where found:** policies `project_members_insert/delete`, `project_updates_insert`, `tasks_insert`, `task_attachments_insert`, `intake_reviews_update`, `request_time_entries_update`, `csat_update_requester`; guard `guard_attachment_client_write` (leaves some columns free); `profiles_update_own` (anyone may rename themselves to any text).
- **What is wrong?** The screens check "is this your project?"; the database only checks "are you a technician?". A technician of group A can add themselves to group B's project through the API and read it. Any employee can create tasks assigned to anyone. A technician can change who reviewed an e-mail. A user can record a file against their own task that points at another task's file path (the path is long and random, so this is hard).
- **Why does it matter to Citykart?** Cross-group confidentiality of projects, forged review history, noise in other people's task lists, impersonation by display name.
- **How was it checked?** Policy and grant text read from the audit database (confirmed by code). The write recipes were not executed.
- **What was changed?** The direct upload into the task-files store was closed (migration 164, see file 06). Nothing else.
- **What happened after the fix?** Not applicable for the open part.
- **Status:** **Open**.
- **What remains:** put `can_view_project(project_id)` into the project-member and milestone policies; require a technician role and a visible parent in `tasks_insert`; require `storage_path` to start with the task id; grant `intake_reviews` only the columns and moves the review screen needs; freeze identity columns by trigger.
- **Technical evidence:** `review-database-rls.md` VA-DB-10; `review-ticket-actions.md` VA-TKT-09.

### VA-DB-12 — Excess table, sequence and default privileges that would remove all defence if a SQL path ever appeared
- **Severity:** Low (hardening).
- **Where found:** table privileges; default privileges; `net` (pg_net) and other schemas; `pg_default_acl`.
- **What is wrong?** `authenticated` and `anon` held `TRUNCATE`, `TRIGGER` and `REFERENCES` on almost every table; `anon` holds write rights on 18 tables that only row rules stop. Functions in `public` keep the default "everyone may run". None is reachable through the data API today.
- **Why does it matter to Citykart?** It is defence in depth. If a SQL-injection hole or a stray database login ever appeared, these rights would turn a small flaw into a large one.
- **How was it checked?** Catalog queries (`has_table_privilege`). Re-queried on 2026-10-15: 0 tables now hold `TRUNCATE` for `anon` or `authenticated`; `anon` still holds write rights on 18 tables.
- **What was changed?** Migration 164 revokes `TRUNCATE`, `TRIGGER`, `REFERENCES` from `anon` and `authenticated` on all `public` tables.
- **What happened after the fix?** Re-query shows 0 tables with `TRUNCATE` for both roles (class A).
- **Status:** **Partially Fixed**; the rest is **Open** (Low).
- **What remains:** revoke all rights of `anon` on `public` tables except where a public page needs them (none seems to); revoke default `PUBLIC` execute on functions; set `db-max-rows` and disable the public OpenAPI description in production; `anon` can run `request_identity_unchanged` as a yes/no check on a known ticket id.
- **Technical evidence:** `review-database-rls.md` VA-DB-12; migration 164 line 158; live re-query (this report).

The findings VA-DB-01, VA-DB-02, VA-DB-05, VA-DB-06 (internal-file part) and VA-DB-11 are written up in files 05 and 06; section 5 lists them with their status.

---

## 5. Index of every finding in this file's scope, with status

| ID(s) | Title | Severity (as found) | Status | Evidence |
|---|---|---|---|---|
| VA-API-01 | plain HTTP, cookies, no HSTS, report-only policy | High | Requires Decision | B |
| VA-API-02, VA-ADM-02, VA-DB-04, VA-TKT-18(e) | default password; forced reset only on page | High | Partially Fixed (flag) / Requires Decision (default password) | A (T10 test 5, TU) + B |
| VA-API-03, VA-API-11, VA-TKT-18(b,c) | throttling, lock-out, enumeration, reset-mail flood | Medium / Low | Partially Fixed / Open | B |
| VA-API-08 | login CSRF | Low | Fixed in LOCAL | A (H4) |
| VA-API-09, VA-TKT-18(a) | deactivated or stolen session | Low | Fixed in LOCAL | B (CODE) |
| VA-DB-01, VA-DB-02, VA-TKT-01 | ticket integrity | High / Medium | Fixed in LOCAL (part) / Partially Fixed | A (T11) — file 05 |
| VA-DB-03 | manager writes admin configuration | Medium | Fixed in LOCAL (4 tables) / Requires Decision (rest) | A (T11) |
| VA-DB-05, VA-INT-10 | task-files store direct upload | Low-Medium | Fixed in LOCAL (upload) | A (T10) — file 06 |
| VA-DB-06 | file-store read rule; insert policies | Medium | Fixed in LOCAL (read rule) / Open (insert) | A (T10) + B |
| VA-DB-07, VA-INT-13 | org-wide readable personal data; mobile numbers | Medium | Fixed in LOCAL (numbers) / Open (rest) | A (T10) + B |
| VA-DB-08 | self sign-up | Medium or Low | Not Verified | B |
| VA-DB-09, VA-TKT-19 | home dashboard function | Low | Open | B |
| VA-DB-10, VA-TKT-09 | role-only write policies | Medium / Low | Open | B |
| VA-DB-11, VA-TKT-13, VA-API-13 | approval-code counter | Low | Fixed in LOCAL (counter) | A (TB) — file 05 |
| VA-DB-12 | excess privileges | Low | Partially Fixed / Open | A |

VA-API-13's other half (code requests and verifications are limited by in-memory counters that reset on restart) is not named in the status table; treat it as **Open**.

---

## Open questions / evidence requests for management

1. Production login-service settings, read from the server by an authorised person: self sign-up (`GOTRUE_DISABLE_SIGNUP`), minimum password length, token lifetime, session length, whether e-mails are auto-confirmed. (VA-DB-08, VA-API-02.)
2. Decision on HTTPS: who will own obtaining a certificate and a name for the site, and by what date? Owner to be assigned by management. Until then, will access be limited to the office network or a VPN? (VA-API-01.)
3. Decision on the default bulk-import password: random one-time passwords, invitation e-mails only, or accept the risk with a named owner. (VA-API-02, D-011.)
4. Result of a check on the live database: does any live account still have the default password? (An authorised person to run the check and report only a count, never the password.)
5. Decision on how many ordinary technicians and managers should see data across groups: manager-wide ticket reading (D-005), manager write access to configuration tables, Business Rules and workflow steps. Name the decision owner.
6. How many platform owners and administrators exist in production, and who approves adding one? (Not known from the repository; the audit sample has 2 and 5.)
7. Is a second factor for admin and platform owner wanted? (No MFA exists.)
8. A written leaver procedure: who tells the administrator, and within what time is an account deactivated? (The control inventory finds none.)
9. Evidence that migrations 156 to 164 are (or are not) applied on 10.0.0.205: the contents of `auth.schema_migrations`, read by an authorised person.
10. The firewall and router rules: is the login/data/file proxy on port 8443 reachable from outside the office network?
