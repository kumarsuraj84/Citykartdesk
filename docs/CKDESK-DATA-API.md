# CK Desk read-only data API (for the data platform / DBA)

Written 2 November 2026. Built and tested on the development PC only. **Nothing of this is on the live server (10.0.1.98) yet.**

## 1. What it is, in simple words

The data platform (DBA team) wants CK Desk data in its own Postgres, so Pulse and the CKOneAI bot can use it. CK Desk offers a small **read-only window** for that:

- the platform calls CK Desk with a secret **token**, page by page, and copies what it receives;
- it can only **read**; it cannot change anything in CK Desk;
- it never connects to the CK Desk database (10.0.0.205) directly;
- it never receives e-mail addresses, mobile numbers, employee numbers or anything people typed (ticket titles, descriptions, comments, remarks, forms, cancel reasons, rating comments). Every entity names a person by an opaque id only; the **display name** is in the `users` entity (agreed by the owner, 2 Nov 2026), and the platform joins on the id.

## 2. Addresses (on the app server, port 3210; HTTPS later when the certificate plan is done)

All are `GET`, all need `Authorization: Bearer <DATA_API_TOKEN>`, all answer JSON with `Cache-Control: no-store` and the header `X-Data-Api-Version: 1`.

| Address | What it gives |
|---|---|
| `/api/data/v1/meta` | Every entity: description, load style, columns (type + personal-data flag), **row count** and the **newest change date**, so the platform can check its copy against CK Desk. |
| `/api/data/v1/rows?entity=<name>&limit=<1-5000>&updated_since=<ISO UTC>&after=<cursor>` | One page of rows. Ordered by (change column, id). Answers `rows`, `count`, `has_more`, `next_after` (pass it as `after` for the next page; `null` = last page) and `max_cursor` (newest change date in the page). |
| `/api/data/v1/ids?entity=<name>&limit=<1-5000>&after=<cursor>` | Every id that exists now (and its change date). The platform compares it with its own copy each night to find **deleted** rows. |

Rules the platform should follow:
- **Follow `next_after`, never "fewer rows than asked means the end".** The database layer can cut a page short (its own 1,000-row limit); the API detects that and still returns a `next_after`.
- First load: no `updated_since`, follow `next_after` to the end. Later loads: `updated_since` = last newest change date minus 1-3 days (re-reading a little is safe: rows are upserted by `id`).
- Timestamps are ISO text with the database's own precision and **always an explicit offset**. The database runs in its own time zone, so on live they come as `-08:00` / `-07:00` (not `Z`); a value that is already UTC comes as `Z`. The offset is part of the value, so it is the same moment either way. Do not change this without telling the platform: it keeps the offset on every timestamp. (`updated_since` is accepted in any ISO form and read as an exact moment.)
- Errors: `401` wrong/missing token (20 wrong tokens in a minute from one caller pauses that caller for the rest of the minute), `503` the API is switched off (no `DATA_API_TOKEN`) or the organisation cannot be decided, `400` a bad parameter, `404` unknown entity.
- Deletes: CK Desk tables have no "deleted" flag (rows are really deleted), so the nightly `ids` comparison is the way.

## 3. Load style per entity

- **incremental**: has a change date that moves on every change (`updated_at`): read by `updated_since`.
- **append**: rows are only added (status history, comments, decisions): read by their creation date.
- **snapshot**: no reliable change date (`csat_surveys`): read in full each time (276 rows).

## 4. Switching it on (steps for the owner, when the platform is ready)

How the live app runs today (read-only check, 2 Nov 2026): plain **http**, one listener on port 3210 for every address, the router forwards the public port 3210 to it, no proxy, and the Windows firewall rule for 3210 allows any address. So, as long as the app is on http:

- the token and the data cross the network **in clear text** (readable by anyone on the path), and the data API would also be reachable from the internet side of the router, protected only by the token;
- to limit that: the token must be **at least 32 random characters**; set `DATA_API_ALLOWED_HOSTS=10.0.1.98:3210` (the address the platform uses) so a request that arrives through the public address gets "not found"; wrong guesses can never lock the right token out; the API is read-only and carries no e-mail, mobile or typed text;
- moving to https later (see `HTTPS-AND-CSP-PLAN.md`) removes the clear-text risk and needs no change in the API.

