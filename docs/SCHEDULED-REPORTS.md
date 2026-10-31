# Scheduled reports that send themselves (audit finding F-26)

LOCAL ONLY until released. No database change (the table `scheduled_reports` already had everything needed).

## What it does, in plain words
Admin > Reports > **Scheduled** tab lets an administrator make a report (requests, tasks or approvals) with a list of recipients and a frequency. Until now nothing ever sent it
except the **Send Now** button: the frequency was only a label. Now a job sends them by itself:

| Frequency | Goes out |
|---|---|
| Daily | every day at 07:00 India time |
| Weekly | every Monday at 07:00 India time |
| Monthly | on the 1st of the month at 07:00 India time |

The screen shows, for each report, when the next automatic send is, and the date and time it was last sent.

## Rules it follows
- A new report waits for the next slot: a report made at 10:00 is not sent at once for the 07:00 slot it did not exist at (press Send Now for that).
- A report is **claimed before it is sent**, so two runs at the same moment (or a restart in the middle) can never send it twice.
- A report nobody could be reached for is tried again at every run (every 30 minutes) for 6 hours after its slot; after that it waits for the next slot.
- A report that reached some people and failed for one is **not** sent again (the first people would get it twice). The failure is written to the System Log and the scheduled task shows as failed.
- A switched-off report, or one with no recipients, is never sent. The screen says so.
- The recipients are checked again at send time (own users and known OEM contacts only), exactly as for Send Now. Send Now and the automatic run use the same code (`lib/reports/deliver.ts`).
- A server that was off for days sends each overdue report once when it is back (not one per missed day).

## Where it lives
- Rule of WHEN: `lib/reports/schedule.ts` (pure; tests `tests/unit/scheduled-reports-schedule.test.ts`).
- The run: `lib/reports/run-due.ts`, route `GET /api/reports/run` (cron secret), cron-tick job `scheduled-reports` (every 30 minutes).
- Windows task (not installed anywhere yet): `scripts/windows/add-reports-task.ps1` adds `CitykartDesk-Cron-ScheduledReports`; `install-cron-tasks.ps1` includes it for a fresh install.
- Tests with the database and a mail recorder: `tests/vapt/65-scheduled-reports-run.test.ts` (6 tests).

## Trying it in the local app
1. Admin > Reports > **Scheduled** tab: the demo report "DEMO daily tasks report" (never sent).
2. In PowerShell, in the project folder: `node scripts/local-run-job.mjs scheduled-reports` (talks only to the local app; it refuses any other address).
3. Reload the tab: "Last Sent" now has the date and time. The mail is the newest file in `local-mail-outbox`. Run the command again: it says nothing was due.
4. To see it send again, make it "never sent" once more: `docker exec supabase_db_citykart_desk psql -U supabase_admin -d postgres -c "update scheduled_reports set last_sent_at = null where name = 'DEMO daily tasks report'"`, then run step 2 again.

## To go live (later, only when the owner says)
Deploy the release, then on 10.0.1.98 run once as Administrator: `scripts\windows\add-reports-task.ps1`. Nothing else changes. Until that task exists the reports are sent only by Send Now, as today.
