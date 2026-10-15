# 06 / 04 — Action plan (proposed order; owners are roles for management to assign)

| # | Action | Why | Owner role (tba) | Effort | When |
|---|---|---|---|---|---|
| 1 | Release the Next.js upgrade to production (framework-only release) | critical published flaws incl. Windows remote-code-execution; production is internet-reachable | Project owner / release manager | S | this week, after your OK |
| 2 | Check the live login service: self sign-up disabled, minimum password length ≥ 8 (read-only look at the service settings) | one unverified setting decides whether a stranger can create an account | Database/infra owner | S | this week |
| 3 | Check whether any live account still has the shared default import password; reset those | known password in source code | User admin | S | this week |
| 4 | Take a backup and do one real **restore test** on a spare machine; keep the record | no restore test is on record (ISO A.8.13, SOC 2 A1.2/A1.3 evidence) | Infra owner | M | within 30 days |
| 5 | Release the rest of the hardening (migration 164 + code) following `05-RELEASE-PREREQUISITES.md` | closes the confirmed integrity and confidentiality holes | Project owner + DBA | M | after #1–#4 and your approval |
| 6 | Decide and set up HTTPS (certificate + reverse proxy, or VPN-only access) | passwords and login cookies are readable on the network | Infra owner + management | M–L | decision now; delivery 30–60 days |
| 7 | Set dedicated secrets and `TRUSTED_PROXY_HOPS` in production | per-address sign-in limit and secret separation | Infra owner | S | with #5 |
| 8 | Decide the default-password policy (random one-time passwords or invitations) and build it | removes the shared password for good | Management + developer | M | 30 days |
| 9 | Decide manager powers: Business Rules, workflow steps, global settings, and the confidentiality tier for HR/Finance tickets (D-005) | decides what the remaining database policy changes should be | Management | decision | 30 days |
| 10 | Server-only writes for ticket columns (assignee, description, form answers, timestamps) | finishes the "priority/SLA by hand" protection | Developer | M–L | 60–90 days |
| 11 | Close the remaining Medium items (approval side doors, project/task policies, org tests on policies) | listed in `04-REMAINING-TECHNICAL-RISKS.md` | Developer | M | 60–90 days |
| 12 | Name owners for the 33 control areas and give management the evidence requests in the ISO/SOC 2 files | 26 control areas have no identifiable owner; no organisational evidence exists | Management | M | 30 days |
| 13 | Write and approve the core policies (the register lists 20; start with information security, access control, backup/recovery, incident response, change management) | ISO clauses 5.2 and Annex A need approved policies; drafts are provided | Management | M | 60 days |
| 14 | Start collecting evidence now: monthly access review, change log with approvals, backup and restore records, vulnerability scan + fix records, System Log review notes | needed for any SOC 2 Type II period (minimum about 3 months, to be agreed with the auditor) | Control owners | ongoing | start next month |
| 15 | Add a basic automated check on every change (tests + lint + dependency audit) and a second reviewer for deployments | no CI exists; one person approves everything | Developer + management | M | 60 days |
| 16 | Appoint an independent reviewer for a first internal audit; consider an external penetration test after the release | the developer must not audit their own work; this assessment is internal | Management | M | 90 days |
