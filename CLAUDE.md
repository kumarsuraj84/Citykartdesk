@AGENTS.md

## Production setup (read before deploying or touching servers)

Since 2026-10-07 Citykart Desk runs on **app server 10.0.1.98**, **database 10.0.0.205** (database `ckdesk`) and
**files on the NAS 10.0.0.25** (`CKAPPLICATIONS_DATA\CKDESK_DATA`). The old server 10.0.1.12 ("Main") is
**retired** — do not use or deploy to it. Dev machine: 10.0.0.47. Public/email URL: `http://182.72.84.10:3210`.

- "commit and push to git and main" = commit, push `origin main`, then build and deploy to 10.0.1.98.
- Test only locally; get the user's explicit OK before every push/deploy; never experiment on production.
- On the shared servers touch only Citykart Desk's own folder/services (98), the `ckdesk` database (205) and
  `CKDESK_DATA` (NAS). Never ask for or repeat passwords; the user types them on the servers.
- Full architecture, deploy/rollback steps, backups, restore and migration history:
  `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md`. Older docs that mention 10.0.1.12 are history.
