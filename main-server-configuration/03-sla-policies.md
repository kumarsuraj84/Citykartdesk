# SLA Policies

Source: `/admin/sla-policies`, captured 2026-09-24. Schema: `sla_policies` table. Each policy defines a Response / Resolution time target per priority tier; each maps 1:1 to one Service (see `01-services.md`). Format below: `Priority: response / resolution`.

| Policy | Urgent | High | Medium | Low |
|---|---|---|---|---|
| ADMIN AC SLA | 1h / 6h | 2h / 12h | 4h / 24h | 8h / 48h |
| ADMIN REPAIR SLA | 1h / 6h | 2h / 12h | 4h / 24h | 8h / 48h |
| ADMIN REQUIREMENT SLA | 1h / 6h | 2h / 12h | 4h / 24h | 8h / 48h |
| BD SLA | 3h / 72h | 6h / 120h | 10h / 192h | 24h / 240h |
| FINANCE SLA | 2h / 12h | 4h / 24h | 8h / 48h | 10h / 72h |
| HR SLA | 1h / 6h | 2h / 12h | 4h / 24h | 6h / 48h |
| IT SLA | 0.5h / 2h | 2h / 8h | 4h / 24h | 6h / 48h |
| L&D SLA | 1h / 6h | 2h / 12h | 4h / 24h | 6h / 48h |
| LEGAL SLA | 1h / 6h | 2h / 12h | 4h / 24h | 6h / 48h |
| LP SLA | 1h / 6h | 2h / 12h | 4h / 24h | 6h / 48h |
| PO APPS SLA | 2h / 6h | 3h / 12h | 6h / 24h | 10h / 48h |
| PO GM SLA | 2h / 6h | 3h / 12h | 6h / 24h | 10h / 48h |
| VENDOR CREATION SLA | 2h / 12h | 4h / 24h | 10h / 48h | 12h / 72h |
| VM SLA | 1h / 6h | 2h / 12h | 4h / 24h | 6h / 48h |

Notes: IT has the tightest Urgent response target (30 min) of any service, reflecting its high category volume (75 categories) and store-operations criticality. BD has by far the loosest targets (up to 240h/10 days for Low), consistent with it covering physical facilities/construction work (electrical, civil, glass, roofing — see `02-categories-and-subcategories.md`) that genuinely takes longer than a desk-based fix. All 14 policies currently map to exactly one service each (1:1), though the schema supports many-to-one.
