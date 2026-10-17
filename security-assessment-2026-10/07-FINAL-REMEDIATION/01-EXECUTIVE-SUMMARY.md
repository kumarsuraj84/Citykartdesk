# 01 — Executive summary (final remediation, 2026-10-17)

LOCAL ONLY. Nothing has been pushed, merged or deployed. No test or dummy data was added to the live system; the live system was only **read** (app server settings and, by the owner's own hands, a read-only database script). Plain language is used on purpose.

## The short version

- **70 security findings** were reported on 2026-10-15. **62 are fixed and proven by tests, 2 are partly fixed, 6 wait for a management decision, none is open or unverified.**
- **Final status: CONDITIONAL.** The code, the database changes and the rollbacks are ready for a controlled release review. A few things must happen on the live servers first (a backup you can restore, one temporary setting, a plan for 463 accounts, your written approval). HTTPS is parked by your decision and stays listed as the one High item still open as a decision.
- **Safe for requesters and technicians?** The release is designed to be: the new application is deployed first and was proven to work on today's database layout (1,820 of 1,820 tests); the database changes come second, one at a time, each with a tested exact undo; nothing is removed from any screen; and nothing synthetic is put on live.

## What changed for the people using the system

| Before | After |
|---|---|
| Any logged-in person who knew how could change tickets, approvers, settings or priorities by talking to the database directly | Only the server can write those; it checks the rules first |
| Requesters could see internal notes, staff lists and other people's names | They see only their own tickets, themselves, their manager and people on their tickets |
| A shared default password for bulk-imported accounts | A random one-time password or an invitation, and the first password must be changed (the database enforces it) |
| Double-click on Submit made two tickets | One ticket |
| Anyone could try passwords or approval codes quickly | Guesses are slowed and locked out |
| Mail, WhatsApp and webhook messages could be faked or replayed | Faked or repeated ones are refused |
| Dangerous Office files with macros were accepted | Refused |
| Re-classifying a ticket needed no reason | A written reason (10–500 characters) is required |
| 9 serious weaknesses in the web framework (Next.js 16.2.9) | Fixed by upgrading to 16.3.8 (a separate release branch) |

## Numbers

| Item | Result |
|---|---|
| Findings (70) | 62 Fixed · 2 Partially Fixed · 6 Requires Decision · 0 Open · 0 Not Verified |
| By original severity | Critical 1 (fixed) · High 3 (2 fixed, 1 awaiting decision: HTTPS) · Medium 34 (30 fixed, 4 awaiting decision) · Low 32 (29 fixed, 2 partly fixed, 1 awaiting decision) |
| New items found by this work | 10 (1 High-for-release found and fixed before release: live database rights broader than expected → migration 171) |
| Automated tests on the final code | Default 1,820 passed · Remediation 184/184 · VAPT 130/130 · 0 failures; also all green on the database laid out like production's real starting point |
| Migrations | 164 → 171 (8), each with an exact rollback; proven forward / back / forward from the normal start **and** from the live starting rights |
| Performance (100,255 tickets, local) | reads 2–26 ms, writes up to ~3,100 per second, System Log chain intact after 18,000 concurrent appends; no errors. 500,000-ticket run skipped by the owner |
| Browser walkthrough (phone layout, final build) | requester, technician, administrator: 21 checks passed; no application defects |
| Scanners | Semgrep, Gitleaks, OSV-Scanner, Nuclei ran (details and gaps in `04-…`); **OWASP ZAP did not run** |

## What is still open (and why it is not hidden)

| Item | State | Who decides / acts |
|---|---|---|
| HTTPS (VAPT-002, High) | parked on 2026-10-17 ("we will make it HTTPS later") — passwords cross the network in clear text until then | owner + infra |
| Six policy questions (VAPT-007, 008, 009, 010, 053; plus 052 partly) | built, default = today's behaviour | owner (`09-…`) |
| Malware scanner for uploads (VAPT-065, partly) | connector built, **no scanner installed** — files are not virus-scanned | IT head |
| ISO 27001 / SOC 2 | readiness drafts only; organisation evidence (policies, access reviews, restore test, incident exercise) does not exist yet; **no certification is claimed** | management |
| Old shared import password on live accounts | count not yet obtained (first query failed; corrected command given) | owner runs it on the DB server |
| 463 live accounts with a pending first-password change | will be blocked from everything except changing the password after migration 168 | tell the store teams or reset first |
| 500,000-ticket performance run, ZAP, a real malware scanner, real mail/WhatsApp accounts | not done | owner decision / future |

## Recommended order of release (details in `10-…`)

1. Pre-flight (read-only): backup and a restore test; rerun the read-only rights check; decide about the 463 accounts.
2. Deploy the new application with the temporary secrets switch on (no change for users); watch a normal working day.
3. Apply migrations 164 → 171 one at a time in a quiet window; restart the REST service after each; read-only checks; watch real work.
4. Later and separately: HTTPS, per-purpose secrets, scanner, the six decisions.

The release starts only after your written go-ahead for each step.
