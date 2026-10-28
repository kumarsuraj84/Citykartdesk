# Business Rules (Auto-Assignment)

Source: `/admin/business-rules`, captured 2026-09-24. Schema: `assignment_rules` (or equivalent — "business rules" is the current UI name for what earlier migrations call assignment rules). Rules fire when a request is created/edited or on a scheduled condition, and can assign, change priority/status, or notify.

**38 rules total**, all following the same pattern: `<SERVICE> TICKET RULE_<TECHNICIAN FIRST NAME>` — each rule matches requests by category (1-3 conditions, mostly "all" match mode) within one service and auto-assigns them to a specific named technician. This is effectively the real technician-to-category routing table for the org, expressed as rules rather than a static mapping.

| Service | Technicians with a routing rule |
|---|---|
| ADMIN REPAIR | Raushan, Shivanshu, Subhash Jha, Mohit, Akhilesh |
| IT | Manish, Arvind, Vinay, Deepak, Kaushlesh, Ajay |
| VM | Bittu, Lal Bahadur, Prince Jha, Prince Kumar, Rambalak, Suraj Rai, Vineet, Vishal, Rahul (New), Rahul (Old), Dheerendra |
| HR | Ayush, Chanchal, Shubhangi, Sweta |
| GINESYS (sub-routing under IT) | Kapil, Aakankasha |
| LEGAL | Gaurav |
| L&D | Juhi |
| LP | Jawed Alam |
| PO ADVICE (APPS) | Bhagirath |
| PO ADVICE (GM) | Shubham Jha |
| ADMIN AC | Krishan |
| ADMIN REQUIREMENT | Nisha |
| FINANCE-VENDOR CREATION | Accounts (team, not an individual) |
| FINANCE | Banking (team, not an individual) |
| BD | Mukesh |

Most rules use 2-3 conditions in "all" (AND) match mode — almost certainly `service = X AND category = Y [AND sub_category = Z]` — each with a single action (assign to that technician). A few (Legal, L&D, LP, PO Apps, PO GM, Finance, Finance-Vendor Creation, BD's single Mukesh rule) use just 1 condition, meaning that technician handles the entire service rather than a specific category slice.

**For another AI studying this repo:** this list was read from the rules index page (name + condition/action counts), not by opening each rule to inspect its exact field/value pairs — the routing intent is inferred from the naming convention and category structure in `02-categories-and-subcategories.md`, not independently verified per rule. Open `/admin/business-rules` and click into a specific rule for its exact condition logic if that detail matters for a task.