Steps:
1. On 10.0.1.98, in `appstandalone.env.local`, the owner adds `DATA_API_TOKEN=<random, at least 32 characters, different from every other secret>` and `DATA_API_ALLOWED_HOSTS=10.0.1.98:3210` (typed by the owner, never in chat or git), then restarts the CK Desk app service. Without the token the API answers 503 (off). If the database ever holds more than one organisation, also set `DATA_API_ORG_ID`.
2. The same token is entered in the platform's own connection (by the owner).
3. The network rule **platform server -> 10.0.1.98 port 3210** is opened by the owner / network admin (the rule for 3210 is already open to every address; a narrower rule would also close the app to the offices, so it is left as it is).
4. The platform proves its counts against `/meta`.

## 5. Store key for Pulse

Each ticket carries `store_code` (the CK Desk store code of the person who raised it; empty for head-office users). `stores.code` is the same code. CK Desk has **no separate Oracle `site_code`**. If the platform's site list uses a different code, a mapping list (store code -> site code) must come from the owner / platform and be loaded as a column of the store master; until then the platform joins on the store code only if its codes match.

## 6. What is open

- The owner's decisions on comments (flags only, as built) and people (opaque ids only, as built) are the **conservative defaults**; they can be widened later one column at a time, only on the owner's word.
- The bot (CKOneAI) reads the platform's `gold_*` views, not CK Desk. See `docs/CKDESK-BOT-VIA-CKONEAI.md`.

## 7. Entities and columns (from `lib/data-api/entities.ts`; 20 entities from the local build: the last two, `users.manager_id`, `requests.ac_key` and `ac_units` are NOT released yet)

### `requests`

One row per ticket: service / category, status, priority, people (ids only), the store of the requester, and the SLA times. No title, description or form text.

- Source table: `requests`; key: `id`; load style: **incremental**; ordering/change column: `updated_at`.
- Rows on live (2 Nov 2026): 714 (643 in last 30 days).

| Column | Type | Personal data | Note |
|---|---|---|---|
| `id` | uuid | no |  |
| `request_no` | text | no |  |
| `service_id` | uuid | no |  |
| `category_id` | uuid | no |  |
| `sub_category_id` | uuid | no |  |
| `status` | text | no |  |
| `priority` | text | no |  |
| `team_id` | uuid | no |  |
| `requester_id` | uuid | opaque id of a person |  |
| `assigned_to` | uuid | opaque id of a person | the technician |
| `parent_request_id` | uuid | no |  |
| `store_code` | text | derived | CKDesk store code of the requester; null for a head-office user |
| `ac_key` | text | derived | NEW (local, not released): which AC an AC ticket is about: STORE code in capitals + "\|" + the AC number in lower case, e.g. "ABC\|ac 3" (the key the AC Calendar uses). From the AC copy saved on the ticket, else the AC number answered on the form. Null for any other ticket, a genset ticket, or when the ticket does not say which AC (about 39% of AC tickets had it on 10 Nov 2026). Join to `ac_units` on upper(store_code) + "\|" + lower(ckdesk_no). After the release do ONE full reload of `requests` (no `updated_since`): existing rows do not change their `updated_at` |
| `created_at` | timestamptz | no |  |
| `updated_at` | timestamptz | no |  |
| `responded_at` | timestamptz | no |  |
| `resolved_at` | timestamptz | no |  |
| `closed_at` | timestamptz | no |  |
| `response_due_at` | timestamptz | no |  |
| `resolution_due_at` | timestamptz | no |  |
| `waiting_since` | timestamptz | no | set while the ticket waits for the user |
| `paused_ms_total` | int | no | milliseconds the SLA clock was paused |
| `reopen_count` | int | no |  |
| `response_breached` | bool | derived | responded_at later than response_due_at; null while not answered or no target |
| `resolution_breached` | bool | derived | resolved_at later than resolution_due_at; null while not resolved or no target |

### `request_status_history`

Every status change of every ticket (from -> to, when, by whom as an id). Only added to, never changed.

- Source table: `request_activity` (only rows with action = status_changed); key: `id`; load style: **append**; ordering/change column: `created_at`.
- Rows on live (2 Nov 2026): 1,071 (1,018 in 30 days).

