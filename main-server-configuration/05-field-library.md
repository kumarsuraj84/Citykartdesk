# Field Library

Source: `/admin/field-library`, captured 2026-09-24. Schema: `form_field_library` table (`supabase/migrations/20240101000141_form_field_library.sql`). A field is defined once here and reused across templates — reports show one column per library field regardless of which template(s) it's used in (this is what `field-registry.ts` / the Report Builder's "library field" concept, referenced elsewhere in this repo's commit history, is built on).

37 library fields total.

## Used on all 14 templates (the shared base fields every request form has)
| Field | Type |
|---|---|
| Attachments | File upload |
| Contact Number | Phone |
| Description | Long text |
| Subject | Short text |

## Used on 2-3 templates
| Field | Type | Used in |
|---|---|---|
| Bank Account Number | Short text | Finance, Vendor Creation |
| Bank IFSC Code | Short text | Finance, Vendor Creation |
| Contact Person Name | Short text | Vendor Creation, VM |
| Employee Code | Short text | HR, L&D, VM |

## Used on exactly 1 template
| Field | Type | Template |
|---|---|---|
| A/C Holder Name | Short text | Finance |
| AC OEM Ticket Creation Date | Date | Admin AC |
| AC OEM Ticket Number | Short text | Admin AC |
| AC resolution | Dropdown | Admin AC |
| AC Serial Number | Dropdown | Admin AC |
| Bank Name | Dropdown | Vendor Creation |
| Company Type | Dropdown | Vendor Creation |
| Contact Person Phone Number | Phone | Vendor Creation |
| Division (Apps) | Dropdown | PO Advice (Apps) |
| Division (GM) | Dropdown | PO Advice (GM) |
| Faulty Item Qty | Number | Admin Repair |
| Industury Type [sic, typo in live config] | Dropdown | Vendor Creation |
| Invoice Number | Short text | Finance |
| Products/Service Opting from Vendor | Long text | Vendor Creation |
| Refundable Amount | Number | Finance |
| Repaired Item Qty | Number | Admin Repair |
| Serial Number | Short text | IT |
| Transaction Date | Date | Finance |
| Vendor Address | Long text | Vendor Creation |
| Vendor City | Short text | Vendor Creation |
| Vendor Creation in Company | Multi-select | Vendor Creation |
| Vendor Email ID | Email | Vendor Creation |
| Vendor GST Number | Short text | Vendor Creation |
| Vendor MSME Certificate Number | Short text | Vendor Creation |
| Vendor Name | Short text | Vendor Creation |
| Vendor PAN number | Short text | Vendor Creation |
| Vendor Pincode | Short text | Vendor Creation |
| Vendor State | Short text | Vendor Creation |
| Vendor Ticket Creation Date | Date | Admin Repair |
| Vendor Ticket Number | Short text | Admin Repair |

Notes: Vendor Creation Template alone accounts for ~20 of the 37 fields (full vendor onboarding KYC: bank details, GST, PAN, MSME cert, address). Admin Repair and Admin AC each have a small set of their own dedicated fields on top of the shared base four.
