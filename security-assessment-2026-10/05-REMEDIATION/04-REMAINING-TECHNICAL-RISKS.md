# 05 / 04 — Remaining technical risks (after the LOCAL fixes)

Source: `00-FINDING-STATUS-TABLE.md` section B (and the master register). Plain language; severity as the assessor's rating.

## A. Needs a management decision (cannot be fixed by code alone)
1. **The site is on plain HTTP** (High, VA-API-01, earlier D-018/D-037). Passwords and login cookies cross the network unencrypted. Needs a certificate and reverse proxy (or VPN). The code is now ready: once the site URL starts with https, cookies become Secure and HSTS is sent.
2. **Default import password** (High, VA-API-02, earlier D-011). A user can no longer switch the "must change" flag off, but bulk-imported users still start with one shared password. Decide: random one-time passwords or invitation e-mails. **Production check needed: whether any live account still has it** (only the owner can check; never test it against production).
3. **Priority / SLA writes for technicians and managers are only partly closed in the database** (Medium). They can no longer change priority or deadlines, but can still change the assignee, description, form answers and some timestamps through the data API. The clean fix is server-only writes for those columns (design work).
4. **Managers can author Business Rules and approval workflow steps; intake reviewers can set priority at creation** (Medium, VA-TKT-02, VA-ADM-06, VA-ADM-09). Whether that is intended is a business decision.
5. **About 20 other configuration tables, and global settings (business hours, holidays, priorities), are writable by managers/admins** (Medium, VA-DB-03 rest, VA-ADM-03). Decide who owns them.
6. **Confidentiality tier for HR/Finance tickets** (earlier D-005): managers and admins read every ticket in the organisation.

## B. Open technical items (fixes known, not yet built)
Medium: separation of duties through delegate / add-approver side doors (VA-TKT-07); project/task/task-file role-only policies (VA-TKT-09, VA-DB-10); org tests on comment/attachment insert policies and requester reading of org-wide staff data (VA-DB-06/07 rest); one secret used for many purposes and sent to Microsoft in a URL when no dedicated token is set (VA-API-05); sign-in throttling per address needs `TRUSTED_PROXY_HOPS` (VA-API-03).
Low: Store Master spreadsheet parse limit (VA-ADM-18); webhook design items; reset-mail timing; unaudited exports; home dashboard trusts caller flags; excess `anon` grants; web-push address check at the database; intake mail viewer remote-image blocking.
Accepted: `uuid` moderate advisory through `exceljs` (no non-breaking fix; vulnerable call unused).

## C. Could not be verified here
- **Self sign-up on the live login service** (VA-DB-08): the local config enables it; the production template disables it. If it were on in production, any stranger could create an account in the first organisation. Needs a read-only check of the live GoTrue setting by the owner.
- **Uploads of 10–25 MB**: Next.js buffers request bodies at 10 MB by default behind `proxy.ts`; the fix is a configuration change, not exercised with a real 20 MB upload.
- **Real e-mail/WhatsApp/OAuth behaviour** (reply spoofing against real Gmail headers, webhooks): proven at logic level only.
- **Production configuration** (Node version, `APPROVAL_LINK_SECRET`, `INTAKE_WEBHOOK_TOKEN`, `TRUSTED_PROXY_HOPS`, firewall exposure of the database/storage ports on the 8443 proxy).

## D. The most important production fact
Production still runs **Next.js 16.2.9**, which has published critical advisories (an unauthenticated remote-code-execution flaw on Windows servers rated 9.0, fixed in 16.3.3). Nothing from this assessment is deployed. This is the first thing to release (see `06-MANAGEMENT/05-RELEASE-PREREQUISITES.md`).
