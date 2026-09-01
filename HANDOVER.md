# Citykart Desk — Session Handover Note

**Written:** end of a long-running Claude Code session (multiple context-compaction cycles).
**Purpose:** let a fresh Claude Code login pick this project up with zero prior context.

---

## 0. Read this first

- **Docker Desktop is NOT running right now.** Local Supabase (Postgres + Auth + REST) is unreachable. First thing to do in a new session: start Docker Desktop, then `npx supabase start` from the project root, then re-check `.env.local`'s ports still match (see §5).
- **There is leftover QA test data in the database** from an interrupted demo (see §6 "Cleanup needed"). Clean it up once the DB is back up, before treating any request/profile named "QA ..." as real.
- **One real bug fix is sitting uncommitted** in `lib/actions/approvals.ts` (see §4). Review and commit/push it.
- This project went through **far more work than this one session performed** — `git log` shows dozens of commits (Business Rules engine, Field SLA Matrix, Report Builder, Projects module, Excel-style requests table, etc.) that were **not** done in this session; they landed on `main` via other sessions/other logins working the same repo concurrently. This note only claims credit for what's described in §2–§3.

---

## 1. What this app is

**Citykart Desk** — an in-house ITSM/service-desk app (Next.js 16 App Router + Supabase), single-tenant, single admin ("platform_owner") account model. Originally a multi-tenant SaaS template ("CognixDesk"/"FlowDesk") that was rebranded and stripped down to a single-org, in-house tool in earlier sessions (owner portal deleted, HRMS references removed, public signup removed).

Admin login: `suraj@citykart.org` (role `platform_owner`) — password not recorded here; ask the account owner or use the Supabase Auth admin panel to reset it if needed.

---

## 2. What THIS session did (verified, in order)

