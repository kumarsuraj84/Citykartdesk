# Local demo of the sheet masters and the engineer visit module

Runs ONLY on this computer, against the isolated test database (never the real system). E-mail cannot leave: it is switched off here, so the "sent to the OEM"
messages are shown in the ticket conversation instead.

Start: preview configuration `citykart-desk-demo` (port 3310), or `powershell -File audit-2026-10\demo\start-demo.ps1`.
Data: `node audit-2026-10/demo/seed-demo.mjs` (safe to run again). Sample sheets: `audit-2026-10/demo/sheets/*.csv` (edit them and press "Update from sheets now").

Open http://localhost:3310 and sign in. Every demo login has the same password: `Demo-Desk-Pw-2026!`

| Who | E-mail | What to try |
|---|---|---|
| Administrator | admin.demo@audit.test | Admin > Sheet Masters: "Update from sheets now", the counts, the health list, the three mail templates |
| ALC store | alc.demo@audit.test | New request (AC and Facilities Repair): the AC choices are ALC's Active ACs only; AC visits page: today's visit code |
| MAR store | mar.demo@audit.test | Same, with its own 5 ACs |
| Technician | tech.demo@audit.test | AC visit reports: reports, Parts to order (PO form), a store's visit code |
| CVM | vishal.kumar@audit.test | Receives the approval for the Fixture category |
| Engineer (no login) | none | http://localhost:3310/engineer with the store code and the store's visit code |
