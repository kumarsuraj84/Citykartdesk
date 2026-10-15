# SOC 2 Operating Effectiveness Test Plan - CKDesk

Date: 2026-10-15
Status: DRAFT for management review — internal readiness assessment, not an audit report or attestation

## How to read this

In a Type II examination the auditor does not just read policies; they **test** whether each control worked during the examination period. This plan shows, for each of the 16 controls, the tests an auditor would be likely to run, how many items they might pick (the "sample"), what the full list ("population") is, what counts as pass or fail, and a **self-test** the team can run every month to find problems before the auditor does.

Important:

- **Nothing has been tested because nothing has operated.** There is no operating period yet. Today every test below would fail for lack of evidence. This plan is preparation.
- The four test methods: **Inquiry** (ask the owner and staff), **Observation** (watch the control being done), **Inspection** (read records, screens, files, settings), **Re-performance** (the auditor does the control again and compares the result).
- **Sample sizes are typical practice and PROVISIONAL.** The independent auditor sets them by their own method, the size of the population and their risk view. Do not treat the numbers as a promise or a limit.
- Pass/fail criteria are the team's own proposed standard for the self-test; the auditor may judge differently.
- Owner roles are placeholders (Owner: to be assigned by management). Control details are in SOC2-TYPE-II-CONTROL-OPERATION-PLAN.md; evidence IDs in SOC2-EVIDENCE-REGISTER.md.

## Typical sample size guidance (PROVISIONAL, auditor decides)

| How often the control runs in the period | Typical sample (commonly seen in practice) |
|---|---|
| Once a year | 1 occurrence |
| Quarterly | 2 occurrences (all, if only 1 or 2 happened) |
| Monthly | 2 to 5 occurrences |
| Weekly | 5 to 15 occurrences |
| Daily | 20 to 40 occurrences |
| Many times a day or per event (accounts, changes, tickets) | 25 to 60 items, higher for large populations, lower when the population is very small (for a very small population the auditor may test all items) |
| Any control that failed once | Larger follow-up sample; a single failure in a small sample is usually reported as an exception |

How to prepare: keep a complete **population list** for every control (all account events, all releases, all backup nights, all incidents) so the auditor can choose the sample. A population that cannot be produced is itself a finding.

## Common test rules

| Topic | Rule |
|---|---|
| Completeness of population | The population list must match the source (System Log export counts, `git log` count, `backup.log` line count). Record both numbers. |
| Timeliness | A record counts only if made at the time of the event or review, within the target set in the operation plan. |
| Independence | A control checked only by the person who performed it is a failure of the review part. |
| Evidence integrity | Evidence must be original exports or screenshots with dates, not typed summaries; edited files are not accepted. |
| Period boundary | Evidence is from inside the examination period; earlier records do not count. |
| Dry run | Records made during a dry-run month are labelled and not counted. |

---

## C01 Access provisioning and deprovisioning

- **Population:** every account created, role changed, deactivated or reactivated in the period (System Log rows `user.invited`, `user.bulk_imported`, `user.role_changed`, `user.deactivated`, `user.reactivated`), and every leaver on the HR list.
- **Auditor tests:**
  - *Inquiry:* ask the Owner and an admin how accounts are requested, approved and removed; who may grant admin.
  - *Observation:* watch a test account being invited and then deactivated in the Users screen.
  - *Inspection:* for a sample of new accounts, obtain the request and approver; for a sample of role changes, the approval; for a sample of leavers, HR notice and deactivation row; the setting that disables public sign-up; the check for accounts on the default initial password.
  - *Re-performance:* recompute days between leaving date and deactivation for the sampled leavers.
- **Sample (typical, PROVISIONAL):** 25 to 40 new accounts and role changes (or all if fewer); 25 leavers (or all if fewer); 1 sign-up setting inspection.
- **Pass:** every sampled item has an approved request dated before the account event, performed by an authorised admin, and every sampled leaver was deactivated within the target (proposed: same working day). **Fail:** any item without approval, any admin granted by someone other than a platform owner, any leaver beyond the target, any account still on the default password.
- **Monthly self-test:** (1) Export System Log rows for the month, count them, match every row to a request; (2) match HR leavers to deactivation rows and compute days; (3) run the initial-password report; (4) confirm in the log that no `admin` role was granted by a non-platform-owner. Record numbers tested and failures.

## C02 Quarterly access review

- **Population:** every quarterly review in the period (and the users included in each).
- **Auditor tests:**
  - *Inquiry:* ask the owner how the review is done and what happens to Change/Remove answers.
  - *Observation:* sit in on part of a review, or watch the export being made.
  - *Inspection:* the dated Users export; the completeness check (row count against the screen count); reviewer answers for a sample of users; the System Log rows proving the Changes/Removals were carried out; sign-off.
  - *Re-performance:* make a fresh export on a chosen date and compare with the reviewed file to find users who were not in the review.
