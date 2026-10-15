# 06 / 03 — Compliance readiness dashboard (counts from the documents; no percentage scores)

Status: internal readiness assessment, not an audit or attestation. Evidence classes: A local test, B repository, C organisational (none supplied), D documentation only, E missing.

## A. VAPT status
| Severity | Found | Fixed locally | Not fully closed |
|---|---:|---:|---:|
| Critical | 1 | 1 | 0 |
| High | 3 | 0 | 3 |
| Medium | 34 | 18 | 16 |
| Low | 32 | 10 | 22 |
| Total | 70 | 29 | 41 |
Not fully closed = 6 partly fixed + 27 open + 6 need a decision + 2 not verifiable here. **Unverified findings: 2** (live self-sign-up setting; 10–25 MB upload fix). Tools not available: Semgrep, Gitleaks, OSV-Scanner, ZAP, Nuclei, Burp.
**Verdict: VAPT — PASS WITH CONDITIONS** (all testable Critical fixed locally; High items open or awaiting decisions; nothing deployed).

## B. ISO/IEC 27001:2022 readiness (`03-ISO27001/`)
| Item | Count |
|---|---|
| Management-system clauses assessed (4.1–10.2, 25 rows) | 25: 15 not implemented, 6 not verified, 3 designed in part, 1 mixed; 0 operating with evidence |
| Annex A controls | 93 (84 applicable to the CKDesk scope, 9 organisation-level, 0 excluded) |
| Controls implemented / tested with local evidence | 16 implemented, 7 tested (local copy only) |
| Controls designed only | 14 |
| Controls missing | 10 not implemented |
| Controls not verified | 46 (all 8 people controls and all 14 physical controls need organisational evidence) |
| Operating with evidence | **0** |
| Policies | 20 expected; draft outlines written, none approved; 6 have partial written material, 2 exist only as code, 12 nothing |
| Risks | 49 assessed, 28 above the treatment threshold (plans drafted) |
Major gaps: no approved scope/policy/risk method, no named roles, no internal audit, no management review, no access reviews, no tested backup restore, no off-server backup, no CI, single-developer change control, plain HTTP.
**Verdict: ISO 27001 — GAPS REMAIN** (internal readiness assessed).

## C. SOC 2 readiness (`04-SOC2/`)
| Item | Count |
|---|---|
| Categories proposed | Security IN; Confidentiality IN; Availability IN only if management states a commitment (none written); Processing Integrity and Privacy OUT for now (reasoned) |
| Type I criteria assessed | 38: 0 suitably designed, 33 design gap, 5 not verified |
| Type I gaps | 36 (1 critical, 17 high, 16 medium, 1 low, 1 info) |
| Type II evidence items needed | 131: 3 exist, 24 partly exist, 59 not collected, 45 cannot exist yet |
| Known exceptions recorded | 28 (all dated 2026-10-15) |
| Control areas without an identifiable owner | 26 of 33 (7 have an unnamed day-to-day role; 0 named) |
**Verdicts: SOC 2 Type I — GAPS REMAIN · SOC 2 Type II — GAPS REMAIN** (evidence readiness planned; no attestation claimed; first period to be agreed with an external auditor, a minimum of about 3 months is typical).
