# Approval Flows

Source: `/admin/approvals`, captured 2026-09-24.

**Finding, not configuration:** there are currently **no pre-configured, reusable, named Approval Workflow templates** in this org. Every workflow visible on this screen is an **ad-hoc** one (`Ad-hoc: <request title>`), auto-created the moment someone clicks "Send for Approval" on an individual request (see `lib/actions/approvals.ts#sendAdHocApproval`, and `06-business-rules.md`/`07-email-and-alert-configuration.md` for how approval events then notify people). This matches what services show under `01-services.md` — none of the 14 services have a formal `approval_workflow_id` set; approvals are requested case-by-case, not gated by a standing policy.

On Local specifically, this list is heavily cluttered with leftover automated-test data — dozens of `Ad-hoc: fixtures-d03 seedRequestLike <timestamp>` entries with 0 steps, left behind by an earlier test suite run (`tests/setup/fixtures-d03.ts`) that was never cleaned up. **These are test artifacts, not real business configuration** — ignore them; they don't reflect anything about Main. The two real, human-created ad-hoc approvals visible ("Ad-hoc: Barcode printer not working", "Ad-hoc: Application issue", both 1 step) are genuine examples of the pattern in actual use.

**For another AI studying this repo:** if a task involves building or reasoning about formal (non-ad-hoc) approval workflows, note the feature exists at the schema level (`approval_workflows`, `approval_workflow_steps` support `approver_type: 'any_manager' | 'specific_user'`, sequential or parallel steps via `current_step = 0`) but isn't actually used that way in this org today — every approval so far has been the ad-hoc, per-request kind.