### 2.1 — WorkLenz-adoption plan, Phases 1–3
A prior sub-session reviewed an external tool ("WorkLenz") and produced an adoption plan (saved at `C:\Users\Administrator\.claude\plans\memoized-questing-toast.md` if it still exists locally — that's a per-machine Claude Code plan file, not part of the repo). This session executed:

- **Phase 1**: wired up `WorkbenchClient.tsx`'s bulk-action bar into the live Requests page (assign/status/priority), ported a Kanban board view to Requests (`RequestBoardView.tsx`, drag-and-drop with `AGENT_TRANSITIONS` validation), added collapsible group-progress-bar headers to both the Tasks table and Requests workbench list.
- **Phase 2**: added a **Workload report tab** (`app/(app)/admin/reports/WorkloadDashboard.tsx` + `lib/queries/workload.ts`) — a right-now snapshot of every agent's open Requests+Tasks (not just top-10-by-throughput like the existing leaderboard), and a **capacity-conflict banner** (`components/analytics/CapacityBanner.tsx`) flagging agents over a 15-open-ticket threshold, shown across all Reports tabs.
- **Phase 3**: added **task dependencies** ("Blocked by" picker with cycle detection — `task_dependencies` table, `TaskDependencyList.tsx`, verified live that linking A→blocked-by→B then trying B→blocked-by→A gets rejected) and a **custom date-range filter** for Reports (alongside the 7d/30d/90d presets — `PeriodParam`/`resolvePeriodParam` in `lib/queries/analytics.ts`). A **sub-requests** feature (parent/child request hierarchy) was also built in this phase, but was later **removed** by other work that landed on `main` before this session's git push (see §3) — don't rebuild it without checking why it was pulled.
- **Explicitly skipped per user instruction**: Phase 4 (custom fields for Requests) — user said "Custom Fields not needed."

### 2.2 — Full end-to-end audit
User asked for "all possible bugs, dummy content, loose ends, end to end." This session ran a `tsc --noEmit` sweep (91 pre-existing errors down to 12 confirmed-cosmetic ones) plus parallel research/fix passes, finding and fixing real bugs:

- **Silent notification/activity-log failures**: `auto_assigned`, `request_unassigned`, `task_completed` weren't valid DB enum values — every one of those notifications/logs had been silently no-op-ing. Fixed via migration `20240101000070_notification_type_gaps.sql` + corrected call sites.
- **CSAT surveys were completely broken** — insert was missing required `org_id`/`requester_id` and called `.onConflict()` on a plain (non-upsert) builder. Fixed; verified a survey row actually gets created now.
- **`platform_owner` (the one admin account) couldn't act on manager-type approvals** — `ApprovalPanel`'s role type never included `platform_owner`. Real, high-impact fix given the single-admin model.
- **5 more RLS policies + the `is_owner_org()` function** still missing `platform_owner` (a different clause shape than an earlier pass's regex had caught).
- **`intake_messages` had no UPDATE policy** — mark-read/archive/reject-status silently no-op'd for everyone. Added it.
- **Open unauthenticated write hole**: `org_signup_requests` still accepted public INSERTs for a feature already deleted from the UI. Closed.
- **Global search bypassed RLS** (used the admin client, org-scoped only) — any user could see requests/tasks/projects/approvals they had no row-level right to. Switched to the RLS-enforced client. This turned out to be the SAME root cause as a much bigger gap found later (§3): the **entire Projects module** had org-scoped-only SELECT policies, meaning *any* org member could read *every* project — fixed via migration `20240101000104_fix_projects_module_rls_scoping.sql` (added `can_view_project()` SECURITY DEFINER check).
- Smaller fixes: `team_members` insert missing `org_id` during invite (silently failed, error never checked), User Management's role dropdown hardcoded to `admin/manager/user` (couldn't actually grant `agent`/`platform_owner` through the UI), CSV export date-range silently ignored (`dateFrom` vs `date_from` typo), task priority could write an invalid/null value past a DB constraint, dead code removed (`TopBar.tsx` — orphaned, had a landmine missing-prop bug).
- Deleted a stray corrupted `types/database.ts` (accidentally created by piping `supabase gen types` stderr into the file) and regenerated it cleanly.

**This work was committed and pushed** — see §3.

### 2.3 — Committed and pushed to `main`
Commit `1e3fbf0` ("Harden agent role model and fix RLS visibility leaks in Projects/Intake/Tasks"), pushed cleanly (`449f251..1e3fbf0`). Contents:
- The RLS/security fixes above (Projects module, `intake_notes`/`intake_outbound`/`task_dependencies` visibility gaps — migrations `20240101000104` and `20240101000105`).
- A systemic tightening of "agent" permission checks from `profile.team_members.length > 0` (any team row, regardless of role) to a strict `role === 'agent'` check, across `lib/actions/requests.ts`, `tasks.ts`, `attachments.ts`, `approvals.ts`, `admin/users.ts`, and several page files — this is why the User Management role-dropdown fix mattered (admins had no way to grant `agent` before).
- Removal of the sub-requests feature (`createSubRequest`, `getSubRequests`, `SubRequestList.tsx`) — this predated/overlapped with this session's own sub-requests build from §2.1; the version that shipped is the "removed" one.
- UX upgrades: searchable comboboxes for column/status filters, cascading Category→Sub-category→Service reclassify picker, "forward to anyone in the org" assignee search.
- **Before pushing**, this session verified live: started/connected to local Supabase (discovered it was running on offset ports 56321/56322, not the config.toml default 54321/54322 — see §7), applied the pending migration, and proved the Projects RLS fix via signed JWTs directly against PostgREST (an uninvolved `user`-role profile went from seeing all 108 real projects to seeing 0; the actual owner still saw their 5).
- Also fixed a stale doc-comment in `lib/sla/resolve.ts` referencing the by-then-deleted `createSubRequest`.

### 2.4 — Live "Agent Work Journey" walkthrough (Raised → Picked Up → Working)
User asked to see, stage-by-stage, what the User/Agent-pool/assigned-Agent each see. This session:
- Created 3 throwaway QA accounts (`qa.requester@citykart.org`, `qa.agent1@citykart.org`, `qa.agent2@citykart.org`) on the IT Support team — password not recorded here; reset via the admin Users screen if needed.
- Hit a real environment wall: **Next.js refuses two dev servers sharing one `.next` lock** — another Claude Code session had `next dev` running in this exact directory. Worked around it by copying the whole project (minus `node_modules`/`.next`/`.git`) to a sibling directory, doing a real (non-symlink — Turbopack rejects symlinked `node_modules` outside its root) copy of `node_modules`, and running a second, fully independent `next dev` instance on port 3211.
- Hit a second wall: **the Browser pane wasn't actively displayed on the user's screen**, so it wasn't compositing frames — screenshots failed, and `innerText`/accessibility-tree reads came back empty even though the DOM had the right data. Worked around it by reading the raw React Server Component payload directly out of the page's `<script>` tags (the streamed data arrives regardless of paint/compositing state) — proven reliable, used for the rest of the session.
- Verified live, for all 3 stages, exactly what each persona's page received: Raised (open, unassigned, visible to whole team queue) → Picked Up (`assigned`, `isAssignedToViewer` true only for the picker, silent — no notification on self-assign) → Working (`in_progress`, **auto work-timer starts with zero manual action** — confirmed `activeTimer` populated only on the assigned agent's own view — and a real notification landed on the requester's Notifications page: *"Your request is in progress — QA Agent One is working on it."*).
- Cleaned up all 3 QA accounts and the demo request afterward; confirmed the other session's server on :3210 was never touched.

### 2.5 — Live "Rejected / Escalated" walkthrough — partially completed
User asked for the same treatment for a rejected-approval and an SLA-escalated request. This session:
- Read the exact code paths first (via a research sub-agent) rather than guessing:
  - **Rejection**: `rejectApproval()` in `lib/actions/approvals.ts` — writes `approval_decisions` (decision='rejected'), `approvals.status='rejected'`, and — important — **`requests.status` goes straight to `'cancelled'`, there is no dedicated "rejected" request status**. Logs two activity rows, notifies the requester only (`type: 'approval_rejected'`).
  - **Escalation**: the *old* SLA-escalation cron route was deleted; it's now the generic **Business Rules engine** (`lib/rules/`, cron at `app/api/business-rules/run/route.ts`, auth via `x-cron-secret` header matching `CRON_SECRET`). Real pre-existing rules already in the DB (migrated from the old system): "High/Medium/Low/Urgent Warning" firing at 75/80/85/90% SLA-elapsed, and an "Unassigned Request (2h)" rule — all currently configured to `notify` role `manager`/`admin` + the assignee. There's no dedicated "escalate" action type; escalation is just `schedule_check: sla_pct_elapsed` + a `notify` action.
- **While setting this up, found and fixed a real second bug**: `sendAdHocApproval()`'s `approval_workflows` insert never set `org_id`. Since `approval_workflow_steps`' RLS checks the *workflow's* `org_id` (not the request's), every ad-hoc approval created this way would have left its steps invisible to the RLS-scoped client used by `resolveApprovalContext()` — meaning **every approve/reject on an ad-hoc-approval request would have failed with "no steps found," permanently, for every approver.** Fixed in `lib/actions/approvals.ts` — **this fix is committed to the working tree but NOT yet committed to git** (see §4).
- **Rejection scenario: fully completed and verified.** Created QA accounts (`qa.requester2@`, `qa.agent3@`, `qa.manager1@`, `qa.approver1@citykart.org`), replicated `sendAdHocApproval()`'s exact writes, then `rejectApproval()`'s exact writes, and verified via signed-JWT PostgREST calls that: the requester sees `status: cancelled` + the exact rejection notification + full decision history with the approver's comment; the assignee sees the same cancelled state; an uninvolved team-lead manager still sees it (team-scoped visibility persists through terminal states).
- **Escalation scenario: interrupted, not completed.** Created a request (`QA-ESC-1` → became `IT-000016`) backdated ~5 days past its SLA deadline, ready to fire all four `sla_pct_elapsed` rules. Before the live cron endpoint could be invoked, **the other session's dev server (port 3210) went down**, and shortly after, **Docker Desktop itself stopped running** (confirmed: `docker ps` now fails to reach the daemon). This strongly suggests significant real wall-clock time passed between turns of this conversation (also consistent with QA data from the Agent-Work-Journey walkthrough's *second* attempt vanishing from the DB despite the real business data surviving — likely a container restart between turns, not a deliberate reset).
- A fresh `next dev` was started on port 3210 (now free) right as this was interrupted for the handover request — it may or may not still be running depending on whether Docker/Postgres came back up in the interim.

