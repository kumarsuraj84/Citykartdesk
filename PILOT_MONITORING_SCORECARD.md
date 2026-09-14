# WHATSAPP PILOT — MONITORING SCORECARD

A small, queryable set of metrics for the IT Support + HR Support pilot. Every "Source" below is either a direct query against existing tables (`intake_audit_log`, `request_conversations`, `requests`) or the existing Admin → Audit Log UI — nothing new was built, per the brief's own instruction not to build an analytics platform for this. Targets/thresholds are marked **TBD** wherever no business owner has set one yet — do not treat a TBD as "no monitoring," it means "watch the number, but no pass/fail line has been drawn yet."

| Metric | Definition | Source | Target / Watch Threshold | Owner |
|---|---|---|---|---|
| Inbound messages | Count of `whatsapp_message_processed` audit rows in the pilot window | `intake_audit_log` filtered by `action='whatsapp_message_processed'` | TBD | Pilot monitoring owner |
| Recognized users | Distinct requesters who successfully started a conversation | `request_conversations` distinct `requester_id` | TBD | Pilot monitoring owner |
| Rejected users | Count of `whatsapp_sender_rejected` audit rows | `intake_audit_log` filtered by `action='whatsapp_sender_rejected'` | Watch: any rejection from someone *not* on the named pilot list is worth investigating immediately (see `STAGE_8_REAL_META_VALIDATION_REPORT.md`'s Pilot Service Restriction note) | Pilot monitoring owner |
| Conversations started | Total `request_conversations` rows created in the pilot window | `request_conversations` count by `created_at` | TBD | Pilot monitoring owner |
| Tickets created | Total `requests` rows where `source_metadata.created_via='whatsapp'` | `requests` filtered by `source_metadata->>'created_via'='whatsapp'` | TBD | IT Support owner / HR Support owner (split by service) |
| Conversation completion rate | Tickets created ÷ conversations started | Derived from the two metrics above | TBD | Pilot monitoring owner |
| Abandoned/expired conversations | Count of `request_conversations` with `state IN ('cancelled','expired')` | `request_conversations` count by state | TBD | Pilot monitoring owner |
| Average messages per ticket | Average count of `conversation_events` per completed conversation | `conversation_events` grouped by `conversation_id`, joined to completed conversations | TBD | Pilot monitoring owner |
| No-result issue searches | Count of issue-search replies that returned zero sub-category matches | Requires reading `conversation_events` payloads for the `awaiting_issue_search` state with an empty result set — no dedicated audit action exists for this today; a targeted one-off query, not a standing report, until/unless this becomes a recurring need | TBD | IT Support owner / HR Support owner |
| Attachment failures | Count of `whatsapp_attachment_link_failed` audit rows | `intake_audit_log` filtered by that action | TBD | Pilot monitoring owner |
| Outbound send failures | Count of `whatsapp_send_failed` audit rows | `intake_audit_log` filtered by that action | Watch: any cluster (same conversation appearing more than once) — see runbook | Technical escalation owner |
| Duplicate-message count | Count of `whatsapp_message_processed` rows flagged `duplicate:true` in metadata (idempotent replay protection working as intended) | `intake_audit_log` metadata filter | Informational only — a non-zero count here is expected/healthy (proves replay protection is active), not itself a problem | Technical escalation owner |
| Average time to ticket creation | Average duration between a conversation's `created_at` and its `completed_at` | `request_conversations` timestamps, completed rows only | TBD | Pilot monitoring owner |
| Tickets with assignment | Percentage of pilot tickets with a non-null `assigned_to` | `requests` filtered by service + `source_metadata->>'created_via'='whatsapp'` | Expected near-0% today — `assignment_rules` is empty org-wide (see `PRE_PILOT_CONFIGURATION_DECISIONS.md` item 2); this is a config-decision metric, not a defect signal, until an owner configures rules | IT Support owner / HR Support owner |
| SLA initialized % | Percentage of pilot tickets with non-null `response_due_at`/`resolution_due_at` | `requests` filtered the same way | Target: 100% — SLA is fully configured for both services (Stage 6 finding, unchanged); any ticket missing this would be a real defect worth escalating immediately | Technical escalation owner |

## How to Pull These

None of the above require new reporting infrastructure — every row is a straightforward filter/count against tables the app already writes to in the normal course of operation (`intake_audit_log`, `request_conversations`, `requests`). The pilot monitoring owner (once named) should decide the pull cadence (daily during the pilot window is recommended, matching the runbook's own daily-check cadence) and whether to formalize any of these into a saved Admin → Reports view later — not required for Stage 8.

## Thresholds Marked TBD

Every metric marked TBD needs a business owner to set an actual target once real pilot data exists to calibrate against — setting an arbitrary number now (with zero real usage history) would be guessing, not monitoring. The two metrics with a concrete watch condition already (Rejected users, Outbound send failures, SLA initialized %) are ones where the "right" answer is knowable in advance from the system's own design, not from usage patterns.