| Column | Type | Personal data | Note |
|---|---|---|---|
| `id` | uuid | no |  |
| `request_id` | uuid | no |  |
| `actor_id` | uuid | opaque id of a person |  |
| `created_at` | timestamptz | no |  |
| `from_status` | text | no |  |
| `to_status` | text | no |  |

### `request_comments`

One row per message on a ticket, as flags only: who (id), when, internal or public, the channel, and the length. NEVER the text.

- Source table: `request_comments`; key: `id`; load style: **append**; ordering/change column: `created_at`.
- Rows on live (2 Nov 2026): 1,298 (1,227 in 30 days).

| Column | Type | Personal data | Note |
|---|---|---|---|
| `id` | uuid | no |  |
| `request_id` | uuid | no |  |
| `author_id` | uuid | opaque id of a person | null when the writer was outside CKDesk |
| `is_internal` | bool | no |  |
| `source` | text | no |  |
| `from_external` | bool | derived |  |
| `text_length` | int | derived | number of characters; the text itself is never sent |
| `created_at` | timestamptz | no |  |

### `services`

The services of the catalogue (names, switches, SLA policy). No form definition, keywords or description.

- Source table: `services`; key: `id`; load style: **incremental**; ordering/change column: `updated_at`.
- Rows on live (2 Nov 2026): 17.

| Column | Type | Personal data | Note |
|---|---|---|---|
| `id` | uuid | no |  |
| `name` | text | no |  |
| `slug` | text | no |  |
| `is_active` | bool | no |  |
| `status` | text | no |  |
| `team_id` | uuid | no |  |
| `sla_policy_id` | uuid | no |  |
| `default_priority` | text | no |  |
| `owner_id` | uuid | opaque id of a person | the service owner |
| `created_at` | timestamptz | no |  |
| `updated_at` | timestamptz | no |  |

### `service_categories`

The categories under the services.

- Source table: `service_categories`; key: `id`; load style: **incremental**; ordering/change column: `updated_at`.
- Rows on live (2 Nov 2026): 112.

| Column | Type | Personal data | Note |
|---|---|---|---|
| `id` | uuid | no |  |
| `name` | text | no |  |
| `slug` | text | no |  |
| `is_active` | bool | no |  |
| `is_pms` | bool | no | the AC PMS category |
| `program_id` | uuid | no | the Vendor Program it belongs to |
| `created_at` | timestamptz | no |  |
| `updated_at` | timestamptz | no |  |

### `service_sub_categories`

The sub-categories under the categories.

- Source table: `service_sub_categories`; key: `id`; load style: **incremental**; ordering/change column: `updated_at`.
- Rows on live (2 Nov 2026): 618.

| Column | Type | Personal data | Note |
|---|---|---|---|
| `id` | uuid | no |  |
| `category_id` | uuid | no |  |
| `name` | text | no |  |
| `slug` | text | no |  |
| `is_active` | bool | no |  |
| `sla_priority` | text | no |  |
| `created_at` | timestamptz | no |  |
| `updated_at` | timestamptz | no |  |

### `stores`

The store master: code, place, region / cluster, priority list, opening date and the AC facts. `code` is the CKDesk store code the data platform joins on.

- Source table: `stores`; key: `id`; load style: **incremental**; ordering/change column: `updated_at`.
- Rows on live (2 Nov 2026): 231.

| Column | Type | Personal data | Note |
|---|---|---|---|
| `id` | uuid | no |  |
| `code` | text | no | store code; the join key |
| `name` | text | no |  |
| `address` | text | no | a business address |
| `city` | text | no |  |
| `state` | text | no |  |
| `pincode` | text | no |  |
| `region` | text | no |  |
| `cluster` | text | no |  |
| `priority_list` | text | no |  |
| `festival` | text | no |  |
| `open_date` | date | no |  |
| `is_active` | bool | no |  |
| `ac_total` | int | no |  |
| `ac_brand` | text | no |  |
| `ac_amc_brand` | text | no |  |
| `ac_amc_vendor` | text | no |  |
| `zenatix` | bool | no |  |
| `created_at` | timestamptz | no |  |
| `updated_at` | timestamptz | no |  |

### `sla_policies`

The SLA policies and their targets (config).

- Source table: `sla_policies`; key: `id`; load style: **incremental**; ordering/change column: `updated_at`.
- Rows on live (2 Nov 2026): 17.