- **Sample:** all quarterly reviews in the period (typically 2, or 1 in a 3-month period); within each, 25 to 60 users (PROVISIONAL).
- **Pass:** each review started within the target of the quarter start, covered 100% of active accounts, was signed by the line managers and the owner, and each requested change has a log row. **Fail:** missing quarter, incomplete population, missing sign-off, requested removal not done.
- **Monthly self-test:** (in months without a review) re-export users, compare with the last review file, list users added since, check each against C01 approvals. In review months: perform the completeness check and test 10 Change/Remove items against the System Log.

## C03 Privileged access review

- **Population:** all privileged holders at each review date (platform owners, admins, managers with admin-area access, SSH key holders, postgres and service-role key holders, NAS administrators) and all privileged changes in the period.
- **Auditor tests:**
  - *Inquiry:* who holds privileged access, why; how leavers lose it.
  - *Inspection:* the privileged list with justifications; the database role listing from 10.0.0.205; custody records; the sign-off by someone not on the list; System Log rows for privileged changes and their approvals.
  - *Re-performance:* run the platform-owner/admin filter on the Users screen and compare with the list; compare the role listing against the list.
- **Sample:** all quarterly reviews; all privileged changes if fewer than 25 (PROVISIONAL).
- **Pass:** list complete, each person justified, review signed by an independent person, no unexplained holder, shared-account use covered by an accepted exception with compensating controls (EX-006). **Fail:** unknown holder, missing quarter, leaver with privileged access beyond the target.
- **Monthly self-test:** filter System Log security rows for privileged changes and match each to an approval; compare the admin/platform owner count on screen with the list.

## C04 Change management with approvals

- **Population:** every production release and database migration in the period (from `git log` on main, the release register, and the build ids seen at `/api/version`).
- **Auditor tests:**
  - *Inquiry:* the developer and the approver describe the path from change to production, and the emergency path.
  - *Observation:* observe a deploy (or a test deploy to the audit stack) following the runbook steps.
  - *Inspection:* for a sample of releases: release entry, git commit, test output, recorded approval by a person other than the developer, build id, health/version result, backup before migration, rollback plan. Branch protection settings.
  - *Re-performance:* compare the production build id with the register; compare `git log` to the register to find releases with no entry.
- **Sample:** 25 to 60 changes, or all if fewer (PROVISIONAL); all emergency changes.
- **Pass:** every sampled change has a record, tests were run, approval was recorded before deploy and by a different person (or a documented compensating review), verification saved, migrations had a prior backup. **Fail:** any production build not in the register, approval after the fact outside the emergency path, approval by the developer alone, missing test or backup record.
- **Monthly self-test:** list all commits to main this month and all builds deployed; match each to a register entry and approval; fail the month if any deployed build lacks an entry.

## C05 Vulnerability scanning and remediation

- **Population:** every scan run in the period and every finding raised (npm audit results, server scans, penetration test and VAPT findings).
- **Auditor tests:**
  - *Inquiry:* how scans are scheduled, how findings are rated, how risk acceptance works.
  - *Inspection:* dated scan outputs for each month and quarter; the tracker; for a sample of findings: owner, due date, closure date, closure evidence (re-scan or exploit test output); signed risk acceptances; monthly review minutes.
  - *Re-performance:* run `npm audit --omit=dev` on the commit running in production and compare with the last saved result.
- **Sample:** all scans (monthly: 2 to 5; quarterly: 2); 25 findings or all (PROVISIONAL), weighted toward Critical and High.
- **Pass:** scans on time; every Critical/High closed within target or covered by a signed, unexpired acceptance; closure proven. **Fail:** missing scan, finding past target without acceptance, closure claimed without evidence.
- **Monthly self-test:** run the scan; list findings older than their target; check each has an acceptance or a fix; confirm the previous month's minutes exist.

## C06 Patching

- **Population:** every patch or update applied or deferred in the period (Windows Update history for both servers, NAS updates, dependency updates in git, advisories read).
- **Auditor tests:**
  - *Inquiry:* who watches advisories and applies patches.
  - *Inspection:* version inventories; update history; for a sample of critical or high advisories: date published, date applied, change record; approved exceptions for deferrals.
  - *Re-performance:* check current versions against the last inventory and against vendor advisories.
- **Sample:** 2 to 5 monthly inventories; 25 patches or all (PROVISIONAL); all deferrals.
- **Pass:** critical patches applied within target (proposed 14 days), others by the monthly cycle, each with a change record. **Fail:** an inventory missing, a critical patch past target without an approved exception.
- **Monthly self-test:** take the version table, compare with advisories, list anything overdue.