---

## 3. Other work present on `main` — NOT done by this session

`git log` on `main` shows a long history of commits with no connection to anything in §2 — e.g. (most recent first, before this session's `1e3fbf0`):
- `449f251` Business Rules AND/OR + multi-trigger, auto work timer, request reclassification, Excel-style requests table
- `a5ae80c` Retire old escalation cron route, fix stale references to deleted rule screens
- `9b8d292` Fix Business Rules SLA staleness, stale-snapshot evaluation, ghost-comment bugs
- `466c0d0` Add Business Rules engine, consolidating Routing/SLA Escalation/unassigned Alert rules
- …and many more further back (Field SLA Matrix redesign, Projects module + global search integration, Report Builder, mobile nav fixes, logo/branding polish, service catalog delete/audit, etc.)

**Read these via `git log --oneline` and `git show <hash>` rather than assuming this session's summary covers them** — they were done by other Claude Code sessions/logins working the same repo, evidenced directly by the "another chat's dev server is running in this folder" conflict this session hit twice.

---

## 4. Pending / uncommitted right now

```
git status --short
 M lib/actions/approvals.ts
```

One real fix, not yet committed: `sendAdHocApproval()` now sets `org_id` on the `approval_workflows` insert it creates (see §2.5 for why this matters — it was a permanent-failure bug for every ad-hoc approval). **Recommend reviewing and committing this before anything else** — it's small, well-understood, and fixes something that would otherwise silently break every future ad-hoc approval.

No other uncommitted changes exist in the working tree as of this note.

---

## 5. Environment — how to get running again

1. Start Docker Desktop (it is currently stopped).
2. From the project root: `npx supabase start` (use the full path `"C:\Program Files\nodejs\npx.cmd"` if `npx` isn't on `PATH`).
3. **Check the ports it actually lands on** — this repo's `supabase/config.toml` declares `54321`/`54322`, but at various points this session found the real running containers bound to `56321`/`56322` instead (Supabase auto-offsets when the default ports are taken). Compare `docker port supabase_db_citykart_desk` and `docker port supabase_kong_citykart_desk` against `.env.local`'s `NEXT_PUBLIC_SUPABASE_URL` — update `.env.local` if they don't match, or the app won't be able to reach the DB.
4. `SUPABASE_SERVICE_ROLE_KEY`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local` are the standard Supabase-CLI local-dev demo JWTs (issuer `supabase-demo`) — same on every local install, not secrets, safe as committed-adjacent config (though `.env.local` itself is correctly gitignored).
5. Dev server: `npx next dev --port 3210` (or use whatever launch mechanism the current Claude Code tooling provides — `.claude/launch.json` already defines this).
6. Login: `suraj@citykart.org` — ask the account owner for the password, or reset it via the Supabase Auth admin panel.

---

## 6. Cleanup needed (once Docker/Supabase is back up)

Leftover QA test data from the interrupted §2.5 escalation scenario — **delete before treating any of this as real data**:

```sql
-- Verify what's there first — don't blind-delete without checking, in case
-- the other concurrent session created unrelated real records with similar names.
SELECT request_no, title, status FROM requests WHERE request_no IN ('IT-000015','IT-000016') OR title LIKE '%monitor purchase%' OR title LIKE '%VPN access broken%';
SELECT id, full_name, role FROM profiles WHERE full_name LIKE 'QA %';
```

If they match what's described in §2.5 (IT-000015 = the rejected monitor-purchase request, IT-000016 = the backdated VPN-escalation request, and profiles "QA Requester Two"/"QA Agent Three"/"QA Manager One"/"QA Approver One"):

```sql
DELETE FROM requests WHERE request_no IN ('IT-000015','IT-000016'); -- cascades activity/notifications/approvals/decisions
DELETE FROM team_members WHERE user_id IN (
  SELECT id FROM profiles WHERE full_name IN ('QA Agent Three','QA Manager One')
);
```
Then delete the 4 auth users via the GoTrue admin API (`DELETE /auth/v1/admin/users/{id}` with the service-role key) — this cascades their `profiles` rows. Get the ids from the `SELECT` above first.

Also check for a leftover `zoho-demo-copy*` sibling directory under `AI WORK/` — the Agent-Work-Journey walkthrough's isolated dev-server copy was cleaned up, but if a session got interrupted mid-copy, one might still be sitting there (several hundred MB, safe to delete, it's a disposable copy of this same repo).

---

## 7. Known environment gotchas (learned the hard way this session)

- **Two `next dev` processes can't share one `.next` directory** — Next.js hard-refuses this ("Another next dev server is already running... Run taskkill /PID <pid> /F to stop it"). If you need a second concurrent instance for testing while another session's server is live, copy the whole project to a sibling directory (excluding `node_modules`/`.next`/`.git`), then **really copy** `node_modules` (`robocopy /E /MT:16` — a Windows junction/symlink gets rejected by Turbopack with "Symlink is invalid, it points out of the filesystem root" if the target is outside the copy's own tree), copy `.env.local`, and run `next dev --port <other>` from there.
- **The Browser pane sometimes isn't actively displayed/composited**, in which case `computer{action:"screenshot"}` fails outright, and — less obviously — `get_page_text`/`innerText`-based reads silently return near-empty content even though the real DOM/data is correct (React's streamed RSC payload had arrived; it just hadn't been painted). Workaround: read the raw data out of the page's `<script>` tags directly via `javascript_tool` (`document.querySelectorAll('script')` → find the one containing your known data marker) rather than trusting `innerText`/screenshots when this happens.
- **The Browser pane can only reach servers it started itself** via `preview_start` — a `next dev` process started manually via Bash/PowerShell on a port the Browser tool didn't originate is unreachable from `navigate()`, even though plain `curl`/`Invoke-WebRequest` from Bash/PowerShell reaches it fine. Workaround that *did* work: call `preview_start({url: "http://localhost:<port>/<path>"})` (not `{name: ...}`) to explicitly register that already-running URL with the pane's proxy before calling `navigate()` on it.
- **`supabase status`/`supabase migration list` can report stale/wrong info** — they printed port 54321/54322 even when the real containers were on 56321/56322, and at one point claimed the DB was reachable when `psql` immediately proved otherwise. Always verify against `docker port <container>` directly when something doesn't add up.
- **`supabase migration up --local` respects `config.toml`'s declared port, not reality** — when that's wrong, use `supabase migration up --db-url "postgresql://postgres:postgres@127.0.0.1:<realport>/postgres?sslmode=disable"` instead (the `sslmode=disable` is required for the local unencrypted Postgres).
- **This machine's real time has jumped forward unpredictably between conversation turns** (observed via Docker container uptime and by database rows created minutes earlier being gone on next check while unrelated real data survived) — don't assume state from three tool-calls ago is still there; re-verify before building on it, especially DB/process state.

---

## 8. Recommended next steps for whoever picks this up

1. Start Docker Desktop → `supabase start` → fix `.env.local` ports if they drifted.
2. Review and commit the pending `lib/actions/approvals.ts` fix (§4).
3. Run the cleanup queries in §6.
4. If you want to finish the escalation demo from §2.5: create a backdated request (or reuse the recipe there), then `curl http://localhost:3210/api/business-rules/run -H "x-cron-secret: $CRON_SECRET"` (value is in `.env.local`, gitignored — not repeated here), then check `business_rule_events` and `notifications` for the fired rows.
5. Otherwise, treat §2's items as done and move on to whatever the user's next priority is — nothing in §2 is left half-finished except the escalation demo itself, which was a verification/demo exercise, not a code change.
