# Services (Service Catalog)

Source: `/admin/services` on Main (mirrored into Local), captured 2026-09-24. Schema: `services` table (see `supabase/migrations/20240101000000_initial_schema.sql` and later service-governance migrations).

Each service maps to a Team (who fulfills it), a set of tagged Categories/Sub-categories (what the requester can pick), a Form Template (the intake form fields), and an SLA Policy.

| Service | Categories tagged | Team | Status |
|---|---|---|---|
| HR | 72 | HR GROUP | Active |
| LEGAL | 10 | LEGAL GROUP | Active |
| ADMIN - AC | 16 | ADMIN GROUP | Active |
| VM | 44 | VM GROUP | Active |
| FINANCE-VENDOR CREATION | 1 | FINANCE GROUP | Active |
| IT | 75 | IT Group | Active |
| PO ADVICE (APPS) | 8 | PO APPS GROUP | Active |
| PO ADVICE (GM) | 13 | PO GM GROUP | Active |
| LP | 3 | LP GROUP | Active |
| ADMIN REPAIR | 112 | ADMIN GROUP | Active |
| L&D | 15 | L&D GROUP | Active |
| BD | 53 | BD Group | Active |
| FINANCE | 5 | FINANCE GROUP | Active |
| ADMIN - REQUIREMENTS (NON TRADING) | 183 | ADMIN GROUP | Active |

14 services total, all Active. Each has its own SLA policy and form template (see `03-sla-policies.md` and `04-form-templates.md`).
