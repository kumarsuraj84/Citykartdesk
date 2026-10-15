# SOC 2 Evidence Collection Calendar - CKDesk

Date: 2026-10-15
Status: DRAFT for management review — internal readiness assessment, not an audit report or attestation

## How to read this

This is the recurring work calendar for a future SOC 2 Type II examination: what evidence to collect daily, weekly, monthly, quarterly and yearly, and which role does it. It has three parts: (1) a **proposed** examination period for discussion with the external auditor, (2) a **readiness checklist** of what must exist before that period starts, and (3) the **recurring calendar**.

Three important points:

1. **Nothing in this calendar has started.** No task below has been done. Do not start a period on paper; the period begins only when the controls really run. Records must carry their real date. Nothing is back-dated.
2. **The examination period is a proposal.** The period start, length and scope are decided by the external auditor (an independent CPA firm) together with management, not by this document.
3. Owner roles are placeholders: **Owner: to be assigned by management**. Frequencies and times are PROVISIONAL. Evidence IDs (EV-...) are in SOC2-EVIDENCE-REGISTER.md, control IDs (C01-C16) in SOC2-TYPE-II-CONTROL-OPERATION-PLAN.md.

---

## Part 1 - Proposed examination period (for DISCUSSION with the auditor; the auditor decides)

| Item | Proposal | Why |
|---|---|---|
| Start rule | The first day of a calendar month **after** every item in the readiness checklist (Part 2) is ticked with evidence and management has signed that the controls are live. | A period that starts before the controls run only produces exceptions. |
| Earliest realistic start | Cannot be stated truthfully today. As an illustration only: if the readiness work is finished by 2027-03-31, a period could start on 2027-04-01. | Several items need decisions and builds that have not been made (HTTPS, off-server backup, owners, policies). |
| Length of the first period | A **3-month minimum** after the controls are live (for example 2027-04-01 to 2027-06-30); the auditor may ask for longer (6 or 12 months is common in practice - PROVISIONAL, auditor decides). | A shorter period leaves too few occurrences of quarterly and annual controls to test. With a 3-month period a quarterly control has one occurrence; the auditor may then treat annual controls differently. |
| Annual controls in a short first period | Perform each annual control once **before** the period starts (restore test, tabletop, policy approval, risk assessment, supplier review, penetration test if feasible) so the auditor can inspect it. | The auditor decides whether one performance is enough. |
| Type I first? | Optional discussion item. A Type I report looks at design at one date and does not need an operating period. Whether it helps is the auditor's and management's choice. | Not required for Type II. |
| Scope categories | Security (always). Availability, Confidentiality, Processing Integrity and Privacy only if management chooses them. | Changes which controls are tested. |
| Pre-period rehearsal | Run the calendar for one full month as a **dry run** before the real period; label the records "dry run" and keep them separate. | Finds problems without creating exceptions inside the period. |

**Honest note:** no historical period can be claimed. Everything before the real start is "not collected".

---

## Part 2 - Readiness checklist (all must be true before the period starts)

All boxes are **unticked**. Tick only when the evidence exists, with the date and the evidence ID. Owner for the checklist: Compliance Coordinator (to be assigned).

### A. People and governance
- [ ] Executive Sponsor named and has accepted the role in writing (EV-CG-02).
- [ ] Owners and backup owners named for all control areas (SOC2-CONTROL-OWNER-MATRIX.md); today 33 areas, none named.
- [ ] Independent Reviewer named (a person who does not perform the controls they check).
- [ ] Information security policy set approved by management (EV-C14-01), including change, access, backup, incident, supplier, acceptable use.
- [ ] Risk assessment method approved and first risk register built and signed (EV-C13-01, EV-C13-02, EV-C13-06).
- [ ] Evidence store created, access-controlled, read-only for non-collectors.
- [ ] Auditor selected; scope and criteria agreed in writing (EV-CG-04).

### B. Access
- [ ] Joiner / mover / leaver procedure approved; HR leaver feed agreed (EV-C01-01, EV-C01-06).
- [ ] Decision on default import password D-011 taken; production check for accounts still using it done (EV-C01-08).
- [ ] Live setting that switches off public sign-up shown and saved (EV-C01-09).
- [ ] First access review completed as a baseline, with sign-offs (EV-C02-02 to EV-C02-06).
- [ ] Privileged list built; shared Administrator account replaced or accepted with an exception; key holders recorded (EV-C03-01 to EV-C03-05).
- [ ] Decision on multi-factor authentication and session limits recorded (accept or fix).

### C. Change and security testing
- [ ] Change procedure approved with a second approver or compensating review; release register created (EV-C04-01, EV-C04-03).
- [ ] Branch protection / required review set up on GitHub, or an exception signed (EV-C04-09).
- [ ] Decision taken on deploying the LOCAL assessment fixes (Next.js 16.3.8 and migration 164 and the rest); fixes deployed or risk signed. **Nothing from this assessment is deployed today.**
- [ ] Vulnerability management and patching procedures approved; first version inventory and first `npm audit` saved (EV-C05-01, EV-C05-02, EV-C06-02).
- [ ] Server vulnerability scanner chosen and first scan done, or exception signed.
- [ ] Independent penetration test planned or done (EV-C16-01, EV-C16-02).

