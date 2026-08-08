# Citykart Desk UAT Defect Register

**Program:** Citykart Desk Enterprise UAT
**Start Date:** 2026-06-14
**Status:** OPEN — UAT In Progress
**Freeze Directive:** Active — No feature development permitted

---

## Severity Definitions

| Severity | Definition | SLA to Fix |
|----------|------------|------------|
| **Critical** | Platform unusable / data loss / security breach / blocks core workflow | Fix before next test cycle |
| **High** | Core UAT scenario fails / incorrect data / broken primary action | Fix within 24 hours |
| **Medium** | Workflow workaround exists / non-primary path broken / cosmetic with functional impact | Fix before go-live |
| **Low** | Cosmetic / minor UX / phrasing / non-blocking preference | Deferred acceptable |

---

## Active Defects

| ID | Date | Persona | Page | Severity | Description | Steps to Reproduce | Status | Fix | Notes |
|----|------|---------|------|----------|-------------|-------------------|--------|-----|-------|
| — | — | — | — | — | *No defects logged yet* | — | — | — | — |

---

## Closed Defects

| ID | Date Found | Date Fixed | Severity | Description | Fix Applied |
|----|------------|------------|----------|-------------|-------------|
| PRE-001 | 2026-06-14 | 2026-06-14 | Critical | Manager KPIs scoped to all teams | `managerTeamId` fetch + `.eq('team_id')` |
| PRE-002 | 2026-06-14 | 2026-06-14 | Critical | Task activity RLS gap (authenticated INSERT) | RESTRICTIVE deny policy migration 000029 |
| PRE-003 | 2026-06-14 | 2026-06-14 | High | Auto-assignment silent — no notification | `notify()` call added to `createRequest` |
| PRE-004 | 2026-06-14 | 2026-06-14 | High | SLA deadline not reset on reopen | REOPEN block recalculates `sla_deadline` |
| PRE-005 | 2026-06-14 | 2026-06-14 | High | `assigned_to` vs `assignee_id` mismatch on tasks | Fixed in `home/page.tsx` + `alerts/run/route.ts` |
| PRE-006 | 2026-06-14 | 2026-06-14 | High | Cron endpoints publicly accessible (`?? 'dev'` fallback) | Mandatory CRON_SECRET check, 503 if unset |
| PRE-007 | 2026-06-14 | 2026-06-14 | Medium | Pagination `value` NaN on select/span | `Number.isFinite()` guard on all Pagination props |
| PRE-008 | 2026-06-14 | 2026-06-14 | Medium | NewTaskPanel status chip ignored in createTask | `status` field passed to server action |
| PRE-009 | 2026-06-14 | 2026-06-14 | Medium | Board/Table inline add ignores column status | Column status passed to `createTask()` |
| PRE-010 | 2026-06-14 | 2026-06-14 | Medium | MasterData color picker onBlur on hidden input | onBlur moved to `<input type="color">` |
| PRE-011 | 2026-06-14 | 2026-06-14 | Medium | ScheduledReports uses `window.location.reload()` | Replaced with `router.refresh()` |
| PRE-012 | 2026-06-14 | 2026-06-14 | Low | 16 dead UI controls across platform | All removed or completed (audit 2026-06-14) |
| PRE-013 | 2026-06-14 | 2026-06-14 | Low | 14 partial UI controls across platform | All completed (audit 2026-06-14) |

---

## Defect Counters

| Severity | Found | Fixed | Deferred | Open |
|----------|-------|-------|----------|------|
| Critical | 2 | 2 | 0 | 0 |
| High | 4 | 4 | 0 | 0 |
| Medium | 5 | 5 | 0 | 0 |
| Low | 2 | 2 | 0 | 0 |
| **Total** | **13** | **13** | **0** | **0** |

*Pre-UAT defects above. UAT defects start from ID UAT-001.*

---

## How to Log a Defect

Add a row to Active Defects with:
- **ID:** UAT-NNN (sequential)
- **Date:** YYYY-MM-DD
- **Persona:** Employee / Collaborator / Agent / Manager / Admin
- **Page:** URL or page name
- **Severity:** Critical / High / Medium / Low
- **Description:** One-line summary
- **Steps to Reproduce:** Numbered steps
- **Status:** Open / In Progress / Fixed / Deferred / Closed
- **Fix:** Commit or description of fix
- **Notes:** Any context
