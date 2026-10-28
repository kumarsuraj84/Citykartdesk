# Email & Alert Configuration

Source: `/admin/settings` (Integrations tab) and `/admin/request-config` (Alert Rules / Notification Rules tabs), captured 2026-09-24.

**No secrets included below** — the mailbox App Password is stored encrypted and the UI itself never displays it again after entry; this file only documents what's configured, not the credential.

## Outbound email identity (live, real)
- **From address:** `CitykartDesk <citykartdesk@citykartstores.com>`
- **SMTP:** `smtp.gmail.com:587`, signed in as `citykartdesk@citykartstores.com` (Google Workspace mailbox + App Password, not a normal Gmail password)
- **Status:** Configured and connected ("Delivery via SMTP" shows Configured)
- One single identity sends everything: ticket notifications, OEM routing emails, and escalation alerts.
- Two delivery paths from this one mailbox:
  1. **Event-driven** (instant): assignment, comments, status changes, OEM auto-routing — fires the moment the event happens, per Notification Rules below.
  2. **Time-driven** (scheduler): due-soon/overdue alerts, daily digest, SLA escalation — driven by the server's cron tasks (alerts every 30 min, business rules every 15 min, daily digest at 8 AM). See `.claude/cron.md` and `scripts/windows/install-cron-tasks.ps1` in this repo for the actual schedule wiring.
- **WhatsApp:** no channel configured on this environment at capture time ("No WhatsApp channel configured yet").

## Alert Rules (time-based, scheduler-driven)
| Name | Type | Entity | Threshold | Notify roles | Channels |
|---|---|---|---|---|---|
| Task Overdue | Overdue | Task | 0 min | Manager | In-App, Email |
| Unassigned Request (2h) | Unassigned | Request | 120 min | Manager | In-App |
| Daily Digest | Daily Digest | Request | — | Manager, Admin | Email |
| Task Due Soon (24h) | Due Soon | Task | 1440 min | Manager | In-App, Email |

## Notification Rules (event-driven — which channels each event uses)
Default state: nothing overridden here means **every channel is on** (Email + Portal/bell + Push) for every event below; this screen only matters for turning specific channels off. Push has no effect yet (no VAPID key configured on this environment).

Event categories and events: **Requests** (submitted, status changed, resolved, closed, cancelled, reopened, auto-closed after no reply — the reopen window is 3 days/72h, configurable on the General tab — priority changed) · **Assignment** (assigned, reassigned, unassigned) · **Conversation** (new reply, internal note added, @mentioned in a note) · **Collaborators** (added, removed) · **Approvals** (approval needed from you, approved, rejected) · **Tasks** (assigned, completed).

## Data Retention Policy
| Entity | Retain | Archive after | Purge after |
|---|---|---|---|
| Attachments | 1825d (5y) | — | — |
| Audit Logs | 2555d (7y) | — | 2555d (7y) |
| Notifications | 90d | — | 90d |
| Requests | 1825d (5y) | 365d (1y) | — |
| Tasks | 1825d (5y) | 365d (1y) | — |

## Priority levels
Urgent/Critical, High, Medium, Low (4 tiers — matches the tiers used throughout `03-sla-policies.md`).
