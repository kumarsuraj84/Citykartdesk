# 06 / 02 — Risk heatmap (assessor's proposal; management to confirm scores)

Scale: likelihood 1–5 × impact 1–5 (method and full register in `03-ISO27001/ISO27001-RISK-ASSESSMENT.md`: 49 risks — 1 Critical, 27 High, 21 Medium, scored for **production as it runs today**, i.e. without the local fixes). The grid places the most important risks by ID; "after local fixes" shows where they would sit if the fixes were released.

| Impact ↓ / Likelihood → | 1 Rare | 2 Unlikely | 3 Possible | 4 Likely | 5 Almost certain |
|---|---|---|---|---|---|
| **5 Severe** | | | Framework remote-code-execution → after upgrade: moves to 1–2 | Plain HTTP exposes passwords/cookies | |
| **4 Major** | | | Default shared password; no restore test / no off-server backup copy | Technician/manager tampering with deadlines (partly closed) | |
| **3 Moderate** | | Manager-written Business Rules change priority/status (decision) | Forged e-mail replies (VAPT, fixed locally); log flooding (fixed locally) | Missing management system: owners, policies, evidence | |
| **2 Minor** | | | Low-severity items (21 open Low findings) | | |

Reading it:
- Top-left to bottom-right = more serious. The two cells that matter most today are the **framework flaw** (fix is ready, release it first) and **plain HTTP** (needs a decision).
- After releasing the local fixes and the framework upgrade, the Critical drops out; the remaining High items are HTTP, the default password and the unfinished part of the priority/SLA protection.
- The compliance gaps (no owners, policies, restore test) score high not because they are likely to cause an incident tomorrow, but because without them nobody can **prove** the controls work.