| Column | Type | Personal data | Note |
|---|---|---|---|
| `id` | uuid | no |  |
| `name` | text | no |  |
| `is_active` | bool | no |  |
| `config` | json | no | the targets by priority |
| `created_at` | timestamptz | no |  |
| `updated_at` | timestamptz | no |  |

### `csat_surveys`

The rating survey of each resolved ticket: rating and dates. The comment the requester typed is never sent. The table has no change date, so it is read in full (small).

- Source table: `csat_surveys`; key: `id`; load style: **snapshot**; ordering/change column: (none, read in full by id).
- Rows on live (2 Nov 2026): 276 (271 in 30 days).

| Column | Type | Personal data | Note |
|---|---|---|---|
| `id` | uuid | no |  |
| `request_id` | uuid | no |  |
| `rating` | int | no | 1-5; null until answered |
| `sent_at` | timestamptz | no |  |
| `submitted_at` | timestamptz | no |  |
| `reminder_sent_at` | timestamptz | no |  |

### `approvals`

The approval of a ticket: its status and the step it is at.

- Source table: `approvals`; key: `id`; load style: **incremental**; ordering/change column: `updated_at`.
- Rows on live (2 Nov 2026): 97 (93 in 30 days).

| Column | Type | Personal data | Note |
|---|---|---|---|
| `id` | uuid | no |  |
| `request_id` | uuid | no |  |
| `status` | text | no |  |
| `current_step` | int | no |  |
| `workflow_id` | uuid | no |  |
| `requested_by` | uuid | opaque id of a person |  |
| `created_at` | timestamptz | no |  |
| `updated_at` | timestamptz | no |  |

### `approval_decisions`

Each approve / reject decision (who as an id, step, decision, when). The approver's comment is never sent.

- Source table: `approval_decisions`; key: `id`; load style: **append**; ordering/change column: `decided_at`.
- Rows on live (2 Nov 2026): 88 (86 in 30 days).

| Column | Type | Personal data | Note |
|---|---|---|---|
| `id` | uuid | no |  |
| `approval_id` | uuid | no |  |
| `step_order` | int | no |  |
| `decision` | text | no |  |
| `decided_by` | uuid | opaque id of a person |  |
| `decided_at` | timestamptz | no |  |

### `teams`

The support teams (names behind team_id). The notification e-mail address of a team is never sent.

- Source table: `teams`; key: `id`; load style: **incremental**; ordering/change column: `updated_at`.
- Rows on live (2 Nov 2026): 12.

| Column | Type | Personal data | Note |
|---|---|---|---|
| `id` | uuid | no |  |
| `name` | text | no |  |
| `slug` | text | no |  |
| `prefix` | text | no |  |
| `department_id` | uuid | no |  |
| `is_active` | bool | no |  |
| `created_at` | timestamptz | no |  |
| `updated_at` | timestamptz | no |  |

### `departments`

The departments (names behind department_id). The head of department (a person) is never sent. No change date, so read in full (small).

- Source table: `departments`; key: `id`; load style: **snapshot**; ordering/change column: (none, read in full by id).
- Rows on live (2 Nov 2026): 1.

| Column | Type | Personal data | Note |
|---|---|---|---|
| `id` | uuid | no |  |
| `name` | text | no |  |
| `code` | text | no |  |
| `parent_id` | uuid | no |  |
| `is_active` | bool | no |  |
| `created_at` | timestamptz | no |  |

### `locations`

The locations (names behind location_id). No change date, so read in full (small).

- Source table: `locations`; key: `id`; load style: **snapshot**; ordering/change column: (none, read in full by id).
- Rows on live (2 Nov 2026): 2.

| Column | Type | Personal data | Note |
|---|---|---|---|
| `id` | uuid | no |  |
| `name` | text | no |  |
| `code` | text | no |  |
| `city` | text | no |  |
| `country` | text | no |  |
| `timezone` | text | no |  |
| `is_active` | bool | no |  |
| `created_at` | timestamptz | no |  |

### `approval_workflows`

The approval workflows (names behind workflow_id). Their description text is not sent.

- Source table: `approval_workflows`; key: `id`; load style: **incremental**; ordering/change column: `updated_at`.
- Rows on live (2 Nov 2026): 97.

