# Store CVM and category-limited fields (Qty) — how it works and how to set it up

LOCAL BUILD, NOT RELEASED. Migration 173 (`supabase/migrations/20240101000173_store_cvm.sql`, rollback `supabase/rollback/173_store_cvm_rollback.sql`). Release it **separately, after the security release (164–171) and the OEM-by-type release (172)**. Nothing here was done on the live system, and no test data goes into live: the live setup is done by an administrator with real stores and real CVMs.

## 1. CVM (the store's approver)

**CVM** is Citykart's own name for the person who approves for a store.

- Every store can be tagged with **one CVM**: an existing CKDesk user (technician, manager, admin or owner).
- **One CVM can have many stores** (10–15 or more). **A store can have only one CVM.** Example: ALC and ALD have CVM Ankur, BRD has CVM Ajay.
- The database refuses a CVM who is not an **active staff member of the same organisation** (a requester cannot be a CVM).

### Where it is used
When a technician or manager opens **Actions → Send for Approval** on a ticket, the approver box is **already filled in with the CVM of the requester's store**, with the note "Pre-filled: the CVM of this store. You can remove or change it." The technician can still change or add approvers. Nothing is sent until the technician presses **Send**; this release does **not** send approvals automatically (see "Later" below).
Nothing is suggested when the requester has no store, the store has no CVM, the CVM is no longer active, or the CVM is the requester or the person sending (the approval rules never allow either to approve).

### Setting it up (administrator)
1. **Admin → Organization → Stores.**
   - **By screen, one store:** Edit the store → field **CVM**.
   - **By screen, many stores:** button **Assign stores to a CVM** → choose the CVM → tick the stores → **Save stores**. If a ticked store already has another CVM, an amber box lists them ("ALC (now Ankur)") and the button changes to **"Confirm: replace N CVMs and save"**; only the second click saves. Every change is written to the System Log with the replaced CVMs named.
   - **By Excel:** **Upload Store Master** with a column **CVM** holding the person's **e-mail** (or full name when only one active person has it). A name that fits two people, or someone who is not active staff, is refused with the row number.
2. The Stores tab shows **CVM: name** under each store and a line "without a CVM: N" for active stores.
3. The store export has a **CVM** column.

## 2. A field that exists only for some categories (for example Qty)

**Goal:** when a requester raises a ticket under *Admin Requirements (Non Trading)* and chooses **Fixture, Hangers or Fixture Attachments**, a **Qty** box appears and is **mandatory**. For any other category Qty is not shown.

### Setting it up (administrator)
1. **Admin → Form Templates →** open the *Admin Requirements* template.
2. Add the field **Qty** (type **Number**, **Required**; optionally Minimum 1).
3. Select the field → in its settings tick **"Show only for these categories"** → tick *Fixture*, *Hangers*, *Fixture Attachments* → **Save form**.
   (Leave all unticked and the field shows for every category, as every field does today.)

### What the requester sees
- Before a category is chosen: Category, Sub category, Subject.
- After choosing Fixture (or Hangers, or Fixture Attachments): **Qty** appears with a red star; submitting without it shows **"Qty is required."**
- After choosing any other category: no Qty.
- If the requester changes the category after typing a Qty, the Qty is not sent for a category that does not use it.

### Enforced by the server, not just the screen
The same rule is applied when a ticket is created from **any channel** (web form, e-mail intake, WhatsApp): for a category that uses Qty it is required; for another category a Qty that is sent anyway is **dropped and not stored**. **Known limit:** the WhatsApp question-by-question flow still asks for every required field, so it may ask for Qty even for a category that does not use it; the ticket is created correctly (the unused Qty is dropped), and this can be tightened later. The web form, which is what stores use, behaves exactly as described. On the ticket page the Qty row is shown only on tickets of those categories, and a technician is never blocked by a field that does not apply to the ticket's category.

## 3. Later (not built, waiting for your decision)
**Automatic approval:** one setting on a category "send for approval automatically to the store's CVM", so the approval e-mail goes out as the ticket is raised and the ticket becomes **In Process**; the technician cannot resolve or close it until the CVM has decided, and a rejection cancels the ticket with the CVM's reason. This uses the same store-to-CVM link, so it can be added later without redoing anything. Open questions: fallback when a store has no CVM, one level or two, approve by e-mail link only or also inside the system.

## Tests
`tests/vapt/32-store-cvm-and-qty.test.ts` (9: database rules, admin action, pre-filled approver, Qty required / ignored) and `tests/unit/cvm-and-conditional-fields.test.ts` (6). Run on the isolated test stack only.