## C07 Backups and restore tests

- **Population:** every nightly backup job in the period (one per night in `backup.log`), every restore test, every failed backup.
- **Auditor tests:**
  - *Inquiry:* the Database Administrator explains schedule, retention, second copy, restore.
  - *Observation:* watch a restore into a scratch database following runbook section 6; watch the task list on 10.0.0.205.
  - *Inspection:* the deployed script (and hash), task export, `backup.log` for a sample of nights, folder listing showing 30 days, restore test record, off-server copy log, NAS snapshot policy, failed-backup records and follow-up, ACL on the backup folder.
  - *Re-performance:* auditor picks a backup file and restores it; compares row counts.
- **Sample:** 20 to 40 nights (PROVISIONAL); all restore tests (at least 1 per quarter expected); all failures.
- **Pass:** a successful OK line for every sampled night (or a recorded failure with a same-day manual backup); at least one successful witnessed restore test per quarter with a time and result; a second copy exists. **Fail:** gaps, no restore test, no off-server copy (currently EX-001, EX-002), restore failed and not fixed.
- **Monthly self-test:** count OK lines against the number of nights; check the listing for 30 days of files; confirm the quarterly restore test is booked; check the second-copy log once it exists.

## C08 Incident response

- **Population:** every security incident in the period (register entries; a register with no entries is a valid population of zero) plus all System Log security alerts that could have been incidents.
- **Auditor tests:**
  - *Inquiry:* staff describe how they would report and handle an incident.
  - *Inspection:* approved plan; roster; register and monthly statements; per-incident files; post-incident reviews; the exercise record; the log extract used for the monthly review.
  - *Re-performance:* the auditor looks at System Log security rows for the period and asks what was done about unusual ones.
- **Sample:** all incidents (up to 25); all monthly statements (2 to 5 in the period); the annual exercise.
- **Pass:** every incident logged, rated, handled, closed and reviewed on time; monthly statements exist; unusual log rows have an explanation. **Fail:** unexplained security rows, unlogged incident, no statement.
- **Monthly self-test:** review security rows (failed sign-ins, blocked logins, invalid signatures, CSP floods); for each unusual one either explain it in writing or open an incident; sign the statement.

## C09 Security monitoring and log review

- **Population:** every scheduled log review (weekly), every integrity check (monthly), and the days of the period for which logs should exist.
- **Auditor tests:**
  - *Inquiry:* who reviews, what they look for, what makes them act.
  - *Observation:* watch a review on the Logs screen including a Verify integrity run.
  - *Inspection:* review log entries for sampled weeks; integrity results; exports; shipper task registration; retention settings screenshot; alert test; proof of the System Log in production (schema migration row).
  - *Re-performance:* auditor runs the same filters for a sampled week and compares to what the reviewer wrote down; runs Verify integrity.
- **Sample:** 5 to 15 weekly reviews and 2 to 5 monthly checks (PROVISIONAL).
- **Pass:** each sampled week has a dated, signed review with findings and actions; integrity passes; shipper ran; alerts reach a person. **Fail:** missed weeks, integrity failure not treated as an incident, no alert route (currently EX-009).
- **Monthly self-test:** count weekly reviews recorded (4 or 5 expected), run Verify integrity, confirm shipper task last run, check the log has rows for every day of the month.

## C10 Vendor reviews

- **Population:** all suppliers on the register that hold or touch CKDesk data.
- **Auditor tests:**
  - *Inquiry:* how suppliers are chosen and reviewed.
  - *Inspection:* register; per-supplier assessment, contract/data terms, latest assurance report and reviewer notes; the dated list of active integrations.
  - *Re-performance:* compare the integrations active in production (screens/settings) with the register.
- **Sample:** all critical suppliers, or up to 25 (PROVISIONAL).
- **Pass:** each critical supplier reviewed within the last 12 months with a documented conclusion and evidence it was reviewed in the period. **Fail:** an active integration not on the register; no assurance report review; a report older than the allowed age without a decision.
- **Monthly self-test:** compare Platform Settings / Intake Channels / DeskTime status with the register; list renewals and reports due in 90 days.

## C11 Business continuity test

- **Population:** each continuity test or exercise in the period (annual, so usually 1) and the reboot test.
- **Auditor tests:**
  - *Inquiry:* who would act in an outage; the targets.
  - *Inspection:* approved plan with RTO/RPO; test record with times; follow-up actions; acceptance of single points of failure.
  - *Re-performance:* compare measured restore time with the RTO.
- **Sample:** 1 annual test; reboot test record.
- **Pass:** test performed in the period (or just before, if the auditor agrees), within RTO/RPO or with a closed action list. **Fail:** no test, test failed with no actions.
- **Monthly self-test:** check that the test is booked; check that actions from the last test are closed; confirm the plan is the current version.