| Column | Type | Personal data | Note |
|---|---|---|---|
| `id` | uuid | no |  |
| `name` | text | no |  |
| `created_at` | timestamptz | no |  |
| `updated_at` | timestamptz | no |  |

### `programs`

The Vendor Programs (AC, Genset, RO ...; names behind program_id). Mail wording, sheet links and vendor addresses are never sent.

- Source table: `vendor_programs`; key: `id`; load style: **incremental**; ordering/change column: `updated_at`.
- Rows on live (2 Nov 2026): 4.

| Column | Type | Personal data | Note |
|---|---|---|---|
| `id` | uuid | no |  |
| `name` | text | no |  |
| `slug` | text | no |  |
| `level` | text | no | mail or portal |
| `row_type` | text | no | machine or store |
| `is_active` | bool | no |  |
| `created_at` | timestamptz | no |  |
| `updated_at` | timestamptz | no |  |

### `ac_units`  (NEW, local, not released)

The air conditioners of the AC sheet (about 2,400 rows, read in full): store code, AC number, brand, tonnage, whether the AC is active or was removed, and whether it is the Server Room AC. No serial number, vendor, e-mail or address.

- Source table: `master_ac_units`; key: `id`; load style: **snapshot** (no change date: read in full each time); ordering: `id`.
- Rows on live (10 Nov 2026): 2,360 (2,359 active; 217 are Server Room ACs).

| Column | Type | Personal data | Note |
|---|---|---|---|
| `id` | uuid | no |  |
| `store_code` | text | no | CKDesk store code, capitals |
| `ckdesk_no` | text | no | the AC number the store uses on its tickets |
| `brand` | text | no |  |
| `tonnage` | text | no |  |
| `is_active` | bool | no |  |
| `is_server_room` | bool | derived | the Server Room AC (not one of the store's counted ACs in the AC Calendar) |
| `removed_at` | timestamptz | no | set when the AC left the sheet; null while it is on it |

### `users`

The people: opaque id and display name, role, active flag, store, department and location. No e-mail, mobile number or employee number. Every other entity refers to a person by id only; join to this one for the name.

- Source table: `profiles`; key: `id`; load style: **incremental**; ordering/change column: `updated_at`.
- Rows on live (2 Nov 2026): 555 (14 new in 30 days).

| Column | Type | Personal data | Note |
|---|---|---|---|
| `id` | uuid | opaque id of a person |  |
| `full_name` | text | display name of a person | display name only; never e-mail, mobile or employee number |
| `role` | text | no |  |
| `is_active` | bool | no |  |
| `store_code` | text | derived | null for head-office users |
| `department_id` | uuid | no |  |
| `location_id` | uuid | no |  |
| `is_vendor` | bool | derived | a vendor / OEM technician login |
| `created_at` | timestamptz | no |  |
| `updated_at` | timestamptz | no |  |
| `manager_id` | uuid | opaque id of a person | the direct manager (the Manager box on the account); null when none. **Added 2 Nov 2026 (LOCAL, not released): new last column** |

### `approval_workflow_steps`  (NEW, local, not released)

The steps of every approval workflow: which step is approved by whom (an opaque id, or "any manager"). With `approvals.current_step` it says whom a pending approval waits for. The workflow tables have no change date, so it is read in full (small).

- Source table: `approval_workflow_steps`; key: `id`; load style: **snapshot**; the organisation is found through the workflow.

| Column | Type | Personal data | Note |
|---|---|---|---|
| `id` | uuid | no |  |
| `workflow_id` | uuid | no |  |
| `step_order` | int | no |  |
| `approver_type` | text | no | specific_user or any_manager |
| `approver_user_id` | uuid | opaque id of a person | null for an any_manager step |

### `team_members`  (NEW, local, not released)

Who is in which support team (ids only). The table has no row id of its own, so `id` is made as `team_id:user_id` (also in `/ids` and in the cursor). No change date, so it is read in full (small).

- Source table: `team_members`; key: (team_id, user_id) shown as the text `id`; load style: **snapshot**.

| Column | Type | Personal data | Note |
|---|---|---|---|
| `id` | text | no | team_id:user_id, made by the API |
| `team_id` | uuid | no |  |
| `user_id` | uuid | opaque id of a person |  |
| `is_lead` | bool | no |  |
| `joined_at` | timestamptz | no |  |
