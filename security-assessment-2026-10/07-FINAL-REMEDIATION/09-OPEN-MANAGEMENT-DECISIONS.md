# 09 — Open management decisions

LOCAL ONLY. Each decision below is **Citykart policy**, not a technical choice. The code for every option already exists (or, for HTTPS, is ready), and **every default equals today's behaviour**, so nothing changes in production unless the owner chooses it. Nothing here was decided by the technical team.

How to read each block: *Today* = what the system does now. *Risk* = what can go wrong. *Options* = what can be chosen. *Recommendation* = the technical team's advice (advice only). *Impact* = who notices. *Approval* = who must say yes. *Default* = what happens if nobody decides.

---

## D-1  HTTPS for the public address (finding VAPT-002, rated High)

- **Today:** the public address `http://182.72.84.10:3210` is plain HTTP. Anyone on the network path between a user and the server can read the password and the login cookie. The code is already HTTPS-ready: cookies are marked "Secure" and the browser is told to insist on HTTPS the moment the site address starts with `https`. The owner said on 2026-10-17: *"leave HTTP for now, we will later make it HTTPS."*
- **Risk:** password and session theft on any untrusted network (shop Wi-Fi, a compromised router, a hotel). Highest-impact open item in the whole assessment.
- **Options:** (a) a certificate and a reverse proxy in front of the app (Windows IIS/ARR, nginx or Caddy) on a name such as desk.citykart.org; (b) allow access only from inside the company network or a VPN, and keep HTTP inside; (c) stay on HTTP and accept the risk in writing.
- **Recommendation:** (a), or (b) as a stop-gap. Do not let outside traffic reach the HTTP port.
- **Impact:** users get a new address; e-mail links and the WhatsApp/Gmail webhooks need the new address; the reverse proxy must allow 30 MB uploads.
- **Approval:** owner + infra owner.
- **Default:** stays HTTP (risk accepted by omission). Recorded as *Requires Decision*, never as Fixed.

## D-2  Who may change global settings (VAPT-007)

- **Today:** managers, admins and owners may change organisation-wide settings (switch **global_settings_write**, default "managers and above"). Settings are limited to an allow-list with value checks.
- **Risk:** a manager account (or a stolen one) can change organisation-wide behaviour (for example mail and approval settings).
- **Options:** keep (managers+) / admins and owners only / owner only.
- **Recommendation:** admins and owners only.
- **Impact:** managers lose the settings page; admins gain the work.
- **Approval:** owner. **Default:** managers+ (today).

## D-3  Who owns Business Rules (VAPT-008)

- **Today:** managers may write Business Rules (switch **business_rules_write**). A rule can only make a status change a person could already make (plus auto-close), and the history names the rule and the system as the actor.
- **Risk:** a rule is a standing instruction that runs for everybody; a wrong or hostile rule changes many tickets at once.
- **Options:** managers+ (today) / admins and owners only.
- **Recommendation:** admins and owners only, with a second pair of eyes for new rules.
- **Impact:** managers must ask an admin to create rules. **Approval:** owner. **Default:** managers+ (today).

## D-4  Who may edit approval workflows (VAPT-009)

- **Today:** managers may edit approval steps (switch **workflow_edit**). Requesters and senders can never be their own approver on any route (fixed and tested).
- **Risk:** someone who controls the steps controls who can approve; steps can be edited while a request is waiting.
- **Options:** managers+ (today) / admins and owners only / admins plus a "changes are reported to the owner" notice.
- **Recommendation:** admins and owners only.
- **Impact:** managers lose step editing. **Approval:** owner. **Default:** managers+ (today).

## D-5  Priority override when a mail or WhatsApp request is converted (VAPT-010)

- **Today:** a reviewer may choose the priority of a converted request (switch **intake_priority_override**: allowed). Priority of an existing ticket cannot be changed by hand at all.
- **Risk:** a reviewer can raise priority to jump the queue and shorten SLA targets.
- **Options:** allowed (today) / denied (priority is always decided by the service and its rules).
- **Recommendation:** denied, unless the business needs urgent hand-triage — then allowed with the choice recorded (it already is audited).
- **Impact:** reviewers lose one field. **Approval:** service-desk head. **Default:** allowed (today).

## D-6  One-time password or invitation for new accounts (VAPT-003)

- **Today:** both are built. Bulk import creates a random one-time password per person (shown once to the administrator) **or** sends an invitation link; the user must change the password at first sign-in (enforced by the server and by the database). The old shared default password is gone for new accounts.
- **Risk:** a one-time password handed over in a spreadsheet or chat can be read by others; an invitation link goes to the mailbox instead.
- **Options:** one-time password only / invitation only / either (today).
- **Recommendation:** invitation by default; one-time password only for people without a company mailbox.
- **Production check regardless of the choice:** find out whether any live account still has the **old shared password**, and reset those.
- **Approval:** IT head. **Default:** either.

