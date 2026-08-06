# FlowDesk Go-Live Checklist

**Version:** 1.0
**Last Updated:** 2026-06-14
**Owner:** Engineering Lead

Complete every item before production deployment. Items marked ✅ are verified. Items marked ⬜ are pending.

---

## 1. UAT Sign-Off

| # | Check | Status | Verified By |
|---|-------|--------|-------------|
| 1.1 | Employee journey PASS | ⬜ | |
| 1.2 | Collaborator journey PASS | ⬜ | |
| 1.3 | Agent journey PASS | ⬜ | |
| 1.4 | Manager journey PASS | ⬜ | |
| 1.5 | Admin journey PASS | ⬜ | |
| 1.6 | Zero Critical defects open | ⬜ | |
| 1.7 | Zero High defects open | ⬜ | |
| 1.8 | Medium defects reviewed and accepted/deferred | ⬜ | |
| 1.9 | Final UAT cleanliness score ≥ 9.0 | ⬜ | |

---

## 2. Code Quality

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 2.1 | No `TODO` or `FIXME` in production code paths | ⬜ | |
| 2.2 | No `console.log` statements left in server actions | ⬜ | |
| 2.3 | No hardcoded credentials or secrets in source | ⬜ | |
| 2.4 | No placeholder screens or stub pages | ⬜ | |
| 2.5 | No dead navigation links | ⬜ | |
| 2.6 | TypeScript build passes without errors | ⬜ | |
| 2.7 | No `as any` casts hiding real type errors | ⬜ | |

---

## 3. Environment & Secrets

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 3.1 | `NEXT_PUBLIC_SUPABASE_URL` set (production) | ⬜ | |
| 3.2 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` set (production) | ⬜ | |
| 3.3 | `SUPABASE_SERVICE_ROLE_KEY` set (server-only) | ⬜ | |
| 3.4 | `CRON_SECRET` set (non-empty, non-`dev`) | ⬜ | |
| 3.5 | `RESEND_API_KEY` set (email enabled) | ⬜ | |
| 3.6 | `NEXT_PUBLIC_APP_URL` set to production domain | ⬜ | |
| 3.7 | All env vars NOT committed to source control | ⬜ | |
| 3.8 | `.env.local` / `.env.production` gitignored | ⬜ | |

---

## 4. Database

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 4.1 | All 29+ migrations applied to production DB | ⬜ | |
| 4.2 | RLS enabled on all user-facing tables | ⬜ | |
| 4.3 | `pg_trgm` extension installed | ⬜ | |
| 4.4 | All 17 performance indexes present | ⬜ | |
| 4.5 | Seed data removed / replaced with real data | ⬜ | |
| 4.6 | No test users (agent@flowdesk.dev etc.) in prod | ⬜ | |
| 4.7 | Admin account created with secure password | ⬜ | |
| 4.8 | Database backup configured and tested | ⬜ | |
| 4.9 | Point-in-time recovery enabled (Supabase Pro) | ⬜ | |

---

## 5. Security

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 5.1 | All 5 UAT personas cannot access unauthorised data | ⬜ | |
| 5.2 | `/api/escalation/run` returns 401 without correct secret | ⬜ | |
| 5.3 | `/api/alerts/run` returns 401 without correct secret | ⬜ | |
| 5.4 | `/admin/*` redirects to `/home` for non-admin/manager | ⬜ | |
| 5.5 | Attachment magic-byte validation active | ⬜ | |
| 5.6 | Storage bucket policies restrict upload to service_role | ⬜ | |
| 5.7 | No API keys exposed in client-side bundles | ⬜ | |
| 5.8 | Auth tokens not logged anywhere | ⬜ | |

---

## 6. Scheduled Jobs (Cron)

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 6.1 | Escalation cron configured (`/api/escalation/run`) | ⬜ | Every 30 min recommended |
| 6.2 | Alert cron configured (`/api/alerts/run`) | ⬜ | Every 60 min recommended |
| 6.3 | Cron jobs tested end-to-end on staging | ⬜ | |
| 6.4 | Cron failure alerting configured | ⬜ | |

---

## 7. Email

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 7.1 | Resend API key active (not free tier rate-limited) | ⬜ | |
| 7.2 | Sending domain verified in Resend | ⬜ | |
| 7.3 | Assignment notification email received | ⬜ | |
| 7.4 | Status change notification email received | ⬜ | |
| 7.5 | Approval notification email received | ⬜ | |
| 7.6 | Email unsubscribe / bounce handling configured | ⬜ | |

---

## 8. Performance

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 8.1 | Requests list loads < 2s on ≥100 records | ⬜ | |
| 8.2 | Task list loads < 2s on ≥100 records | ⬜ | |
| 8.3 | Home dashboard loads < 3s | ⬜ | |
| 8.4 | Global search returns < 500ms | ⬜ | |
| 8.5 | All 17 DB indexes confirmed active | ⬜ | |
| 8.6 | Export CSV < 10s for 1000 records | ⬜ | |

---

## 9. Monitoring

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 9.1 | `/admin/monitoring` page loads with real counts | ⬜ | |
| 9.2 | Supabase dashboard logging enabled | ⬜ | |
| 9.3 | Error tracking configured (Sentry / similar) | ⬜ | |
| 9.4 | Uptime monitoring configured | ⬜ | |

---

## 10. Launch Gate

| # | Check | Status |
|---|-------|--------|
| 10.1 | All sections 1–9 complete | ⬜ |
| 10.2 | Stakeholder sign-off received | ⬜ |
| 10.3 | Rollback plan documented | ⬜ |
| 10.4 | Support team briefed on known limitations | ⬜ |
| **GO / NO-GO** | **Final decision** | ⬜ |

---

## Rollback Plan

If a Critical defect is discovered post-deployment:
1. Revert to last known-good deployment (Vercel instant rollback or equivalent)
2. Log defect as Critical in defect-register.md
3. Fix on a hotfix branch
4. Re-run affected UAT scenarios
5. Redeploy when fixed + verified
