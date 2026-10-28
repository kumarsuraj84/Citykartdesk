# Form Templates

Source: `/admin/form-templates`, captured 2026-09-24. Schema: `form_templates` table (`form_sections` JSONB column holds the actual field layout). Each template maps 1:1 to one Service (see `01-services.md`) — editing a template's fields updates every service tagged to it immediately (per the in-app warning banner on the template builder).

14 templates, one per service, each currently used by exactly 1 service: ADMIN AC TEMPLATE, ADMIN REPAIR TEMPLATE, ADMIN REQUIREMENT TEMPLATE, BD TEMPLATE, FINANCE TEMPLATE, HR TEMPLATE, IT TEMPLATE, L&D TEMPLATE, LEGAL TEMPLATE, LP TEMPLATE, PO ADVICE (APPS), PO ADVICE (GM), VENDOR CREATION TEMPLATE, VM TEMPLATE.

## Structure (example: ADMIN REPAIR TEMPLATE)

Each template has 2+ sections, each with fields pulled from the shared Field Library (`05-field-library.md`) plus optional one-off fields specific to that template only.

- **Requester Detail** section: Contact Number (phone, from library, required)
- **Ticket Detail** section: Faulty Item Qty (number, required), Repaired Item Qty (number, read-only to requester), Vendor Ticket Creation Date (date, read-only to requester), Vendor Ticket Number (text, read-only to requester), Subject (required), Description (required), Attachments (required)

This "requester fills basic info, technician fills resolution detail as read-only-to-requester fields" pattern (Faulty Qty vs Repaired Qty, Vendor Ticket Creation Date vs a matching completion field) repeats across the vendor/repair-style templates (Admin AC, Admin Repair). HR/IT/Legal/etc. templates instead lean on category-specific one-off fields tailored to what that department needs to collect (not individually captured field-by-field here — see the Field Library for the full reusable-field catalog, and open a specific template's "Edit Fields" screen live for its exact current layout).

**For another AI studying this repo:** the template builder UI is a 3-column editor (Field Library search+picker → section editor with drag-reorder → live requester/technician preview) at `components/admin/SectionBuilder.tsx`, rendered per-template at `app/(app)/admin/form-templates/[id]/page.tsx`. The `form_sections` JSON shape is defined in `types/index.ts` (`FormSection`).