## D-7  Invitations to outside e-mail domains (VAPT-052, partly fixed)

- **Today:** an administrator can invite any address; outside-domain invitations are audited and rate-limited. A new switch **external_invites** can refuse them (default: allowed, as today).
- **Options:** allowed (today) / only the company mail domains (set ORG_MAIL_DOMAINS) / refuse all.
- **Recommendation:** only company domains, with an owner exception list.
- **Approval:** owner. **Default:** allowed.

## D-8  May reports go to OEM (vendor) contacts? (VAPT-053)

- **Today:** scheduled reports may be addressed to OEM contacts (switch **report_recipients**: users and OEM). OEM contact changes are audited.
- **Risk:** ticket data leaves the company.
- **Options:** users and OEM (today) / users only.
- **Recommendation:** users only, plus a named exception list reviewed quarterly.
- **Approval:** owner. **Default:** users and OEM.

## D-9  HR and Finance confidentiality tier (earlier audit D-005)

- **Today:** managers and admins can read **every ticket in the organisation**. Nothing was changed in this behaviour (only preparation exists), because it is a policy question.
- **Risk:** salary, disciplinary or legal tickets are visible to every manager.
- **Options:** keep / a "confidential" flag on selected services (visible only to the named team and the requester) / separate HR and Finance organisations in the tool.
- **Recommendation:** the flag on selected services; it needs a small build and a list of services from HR and Finance.
- **Impact:** managers no longer see those tickets in reports unless added. **Approval:** HR head, Finance head, owner. **Default:** keep.

## D-10  Malware scanner for uploaded files (VAPT-065, partly fixed)

- **Today:** files are checked by type, size and macro content; per-person upload limits apply; a scanner connector for **ClamAV** exists and refuses uploads if the scanner is configured but unreachable. **No scanner is installed or running anywhere, so files are not virus-scanned.**
- **Options:** (a) install ClamAV on the app server or a small VM and set ATTACHMENT_SCANNER=clamd with its address; (b) rely on the endpoint antivirus of the NAS; (c) accept the risk.
- **Recommendation:** (a). Free, small, one service.
- **Impact:** uploads wait a second or two for the scan; if the scanner stops, uploads are refused (by design).
- **Approval:** IT head. **Default:** unscanned.

## D-11  Dependency advisory on the spreadsheet library (VAPT-DEP-02)

- **Today:** closed in code by a pinned patched version of the inner library; production dependency audit shows 0 vulnerabilities. Decision left: accept the override as permanent policy (re-checked at each release), or replace the spreadsheet library in a future release.
- **Recommendation:** accept the override; re-run the audit at every release. **Approval:** IT head. **Default:** override stays.

## D-12  Owners for ISO 27001 and SOC 2 controls

- **Today:** the readiness drafts name roles but **no person has accepted ownership**; no evidence has been collected over a period; no auditor is engaged.
- **Options:** name an owner for each control family (access, change, backup, incident, vendor, HR, physical); decide whether SOC 2 Type I (design at a date) or Type II (operation over 3–12 months) is the goal; decide which Trust Services Criteria are in scope (recommended: Security and Confidentiality; Availability only if a commitment is made).
- **Recommendation:** start with Type I scoped to Security and Confidentiality, owners named by the IT head within 30 days.
- **Approval:** management. **Default:** drafts stay drafts.

## D-13  Newly raised: shared-secret fallback and proxy hop count

- **Today (checked read-only on the live server):** the live configuration has only one shared secret (`CRON_SECRET`). The new code does not borrow it for other purposes unless the temporary switch `ALLOW_SHARED_SECRET_FALLBACK=1` is on. There is no reverse proxy in front of the app yet, so `TRUSTED_PROXY_HOPS` correctly stays unset until HTTPS is added.
- **Options:** (a) first deploy with the switch on (no change for users; old approval links stay valid), then later create the separate secrets in a planned step (links sent before that moment stop working, so do it when few approvals are pending) and remove the switch; (b) create the separate secrets at the first deploy.
- **Recommendation:** (a). **Approval:** IT head. **Default:** (a) — the release plan uses it.

---

**Summary of defaults:** nothing above changes production behaviour by itself. Each *Requires Decision* finding (VAPT-002, 007, 008, 009, 010, 053) stays open as a decision until the owner picks an option; VAPT-052 and VAPT-065 stay *Partially Fixed* until D-7 and D-10 are decided.
