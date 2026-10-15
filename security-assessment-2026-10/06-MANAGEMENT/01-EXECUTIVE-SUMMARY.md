# 06 / 01 — Executive summary (plain language)

Date 2026-10-15 · Status: DRAFT for management review — internal assessment, **not** an audit report, certification or attestation · Production was not touched. Nothing is pushed, merged, migrated or deployed.

## The short version
1. **One thing is urgent and affects the live system today:** production runs a version of the web framework (Next.js 16.2.9) with published critical security flaws, including one that can let an outsider run code on a **Windows** server (rated 9.0 out of 10). Our server is Windows and reachable from the internet. The fixed version is already in the local code. It should be released first, on its own. (Not exploited or tested against production; rated "hard to pull off" by the publisher, but critical.)
2. We found **70 distinct weaknesses** in total. In the local copy we fixed **29** and proved most of those fixes with a real attack test (the attack worked before, is refused after). **41** are not fully closed: 6 wait for your decision, 6 are partly closed, 27 are open (21 of those are Low), and 2 could not be verified from here.
3. The most important weaknesses were not "outsiders breaking in" but **rules that only existed on the screens**: a technician or manager could still change a ticket's priority and push its deadline a year ahead by talking to the database directly; any employee could create a ticket straight in the database with a forged priority; the start of private internal notes was sent to people who must not read them; a file attached to a private note could be downloaded by the requester; every employee could read every colleague's mobile number; any employee could write on someone else's ticket by e-mail with a guessed ticket number. All of these are fixed locally and tested.
4. **Still open and needs you:** the site runs on plain HTTP (passwords and login cookies are readable on the network), and bulk-imported users start with a shared default password. These are decisions about how the company runs the system, not only code.
5. **Nothing broke.** All existing test suites pass on the final local code (1,760 + 182 + 16 tests, 0 failed; type check clean; lint 0 errors). Speed is unchanged.
6. For ISO 27001 and SOC 2 the honest answer is: the **technology is in decent shape; the management system around it is mostly missing**. No approved policies, no owners, no access reviews, no restore test, no recorded management review exist yet, so nothing can be shown as "operating" yet. We drafted what can be drafted; we did not invent any record.

## What we did
- Read the whole application and the earlier audit (75 earlier findings re-checked against today's code: 53 verified fixed, 9 still vulnerable, 7 need a decision).
- Built an isolated, disposable test copy (fake users, fake tickets, no e-mail, no WhatsApp, no route to production), certified it with a 21-point check, and ran every attack there.
- Five independent code reviews + our own attack tests + dependency and secret checks. Six scanner tools you named were **not installed** here, so they were replaced by manual checks; we did not pretend otherwise.
- Fixed confirmed problems in LOCAL only, added tests, re-ran everything.
- Drafted the ISO 27001 and SOC 2 readiness documents from facts in the repository.

## Numbers (VAPT)
| Severity | Found | Fixed locally | Not fully closed |
|---|---:|---:|---:|
| Critical | 1 | 1 | 0 |
| High | 3 | 0 | 3 (1 partly closed, 2 need your decision) |
| Medium | 34 | 18 | 16 |
| Low | 32 | 10 | 22 |
| **Total** | **70** | **29** | **41** (2 of them not verifiable from here) |
"Fixed" means fixed **in the local copy** and proven on the test copy; production has none of it until you approve a release.

## ISO 27001 and SOC 2 in one paragraph each
- **ISO 27001 (internal readiness):** of the 93 Annex A controls, 14 are designed, 16 implemented, 7 tested (on the local copy), 10 not implemented, 46 not verified (people and physical controls need organisational evidence), **0 operating with evidence**. Of the 25 management-system clauses, none is operating; most are not implemented. A certification body would very likely not recommend certification today.
- **SOC 2 (internal readiness):** Type I (design): of 38 criteria, 0 are shown as suitably designed, 33 have a design gap, 5 are not verifiable from the repository. Type II (operation): 131 pieces of evidence would be needed; 3 exist in the repository, 24 partly, 59 are not collected, 45 cannot exist until controls have run for a period. 26 of 33 control areas have no identifiable owner. No attestation is claimed; only an independent CPA firm can issue one.

## What I need from you (decisions)
HTTPS (yes / VPN-only / later), the default-password policy, whether managers may write Business Rules and approval steps, who owns global settings, whether HR/Finance tickets need a confidentiality tier, owners for the control areas, and approval to release the framework upgrade first. Details: `04-ACTION-PLAN.md`, `05-RELEASE-PREREQUISITES.md`.

## Is the local build ready for your review?
Yes for **security review**: it passes all local checks and the weaknesses we could test are fixed or listed. It is **not** a certification of production, and not ready to release without the prerequisites in `05-RELEASE-PREREQUISITES.md` (a database migration, configuration checks, a restore-tested backup).
