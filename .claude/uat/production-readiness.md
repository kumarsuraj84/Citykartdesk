# Citykart Desk Production Readiness Checklist

**Date:** 2026-06-14
**Status:** PRE-UAT COMPLETE — AWAITING UAT EXECUTION

---

## Readiness Dimensions

Each dimension is scored 0–10. Weighted average = Production Readiness Score.

| Dimension | Weight | Score | Status | Notes |
|-----------|--------|-------|--------|-------|
| Security & RLS | 25% | 8.5 | ✅ Passing | RESTRICTIVE policies, persona matrix all PASS |
| Core Functionality | 20% | 8.0 | ✅ Passing | All 5 persona journeys verified via static analysis |
| Data Integrity | 15% | 8.5 | ✅ Passing | SLA deadline, team scoping, auto-assign all fixed |
| Performance | 15% | 8.0 | ✅ Passing | 17 indexes, pagination, N+1 eliminated |
| Operational Readiness | 10% | 7.5 | ⚠️ Partial | Cron docs exist; prod env not yet configured |
| UI Cleanliness | 10% | 9.5 | ✅ Passing | Zero dead controls post-audit |
| UAT Sign-Off | 5% | 0.0 | ⬜ Pending | UAT not yet executed |

**Current Weighted Score: 7.9 / 10**
*(UAT Sign-Off dimension zeroed until execution complete)*

**Target for Production: ≥ 8.5 / 10**

---

## Pre-UAT Fixes Summary

All fixes from pre-UAT hardening phase (see defect-register.md):

### Critical Fixes ✅
- Manager team KPI data leakage — FIXED
- Task activity RLS INSERT gap — FIXED
- Cron endpoints publicly accessible — FIXED

### High Fixes ✅
- Auto-assignment notification silent — FIXED
- SLA deadline not reset on reopen — FIXED
- `assigned_to` / `assignee_id` column mismatch — FIXED

### Medium Fixes ✅
- 30 dead/partial UI controls — FIXED

---

## Production Environment Requirements

### Required Environment Variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://[project-ref].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=[anon-key]
SUPABASE_SERVICE_ROLE_KEY=[service-role-key]

# App
NEXT_PUBLIC_APP_URL=https://[production-domain]

# Security
CRON_SECRET=[random-32-char-string]   # NEVER 'dev'

# Email (optional — silently disabled if absent)
RESEND_API_KEY=[resend-api-key]
```

### Required Infrastructure

| Item | Provider | Status |
|------|----------|--------|
| Next.js hosting | Vercel (recommended) | ⬜ Not configured |
| Database | Supabase (Pro plan for PITR) | ⬜ Not configured |
| Email | Resend | ⬜ Not configured |
| Cron jobs | Vercel Cron / GitHub Actions / pg_cron | ⬜ Not configured |
| Error tracking | Sentry (recommended) | ⬜ Not configured |
| Uptime monitoring | Better Uptime / Datadog | ⬜ Not configured |

---

## Known Limitations at Launch

These are accepted for initial production deployment and are **not blockers**:

| Limitation | Severity | Mitigation |
|------------|----------|------------|
| No Excel/XLSX export (CSV only) | Low | CSV is fully functional |
| No analytics dashboard route (`/analytics` → `/home`) | Low | Home page provides KPI overview |
| No drag-and-drop in board view | Low | "Move to" dropdown works correctly |
| Avatar photos cannot be uploaded (requires Supabase storage bucket setup) | Low | Initials avatars display correctly |
| Resend email disabled until API key set | Low | In-app notifications work without email |
| Trigram search degrades above 1M profile rows | Low | Out of scope for initial deployment |

---

## Deferred Features (Post-UAT / Post-Production)

Do NOT build these until UAT is complete and production is stable:

- [ ] Knowledge Base
- [ ] Workflow Automation (visual builder)
- [ ] AI Suggestions
- [ ] HRMS Integrations
- [ ] Analytics Dashboard (`/analytics` route)
- [ ] Excel/XLSX export
- [ ] Task watchers / followers
- [ ] Approval delegation UI (basic delegation added; advanced workflow routing deferred)
- [ ] Mobile app

---

## Production Readiness Decision Matrix

| Score | Decision |
|-------|----------|
| ≥ 9.0 | **READY FOR PRODUCTION** — deploy with confidence |
| 8.5 – 8.9 | **CONDITIONAL READY** — deploy with documented known risks |
| 8.0 – 8.4 | **CONDITIONAL READY** — fix Medium items before high-volume launch |
| 7.0 – 7.9 | **NOT READY** — resolve remaining High items |
| < 7.0 | **NOT READY** — Critical/High issues block deployment |

---

## Final Sign-Off

| Role | Name | Date | Decision |
|------|------|------|----------|
| Engineering Lead | — | — | ⬜ Pending |
| UAT Lead | — | — | ⬜ Pending |
| Product Owner | — | — | ⬜ Pending |

**Final Answer:** ⬜ *Pending UAT completion*

*Will be updated to "Ready for Production" or "Not Ready for Production" with full justification at end of UAT.*
