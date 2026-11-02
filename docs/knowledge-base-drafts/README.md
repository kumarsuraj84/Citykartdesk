# Help articles: the first approved set

Status: **APPROVED by Ankur (owner) in chat on 2 Nov 2026** (all 8). Version 1. Review again by 2 Feb 2027, or earlier when CKDesk changes. Approver and content owner: Ankur.

The assistant ("Ask CK Desk") may quote an article only if its `status` is `APPROVED`. The folder is still called `knowledge-base-drafts` because new drafts will be added here (the second round: service catalogue, AC PMS / vendor basics). Nothing has been handed to the assistant yet: how-to answers start in phase 2 (after the data tools are live), and only with another go from the owner.

| File | Article | For |
|---|---|---|
| 02-raise-a-ticket | How to raise a ticket | all |
| 03-ticket-status-meanings | What each ticket status means | all |
| 04-check-ticket-status | How to check the status of your ticket | all |
| 05-reopen-a-ticket | How to reopen a ticket | requesters |
| 06-reply-to-technician | How to reply to a technician | all |
| 07-feedback-csat | Giving feedback after a ticket is resolved | all |
| 08-sla-in-plain-words | Response time and resolution time (SLA) | all |
| 09-approvals-in-plain-words | How approvals work | all |

## Changing an approved article

Any change to the meaning needs a new approval: edit, set `version` up by one, set `approved_on` to the date the owner approves again, and move `review_by`. An article whose `status` is not `APPROVED` is never given to the assistant. When CKDesk's behaviour changes (reopen window, SLA wording, approval rules), review the article on the same day.

## Facts these articles depend on (taken from the code, not from live settings)

- The reopen window is an administrator setting (default 3 days); the articles say "usually 3 days".
- Business hours and holidays are not written in the articles: they are an administrator setting.
- "At risk" means less than 4 hours left, as the ticket list shows today.
- A ticket cancelled because an approval was rejected can be reopened by the requester within 48 hours.
