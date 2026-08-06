# Owner Portal (`cognix-owner`) — Operator Control Plane Reference

> The SaaS **operator** console for the ecosystem, in the separate repo
> `suraj2build/cognix-owner`. It manages tenant organizations for **CognixDesk** (and,
> per the owner-portal code, **CognixHR/HRMS**) on the shared Supabase backend.
> See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the ecosystem overview.

> **✅ Topology confirmed (2026-06-21).** This portal connects to **two separate Supabase
> projects** plus a Railway HRMS gateway:
> - **`kxvdlvarjvtqijzvmegk`** — hosts **HRMS *and* the Owner Portal's own auth** (shared).
>   🚫 **OFF-LIMITS** (HRMS data lives here).
> - **`jhdzjzrimjjtqwnkrwha`** — **CognixDesk** (dedicated project; the tables in
>   `DATABASE.md`). ✅ Safe to work on.
> - Railway `hrmsapi-production-7125.up.railway.app` — HRMS REST gateway (backed by
>   `kxvdlvarjvtqijzvmegk`). 🚫 HRMS — do not call/modify.
>
> **⚠️ This portal is the danger surface for HRMS**, because it touches both projects.
> Any code path using `ownerClient` (→ `kxvdlvarjvtqijzvmegk`) or `ownerApi` (→ Railway
> HRMS) can affect HRMS. Only `cognixClient` (→ `jhdzjzrimjjtqwnkrwha`) is in scope.
> Secrets (anon JWTs) seen in source are intentionally **not reproduced here**.

---

## 1. Stack & build
- **Vite + React 19 SPA**, React Router v7, **TanStack Query** (server state),
  **Zustand** (client state), Tailwind 4 + shadcn/ui (Radix), `recharts`, `sonner`,
  `react-hook-form` + `zod`.
- Dev server on port **3100**; Vite proxies `/owner/*` → Railway HRMS backend.
- `vercel.json` = SPA rewrite (`/(.*) → /index.html`).
- Build: `tsc -b && vite build`. Vendor chunk splitting (charts/supabase/react/query/icons).
- Env: `VITE_HRMS_API_URL` (defaults to the Railway URL). Supabase URLs/anon keys are in
  client source (anon keys are public by design; **not reproduced here**).

## 2. Supabase clients (confirmed topology)
- **`ownerClient.ts`** → `kxvdlvarjvtqijzvmegk` — **shared by HRMS + owner auth**.
  Platform-admin login; isolated storage key `cognixdesk-owner-auth` so a tenant login in
  the same browser can't clobber the operator session. 🚫 **HRMS lives in this project —
  off-limits.**
- **`cognixClient.ts`** → `jhdzjzrimjjtqwnkrwha` — **CognixDesk** (dedicated). Calls
  `owner_*` RPCs (RLS checks owner role server-side). ✅ In scope.
- **`ownerApi.ts`** → Railway HRMS REST gateway. 🚫 HRMS — off-limits.

> Because CognixDesk is a *separate* project from HRMS, CognixDesk schema/RPC work is
> inherently HRMS-safe. The only HRMS exposure in this portal is via `ownerClient` and
> `ownerApi`.

## 3. State
- **Zustand `ownerStore`** — `{ admin, accessToken, isLoading }`, getter `isOwner()`
  (`admin.role === 'owner'`). Only the admin profile is persisted locally; the token is
  re-derived from the Supabase session per load.

## 4. Routes (under `/owner`)
**Shared:** `/owner/login`, layout `OwnerLayout` (split sidebar: CognixHR + CognixDesk,
session guard, badge counters).

**CognixDesk side (relevant to this project):**
- `/owner/cognix-orgs` — list/create organizations; search/filter by status.
- `/owner/cognix-orgs/:id` — org detail: edit name/billing/seat-limit/plan; module-access
  toggles; user accounts (add/reset/activate-deactivate); billing snapshots; license
  management + history.
- `/owner/cognix-requests` — CognixDesk signup-request approvals (approve → create org).
- `/owner/cognix-licensing` — module-access matrix (org × module) + license-key inventory.
- `/owner/cognix-errors` — `error_reports` from CognixDesk.

**CognixHR/HRMS side (do not touch HRMS):** `/owner/dashboard`, `/owner/tenants`(+`:id`),
`/owner/requests`, `/owner/api-keys`, `/owner/billing`, `/owner/errors`, `/owner/admins`.
These talk to the Railway HRMS REST API via `ownerApi` (Bearer token).

## 5. CognixDesk owner RPCs (via `cognixClient`)
`owner_get_cognix_orgs()`, `owner_get_org_detail(p_org_id)`, `owner_get_org_users(p_org_id)`,
`owner_get_billing_snapshots(p_org_id)`, `owner_get_signup_requests()`,
`owner_approve_signup_request(p_request_id, p_org_name, p_seat_limit)`,
`owner_reject_signup_request(p_request_id, p_reason)`, `owner_get_module_access()`,
`owner_get_license_keys()`, `owner_update_org(...)`, `owner_update_org_billing(...)`,
`owner_set_org_status(p_org_id, p_status)`, `owner_toggle_module(p_id, p_enabled)`,
`owner_toggle_user(p_user_id, p_is_active)`, `owner_issue_license(p_org_id, p_months)`,
`owner_create_cognix_user(p_org_id, p_full_name, p_email, p_password, p_role)`,
`owner_reset_cognix_user_password(p_user_id, p_password)`,
`owner_upsert_billing_snapshot(...)`, `owner_get_error_reports()`.

These map directly to the CognixDesk tables documented in [`DATABASE.md`](./DATABASE.md):
`organizations`, `org_module_access`, `license_keys`, `org_signup_requests`,
`error_reports`, `profiles`.

## 6. Operator capabilities (CognixDesk)
- **Orgs:** create; edit name/billing-email/per-seat-rate/seat-limit/plan
  (`standard|pro|enterprise`); status `active|suspended|cancelled`.
- **Module licensing:** toggle modules per org (writes `org_module_access` →
  immediately changes `proxy.ts` gating in the live app); issue license keys valid N months.
- **Users:** provision org users with roles `agent|manager|admin|user`; reset passwords;
  activate/deactivate.
- **Signups:** review `org_signup_requests`; approve → create org; reject with reason.
- **Billing:** record/view monthly snapshots.
- **Errors:** read `error_reports`.

## 7. Boundary with the main app
The operator portal **writes the tenancy/licensing state** (`organizations`,
`org_module_access`, `license_keys`) that the CognixDesk Next.js app **reads and enforces**
(`proxy.ts` gating, `/trial-expired`, signup flow). Changing a module toggle here flips
access in the live product on the next request.
