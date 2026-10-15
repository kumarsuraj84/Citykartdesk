# 02 — Automated Assessment (VAPT of Citykart Desk, CKDesk)

Date: 2026-10-15
Status: DRAFT for management review — internal readiness assessment, not an audit report or attestation

## How to read this

This file says which automated tools were used on CKDesk, which were not available, what was done in their place, and what the dependency check found before and after the framework upgrade. It also says, in plain words, which of the published Next.js problems actually apply to this application.

One rule governs the file: **no scanner result is invented.** Six well-known scanners (Semgrep, Gitleaks, OSV-Scanner, OWASP ZAP, Nuclei, Burp Suite) are not installed on the assessment PC and were not run. Nothing in this file is presented as their output. Where a search was done by hand instead, it is described as a hand search with its patterns.

Evidence classes: **A** verified LOCAL technical evidence; **B** repository evidence; **E** not verified. Nothing from this assessment is deployed. Production runs build `20261015-145217` (main `717e5c6`), which still has Next.js 16.2.9.

---

## 1. Tool availability

Checked on 2026-10-15 on the assessment PC (Windows, Node v24.14.0).

| Tool | Available? | How it was used | Result recorded |
|---|---|---|---|
| `npm audit` | yes | `npm audit --json` (all dependencies) and `--omit=dev` (production dependencies), run earlier on 2026-10-15 at 15:42; saved as `vapt-2026-10/work/npm-audit.json` and `npm-audit-prod.json` | section 3 |
| `tsc` (TypeScript compiler) | yes (`node_modules/.bin/tsc`) | type check of the whole project; also runs inside `next build` | status table: "tsc/lint/unit/build OK" after the upgrade (lead tester's statement; I did not re-run it) |
| ESLint | yes (`node_modules/.bin/eslint`) | `npm run lint` over `app lib components types proxy.ts` | earlier recorded baseline of 6 lint findings (from `audit-2026-10/AUDIT-STATE.md`, quoted in the control inventory); no new run is saved in the files I was given |
| Vitest | yes (`node_modules/.bin/vitest`) | unit, integration, remediation and the new `tests/vapt` suites against the isolated audit stack | section 5 |
| Next.js production build | yes | audit build with Next.js 16.3.8 (webpack), saved as `02-VAPT/work/audit-build.log`: "Compiled successfully", TypeScript finished, 68 static-page slots generated | built and started on 127.0.0.1:3310 |
| Semgrep | **no** | not installed | **Not Verified** |
| Gitleaks | **no** | not installed | **Not Verified** |
| OSV-Scanner | **no** | not installed | **Not Verified** |
| OWASP ZAP | **no** | not installed | **Not Verified** |
| Nuclei | **no** | not installed | **Not Verified** |
| Burp Suite | **no** | not installed | **Not Verified** |

I confirmed the six missing tools by looking for them on the PC's command path and in `node_modules/.bin`; none was found.

### What was done instead

| Missing tool | Replacement | Honest limit |
|---|---|---|
| Semgrep (code patterns) | six source reviews by reading the code: ticket actions, admin and report actions, API/proxy/auth, database/RLS, uploads/e-mail/WhatsApp (`vapt-2026-10/work/review-*.md`), plus targeted searches (for example every use of `dangerouslySetInnerHTML`, `innerHTML`, `.rpc(`, `fetch(`, `createAdminClient`) | a person reading code finds different things from a rule engine; a rule scan would still be worth doing |
| Gitleaks (secrets) | hand search of tracked files, section 2 below | patterns were few and simple; history of old commits was not searched |
| OSV-Scanner (dependencies) | `npm audit` (uses the npm advisory database only) | OSV covers more sources; the npm result is one view |
| ZAP, Nuclei, Burp (web scanning) | targeted HTTP probes by hand against the audit app on 127.0.0.1:3310 (file 03, section 3) and white-box tests with Vitest | no crawler, no fuzzing, no automated injection tests, no scan of the real production URL (not allowed) |

---

## 2. Secret and pattern searches of tracked files (a hand search, not Gitleaks)

Run on 2026-10-15 with `git grep` over files tracked by git (read-only). `.env*` files were not read. Untracked developer dumps (`local_data_dump.sql` and similar) are git-ignored and were not opened.

| Search | Result |
|---|---|
| Private keys (`BEGIN ... PRIVATE KEY`) | none |
| Amazon access key shape (`AKIA...`) | none |
| GitHub token shapes (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`) | none |
| Slack token shape (`xox...`) | none |
| Google API key shape (`AIza...`) | none |
| Language-model / mail API key shapes (`sk-`, `gsk_`, `re_` followed by long text) | none |
| JWT-shaped text (three dot-separated base64 parts starting `eyJ`) | one file: `tests/unit/syslog-shape.test.ts`. It is a made-up token used to test that the log redaction hides tokens (its payload holds one claim and its signature is 14 characters). It is not a working token. Value not repeated here |
| Assignments of a literal to names like `password`, `secret`, `api_key`, `token` in `app`, `lib`, `components`, `api/src`, `scripts`, `deploy`, `proxy.ts`, `instrumentation.ts` | no real credential found |
| Tracked environment files | only `.env.example` (names, no values) and the three deploy templates `deploy/windows/config/*.example` (`app.env.local`, `auth.env`, `postgrest.conf`, `storage.env`). Earlier reviewers read them. This author did not open or print any `.env*` file; the whole-repository pattern searches above also scan `.env.example` and reported only file names, and no pattern matched it |
| **Hard-coded default password** | **one constant found**: `DEFAULT_BULK_PASSWORD` in `lib/actions/admin/users.ts` (line 542 in the working tree), used when a bulk-import row has no password (line 719). It is also written in one old audit document. This is finding VA-API-02 / VA-ADM-02 (see file 04). The value is not repeated in this report |
| Development seed file `supabase/seed.sql` | creates one local owner account with a fixed development password (control inventory, class B; `docs/WINDOWS-DEPLOYMENT.md` says it must be changed on a real deployment). Whether it was changed in production is not known from the repository — management to confirm |
| Deploy scripts that need a database password | the migration scripts under `supabase/production/` read it from a prompt into `PGPASSWORD` and remove it afterwards; no password is stored in them |

Summary: **no key-shaped secrets or private keys in tracked files; one hard-coded default password constant (and one development seed password).** Class B. This does not prove that no secret ever existed in an old commit.

---

## 3. Dependency results with `npm audit`

Source files: `vapt-2026-10/work/npm-audit.json` (all 1,050 packages: 291 production, 722 development, 149 optional) and `npm-audit-prod.json` (production only). Both were produced on 2026-10-15 at 15:42, **before** the upgrade.

### 3.1 BEFORE the upgrade (Next.js 16.2.9)

| Scope | Total | Critical | High | Moderate | Low |
|---|---|---|---|---|---|
| All dependencies | 31 | 4 | 17 | 9 | 1 |
| **Production dependencies** | **9** | **1** | **5** | **3** | 0 |

The nine production findings (1 critical + 5 high + 3 moderate; package, severity, note):

| Package | Severity | Note |
|---|---|---|
| `next` | **critical** | direct dependency; version range affected `9.3.4-canary.0` to `16.3.7`; the file lists 17 separate advisories (section 3.3) |
| `sharp` | high | image library used by Next.js's image optimizer; 3 advisories on bundled image libraries (libvips, libheif, librsvg) |
| `postcss` (inside `next`) | high | 4 advisories on source-map handling; relevant at build time |
| `ip-address` | high | 7 advisories on address parsing |
| `brace-expansion` | high | 9 advisories on denial of service in pattern expansion |
| `source-map-js` | high | 1 advisory, event-loop denial of service |
| `exceljs` | moderate | direct dependency; carries the next item |
| `uuid` (inside `exceljs`) | moderate | missing bounds check when a caller supplies a buffer (GHSA-w5hq-g745-h8pq) |
| `baseline-browser-mapping` | moderate | a build-time helper that can be made to stop on invalid input (GHSA-w5vr-8v7q-w6rv); fix available without a breaking change |

For the development-only side, the full-scope file also lists, among the 31: `vitest` and `tinypool` (critical), `proxy-addr` (critical), and several high items in `shadcn`, `braces`, `micromatch`, `fast-glob`, `eslint-config-next`, `browserslist`, `js-yaml`, `fast-uri`, `ts-morph`, `@modelcontextprotocol/sdk`. These sit in tools that run on the developer PC, not on the production server.

### 3.2 AFTER the upgrade (Next.js 16.3.8) — class A for the statement, from the status table

The upgrade moved `next` and `eslint-config-next` from 16.2.9 to **16.3.8** (`package.json` in the working tree; uncommitted) and ran `npm audit fix`.

| Scope | Result after |
|---|---|
| Production dependencies | **2 moderate left** (`exceljs` and `uuid` inside it). Critical 1 → 0. High 5 → 0 |
| Why two remain | the only offered fix is a **breaking downgrade of `exceljs`** to version 3.4.0. The vulnerable behaviour is `uuid` versions 3, 5 or 6 being called with a caller-supplied buffer. The application does not make that call. Decision recorded as "Open (accepted)" |
| All dependencies (development tools included) | **not recorded** in the files given to me. The development-only criticals above (`vitest`, `tinypool`, `proxy-addr`) were not reported as fixed. Treat them as still open until a new full `npm audit` is saved |
| Build and tests after the upgrade | the audit app was rebuilt with Next.js 16.3.8 (`audit-build.log`); the lead tester's table records "tsc/lint/unit/build OK" |

I did not re-run `npm audit` for this report (it contacts the npm registry, a network host the brief does not allow). The AFTER numbers are the lead tester's, from `05-REMEDIATION/00-FINDING-STATUS-TABLE.md`.

**Production is not fixed yet.** The framework upgrade exists only in the local working tree and is not committed. Production runs 16.2.9, so every Next.js item below that "applies" still applies to the live server today.

### 3.3 The Next.js advisories: which apply to this application?

The audit file lists 17 advisory entries for `next` (3 critical, 5 high, 8 moderate, 1 low). The status table says 16; counting the entries in the file gives 17, and the extra one is the low item about the development server (GHSA-39w2-rjm5-chcv), which cannot happen on a production build. I used the file's count.

Plain-language reading. "Applies" means the condition the advisory needs is true for our setup, using what the repository shows (class B) and the HTTP probes (class A).

| Advisory | Severity | What it is, in plain words | Does it apply here? | Why |
|---|---|---|---|---|
| **GHSA-p293-qw3h-jr36** (CVSS 9.0; fixed in 16.3.3) | **critical** | a stranger with no login can run commands on a server that runs Next.js on **Windows** | **Yes — applies** | production is a Windows Server host reachable from the internet through the port forward. Nothing in the app blocks it. Fixed by the upgrade, which is not deployed. I did not try to exploit it |
| **GHSA-2xp9-vwfh-vxw4** (fixed in 16.3.3) | **critical** | a stranger can run commands through the image optimizer when AVIF pictures are used | **Not as configured** | AVIF is not enabled; the HTTP probe showed the optimizer serves only webp and png. Still removed by the upgrade |
| **GHSA-vcvr-r3jv-pc5j** (fixed in 16.3.6) | **critical** | command execution through the `next/og` picture-generation feature | **Not as configured** | the code does not import `next/og` or `ImageResponse` (searched `app`, `lib`, `components`; none found) |
| GHSA-cjq9-62q9-8jv4 (fixed in 16.3.8) | high | the image optimizer can be made to fetch addresses chosen by the caller (SSRF) | **Not as configured** | HTTP probe: remote image URLs are refused with 400. `images.remotePatterns` is not set |
| GHSA-p9j2-gv94-2wf4 | high | SSRF through `rewrites` with an attacker-chosen host | **No** | `next.config.ts` defines no rewrites |
| GHSA-89xv-2m56-2m9x | high | SSRF in Server Actions on **custom servers** | **Probably not** | the app uses Next's own standalone `server.js`, not a hand-written server around it. Not tested |
| GHSA-6gpp-xcg3-4w24 | high | the proxy (middleware) check can be bypassed on **Turbopack** builds with a single locale | **No** | production and audit builds use webpack; no locale setup |
| GHSA-m99w-x7hq-7vfj | high | denial of service through Server Actions | **Yes — applies** | the app uses Server Actions heavily; fixed in 16.2.11 and later |
| GHSA-4c39-4ccg-62r3 | moderate | unbounded Server Action payload on the **Edge** runtime | **No** | no route sets the Edge runtime (searched) |
| GHSA-q8wf-6r8g-63ch | moderate | denial of service in the image optimizer with SVGs | **Not as configured** | optimizer serves only webp/png (probe) |
| GHSA-955p-x3mx-jcvp | moderate | internal Server Function endpoints can be disclosed to anyone | **Yes — applies** | Server Actions are in use. Fixed by the upgrade |
| GHSA-68g3-v927-f742, GHSA-4633-3j49-mh5q | moderate | cache confusion of response bodies for requests with bodies | **Low relevance** | pages are rendered per user on demand (the build lists two static pages: the not-found page and `/trial-expired`); no shared page cache is used for signed-in pages |
| GHSA-4jqv-mc3x-m676, GHSA-mcj8-r9mp-w47p | moderate | cache poisoning of statically generated or incrementally regenerated pages | **Low relevance** | as above: the app does not use incremental static regeneration; only the two static pages exist |
| GHSA-f87g-xv8r-7p7x | moderate | information disclosure in metadata image routes | **Probably not** | no metadata image routes were found in the page list |
| GHSA-39w2-rjm5-chcv | low | information disclosure in the **development** server's MCP endpoint | **No** | development server only |

Plain summary: the upgrade removes one critical problem that really does apply (Windows remote code execution), plus Server Action denial of service and endpoint disclosure. The two other critical image-related problems did not apply to our setup, but the upgrade removes them anyway. The caveat: "does not apply as configured" rests on the configuration staying as it is. If someone later enables AVIF, remote images or `next/og`, those conditions come back, which is a reason to stay on the fixed version.

### 3.4 The remaining production findings after the upgrade

Only `exceljs` → `uuid` (2 moderate). The spreadsheet library is used for report exports and the store-master import. The vulnerable `uuid` call is not made by the app. Accepted, not fixed.

---

## 4. What the automated checks do **not** tell us

- They do not find the logic faults that matter most in this application. Every High and Medium finding in files 04 to 06 came from reading code and database rules, then proving it with a test on the isolated stack. A scanner would not have found that a technician can change a ticket's priority by talking to the database directly.
- `npm audit` cannot see vulnerable operating-system, PostgreSQL, Node, PostgREST, login-service or NAS software on the servers. There is no patch inventory for them in the repository (control inventory section 7).
- No dynamic scan (crawler, fuzzer, injection scanner) was run, and nothing was run against production.

## 5. Test-suite results that support the findings (class A)

All against the isolated audit stack only (isolation gate: 21 of 21 checks passed, see `01-BASELINE/02-LOCAL-ISOLATION-CERTIFICATION.md`).

| Run | Saved log | What it shows |
|---|---|---|
| New VAPT exploit tests (`tests/vapt/10-…`, `11-…`, `12-…`) | `05-REMEDIATION/regress-vapt-2.log` | 3 files, **15 of 15 tests pass** on the fixed stack. Before migration 164 and the code fixes the exploit tests failed (that is how each finding was proven; see file 03) |
| New unit tests: `tests/unit/vapt-hardening-units.test.ts`, `tests/unit/approval-code-burst.test.ts`, changes to `header-trust.test.ts` and `csp-report.test.ts` | inside `regress-default-2.log` | burst test passes (listed as 2 tests passing) |
| Default suite (unit + integration) | `05-REMEDIATION/regress-default-2.log` (906 lines; the file ends without a summary line) | 232 test files marked passed; **1 file marked failed**: `tests/integration/approval-email-link.test.ts` (test "a wrong code does not work; the right code lets the approver decide"). The dashboard-numbers reconciliation ends with "0 differences" |
| Remediation suite (earlier fix checks) | `regress-remediation-1.log`, `regress-remediation-2.log` | run 1: 178 of 182 pass (4 failures where old tests expected the old, looser behaviour after migration 164; the tests were then updated). Run 2: **179 of 182 pass; 3 failures, all in `tests/remediation/110-approval-hardening.test.ts` (the e-mailed approval code)** |

**Caution to management and to the lead tester.** The last saved logs still show four failing tests, all about the e-mailed approval code. From the code, they look like a test-helper problem rather than a control failure: the code moved from the e-mail subject to the e-mail body (finding VA-INT-06), and the helper in the remediation test picks the first six-digit number in the body, which can be the ticket number rather than the code. The integration test file was edited at 16:19, after run 2 began, so the failing log may be out of date. I did not re-run these tests. **Until a clean full re-run is saved, do not state that the whole regression suite passes.** The approval-code race fix itself is supported by the separate burst test (20 parallel wrong guesses: 20 accepted before, at most 4 after).

## Open questions / evidence requests for management

1. Please approve installing Semgrep, Gitleaks, OSV-Scanner and OWASP ZAP (or an equivalent) on a separate PC, and name who will run them and how often. Until then these stay **Not Verified**.
2. Please assign an owner for a standing dependency-check routine (for example `npm audit` weekly and before each release). No such routine exists in the repository today (control inventory section 7).
3. Please decide whether the `exceljs` → `uuid` finding is formally accepted (owner name and date), or whether the export library should be replaced.
4. Please confirm the Node.js version and patch level on 10.0.1.98 (the repository does not record it) and whether the Windows host is patched, because the main critical Next.js problem is specific to Windows hosts.
5. Please provide, from the servers, the patch level of PostgreSQL 18, PostgREST, the login service build, and the NAS. None can be read from the repository.
6. Please confirm whether `supabase/seed.sql`'s development owner password was changed on production, and whether any live account still uses the bulk-import default password (a check on the live database by an authorised person, never by sharing the password).