### D. Operations and resilience
- [ ] Backup script and its schedule copied into evidence; at least 30 days of `backup.log` collected (EV-C07-01 to EV-C07-04).
- [ ] **One successful restore test** with witness, saved (EV-C07-05).
- [ ] Off-server backup copy running (EV-C07-07) or a signed exception with end date.
- [ ] RTO / RPO approved; business continuity plan approved; reboot test of 10.0.1.98 done (EV-C07-12, EV-C11-01, EV-C11-03).
- [ ] Log review procedure approved; first review log kept; Verify integrity run and saved (EV-C09-01 to EV-C09-03).
- [ ] Log shipper wired on 10.0.0.205 (PostgreSQL and `backup.log`); alert route to a named person tested (EV-C09-06, EV-C09-07).
- [ ] Proof that the System Log migration (160) and the log shipper task are live in production (EV-C09-05, EV-C09-12).
- [ ] Decision on HTTPS in front of the app recorded (accept with end date or fix) (EX-003).

### E. Incidents, suppliers, people
- [ ] Incident response plan approved; roster; register opened (EV-C08-01, EV-C08-02, EV-C08-04).
- [ ] One incident tabletop done and recorded (EV-C08-05).
- [ ] Supplier register built; active integrations confirmed; assurance reports requested (EV-C10-01 to EV-C10-04).
- [ ] Awareness programme approved; first round completed; acknowledgements collected (EV-C12-01 to EV-C12-04).
- [ ] Secrets inventory and rotation procedures approved; first rotation of rotatable secrets done and logged (EV-C15-01 to EV-C15-03).
- [ ] Exception register in use; every exception has an owner (SOC2-EXCEPTION-REGISTER.md).

---

## Part 3 - Recurring calendar

Times such as "first working day" refer to Indian working days; adapt as management prefers. "Reviewer" is always a different person from the performer.

### Daily (automatic or quick check)

| Task | Evidence | Owner role | Control | Notes |
|---|---|---|---|---|
| Nightly backup runs 02:30 on 10.0.0.205 and writes OK/FAILED to `backup.log` | Log line (collected monthly) | Database Administrator | C07 | Automatic; the daily action is looking at failure alerts once alerting exists (until then, a weekly look). |
| Log shipper runs every 2 minutes on 10.0.1.98; cron tasks run | Task last-run result | IT Operations Lead | C09 | Automatic; checked weekly. |
| Leaver deactivation within the target time | Deactivation log rows | IT Operations Lead | C01 | Done when an HR notice arrives. |
| Account creation only with a request | Request record | IT Operations Lead | C01 | Per event. |
| Incident logging | Incident register entry | Information Security Lead | C08 | Per event, same day. |

### Weekly

| Task | Evidence | Owner role | Control |
|---|---|---|---|
| Log review: Logs > System Log, category security and error for the last 7 days; record filters, findings, actions | Review log line (EV-C09-02) | Information Security Lead | C09 |
| Check backup log for the week (one OK line per night) | Review log line | Database Administrator | C07 |
| Check the scheduled tasks list on 10.0.1.98 (all Ready, last result 0) | Screenshot or text | IT Operations Lead | C09 |
| Update the findings tracker | Tracker | Information Security Lead | C05 |
| Review new exceptions | Exception register | Information Security Lead | All |

### Monthly (proposed: second working day, finished by the 10th)

| Task | Evidence | Owner role | Control |
|---|---|---|---|
| Export System Log audit and security rows for the month | Export file (EV-C09-04) | Application Owner | C09, C01 |
| Run **Verify integrity**; save the result | Result (EV-C09-03) | Application Owner | C09 |
| Reconcile account events to approvals and HR leaver list | Spreadsheet (EV-C01-07) | IT Operations Lead | C01 |
| Review privileged actions (role changes to admin, password sets, bulk resets) | Review note (EV-C03-06) | Information Security Lead | C03 |
| Collect `backup.log`, backup folder listing | Files (EV-C07-03, EV-C07-04) | Database Administrator | C07 |
| Run `npm audit` (all and production-only) on the current commit | JSON files (EV-C05-02) | Development Lead | C05 |
| Windows Update history for 10.0.1.98 and 10.0.0.205; version table | Exports (EV-C06-02, EV-C06-03) | IT Operations Lead | C06 |
| Read advisories for Next.js, React, PostgreSQL, Windows, Synology | Note (EV-C06-06) | Development Lead | C06 |
| Git history of main for the month and release register; reconcile with `/api/version` | Export and signed note (EV-C04-02, EV-C04-12) | Development Lead / Information Security Lead | C04 |
| Management review of findings, exceptions and incidents (30 minutes), minutes | Minutes (EV-C05-07) | Information Security Lead | C05, C08 |
| Monthly "no incidents / these incidents" statement | Signed statement (EV-C08-02) | Information Security Lead | C08 |
| Run the monthly self-test from SOC2-OPERATING-EFFECTIVENESS-TEST-PLAN.md | Self-test sheet | Compliance Coordinator | All |
| Check evidence store for gaps | Checklist | Compliance Coordinator | All |
| Report on password-reset status (users still on a temporary password) | Query result (EV-C01-08) | Database Administrator | C01 |