## C12 Security awareness

- **Population:** every person who needs training (all account holders and all with technician, manager, admin or platform-owner roles; the developer; joiners in the period).
- **Auditor tests:**
  - *Inquiry:* HR describes the programme.
  - *Inspection:* content; completion records; acknowledgements; joiner records; reconciliation to the Users export.
  - *Re-performance:* compare the Users export with the completion list.
- **Sample:** 25 to 60 people with extra weight on privileged roles and joiners (PROVISIONAL).
- **Pass:** every sampled person completed training within the required time (proposed: 30 days for joiners, annual for all) and acknowledged the statement. **Fail:** any privileged person untrained.
- **Monthly self-test:** list joiners of the month and check training and acknowledgement; list overdue annual training.

## C13 Risk assessment refresh

- **Population:** each annual refresh and each significant change in the period.
- **Auditor tests:**
  - *Inquiry:* how risks are identified and who decides.
  - *Inspection:* method; register; minutes with attendees; acceptances; reassessment notes for significant changes.
  - *Re-performance:* test one risk end to end from identification to treatment.
- **Sample:** 1 annual refresh; all significant changes (up to 25).
- **Pass:** refresh done within 12 months, signed by management, covers the current systems, suppliers and the VAPT findings; each significant change has a note. **Fail:** register out of date or missing known risks (for example the open items in the exception register).
- **Monthly self-test:** compare the exception register and finding tracker with the risk register; add anything missing.

## C14 Policy review

- **Population:** every policy in the set.
- **Auditor tests:**
  - *Inquiry:* management explains how policies are decided and communicated.
  - *Inspection:* each policy's version, owner, approval and review dates; review log; communication evidence; management meeting minutes.
  - *Re-performance:* check that real practice matches a sampled policy statement (for example stated retention against what the system enforces).
- **Sample:** all policies up to 25 (PROVISIONAL).
- **Pass:** each policy approved, in date and communicated; practice matches. **Fail:** unapproved or out-of-date policy; policy not followed (for example the retention policies table not enforced, EX-020).
- **Monthly self-test:** list policies due for review within 60 days; sample one policy statement and test it against practice.

## C15 Key and secret rotation

- **Population:** every secret in the inventory, every rotation in the period, every leaver who knew a secret.
- **Auditor tests:**
  - *Inquiry:* who holds which secret; rotation habits.
  - *Inspection:* inventory with intervals; rotation log; verification records; custody records; the repeated "no secrets in git" search.
  - *Re-performance:* compare dates of last rotation with intervals; witness a rotation on the audit stack.
- **Sample:** all secrets with a due date in the period, or 25 (PROVISIONAL); all leaver-triggered rotations.
- **Pass:** each rotatable secret rotated within its interval and after any leaver who knew it, with a record; no secret in git. **Fail:** a secret past its interval without exception (currently the 10-year keys, EX-014), a leaver with unrotated access.
- **Monthly self-test:** list secrets due in the next 60 days; check leavers of the month against secrets they knew.

## C16 Penetration test

- **Population:** each penetration test (external) in the period and the internal VAPT runs.
- **Auditor tests:**
  - *Inquiry:* scope, tester independence, how results are handled.
  - *Inspection:* engagement letter, tester qualifications, report, management response, tracker entries, retest report.
  - *Re-performance:* re-run the VAPT regression suite on the isolated audit stack for a sample of fixed issues.
- **Sample:** the most recent test; all Critical/High findings.
- **Pass:** independent test within 12 months; all Critical/High fixed and retested or formally accepted. **Fail:** no independent test; Critical or High open without acceptance (EX-012 is Critical today).
- **Monthly self-test:** re-run the VAPT suite on the audit stack after relevant changes; compare with the status table; confirm test booking.

---

## Self-test sheet (use the same layout each month)

| Field | Content |
|---|---|
| Month tested | The real month; do not pre-fill |
| Control | C01 to C16 |
| Tester and reviewer | Two different people |
| Population size | Number from the source system |
| Items tested | Number |
| Failures | Number and IDs |
| Exceptions raised | EX-nnn |
| Evidence saved | File names |
| Signed | Date of real signing |

## Open questions / evidence requests for management

1. Name the person who will run the monthly self-test and the independent reviewer who signs it.
2. Tell the assessment whether an auditor has been chosen and what sample method they use; the numbers in this plan will be replaced by theirs.
3. Confirm the pass targets (for example same-day leaver removal, 14-day critical patches, 30-day joiner training); they are proposals.
4. Provide the first population lists you can produce (HR leavers, releases since 2026-10-15, user list) so the self-test can be dry-run.
5. Confirm whether the monthly self-test results may be shown to the auditor as management's own monitoring evidence.