### Quarterly (proposed: first 10 working days of January, April, July, October)

| Task | Evidence | Owner role | Control |
|---|---|---|---|
| Access review: Users export, manager confirmations, follow-up, sign-off | EV-C02-02 to EV-C02-06 | Application Owner | C02 |
| Privileged access review and role listing from the database | EV-C03-01 to EV-C03-05 | Information Security Lead | C03 |
| Restore test: newest dump into a scratch database, witnessed | EV-C07-05 | Database Administrator | C07 |
| NAS snapshot policy and snapshot list | EV-C07-08 | IT Operations Lead | C07 |
| Backup access list; copy of script and hash | EV-C07-11, EV-C07-01 | Database Administrator | C07 |
| Test that a failed backup raises an alert | EV-C07-10 | IT Operations Lead | C07 |
| Server vulnerability scan and review | EV-C05-03 | IT Operations Lead | C05 |
| Software version inventory (servers and NAS) | EV-C06-02, EV-C06-04 | IT Operations Lead | C06 |
| Repeat the "no secrets in git" search | EV-C15-07 | Development Lead | C15 |
| Review the live auth-service settings (sign-up switch) with a witness | EV-C01-09 | IT Operations Lead | C01 |
| Screenshot Platform Settings > Retention; Windows event log, firewall and NTP samples | EV-C09-08, EV-C09-10 | IT Operations Lead | C09 |
| Test the alert route to the named person | EV-C09-07 | Information Security Lead | C09 |
| Management meeting on security (minutes) | EV-C14-04 | Executive Sponsor | C14 |
| GitHub branch protection settings snapshot | EV-C04-09 | Development Lead | C04 |
| Review of open risk acceptances (end dates) | EV-C13-06 | Executive Sponsor | C13, C05 |
| Contact and on-call roster check | EV-C08-04 | Information Security Lead | C08 |

### Annual (proposed anniversary of the first period start; some done before the period)

| Task | Evidence | Owner role | Control |
|---|---|---|---|
| Review and re-approve all policies; update the review log; communicate | EV-C14-01 to EV-C14-03 | Executive Sponsor | C14 |
| Risk assessment refresh with minutes | EV-C13-02, EV-C13-04 | Information Security Lead | C13 |
| Supplier register review, assurance reports, contracts, active integrations | EV-C10-01 to EV-C10-07 | Vendor Relationship Owner | C10 |
| Business continuity / disaster recovery test; reboot test; plan re-approval | EV-C11-01 to EV-C11-06 | Executive Sponsor / IT Operations Lead | C11 |
| Incident response exercise | EV-C08-05 | Information Security Lead | C08 |
| Security awareness round; acknowledgements | EV-C12-02 to EV-C12-04 | HR Lead | C12 |
| Independent penetration test, response and retest | EV-C16-01 to EV-C16-06 | Information Security Lead | C16 |
| Secrets rotation and key custody review | EV-C15-03, EV-C15-06 | IT Operations Lead | C15 |
| RTO / RPO confirmation | EV-C07-12 | Executive Sponsor | C07, C11 |
| System description update | EV-CG-01 | Compliance Coordinator | CG |
| Control owner roster re-approval | EV-CG-02 | Executive Sponsor | CG |

### Event-driven (any time)

| Event | Evidence | Owner role | Control |
|---|---|---|---|
| Each production release or migration | Release register entry, test output, approval, health/version results, migration output | Development Lead | C04 |
| Emergency change | Entry marked Emergency; approval within 2 working days (PROVISIONAL) | Application Owner | C04 |
| Staff leaves a privileged role | Removal and rotation records | IT Operations Lead | C03, C15 |
| New supplier or integration switched on | Supplier register update, risk note | Vendor Relationship Owner | C10, C13 |
| Significant change (HTTPS, new channel, server move) | Risk reassessment record | Information Security Lead | C13 |
| Any control missed or late | Exception register entry | Control owner | All |
| Any incident | Incident file and review | Information Security Lead | C08 |

---

## Open questions / evidence requests for management

1. Confirm the proposed approach to the examination period (start after readiness, 3-month minimum first period) as a starting point for the auditor conversation, or give your own target date.
2. Name an external auditor (independent CPA firm) or ask for help choosing; the period, scope and sample sizes are the auditor's decision.
3. Name the owners for the tasks above (all roles are placeholders), the Independent Reviewer and the Compliance Coordinator.
4. Decide the working days and times for the monthly and quarterly tasks.
5. Decide whether a dry-run month is wanted before the real period.
6. Confirm which readiness items management will fix and which it will accept as signed exceptions, so the first period is not started with known gaps that nobody has agreed to.
7. Provide any already-existing records (restore tests, reviews, training, policies, contracts) so they can be assessed; none has been supplied to the assessment so far.
