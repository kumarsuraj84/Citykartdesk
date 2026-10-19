# OEMs by type (AC and Genset) — how it works and how to set it up

LOCAL BUILD, NOT RELEASED. Migration 172 (`supabase/migrations/20240101000172_oem_by_type.sql`, rollback `supabase/rollback/172_oem_by_type_rollback.sql`). Release it **separately, after the security release (migrations 164–171) is live and stable.** Nothing in this guide has been done on the live system, and no test data goes into live: the live setup below is done by an administrator with real OEMs and real stores.

## What it does, in plain words

- Every OEM now has a **type: AC or Genset**. All OEMs that exist today become **AC** automatically; nothing changes for them.
- Every store has **two fixed places for an OEM**: its **AC OEM** (the one it has today) and its **Genset OEM** (new).
  - Example: store **ALC** has AC OEM **Bluestar UP** and Genset OEM **Cummins**.
- Every **category** (for example the categories of the *Admin Repair* template) has a new setting: **"Auto-send tickets of this category to the store's OEM: No / AC OEM / Genset OEM"**.
- When a store raises a ticket:
  - **Genset category** → one e-mail to the store's **Genset OEM**, a "sent to OEM" note in the conversation, and the ticket moves to **In Progress** by itself.
  - **AC category** → the same, to the store's **AC OEM**.
  - The **AC Issues service** keeps working exactly as before (store's AC OEM).
  - **Any other category** → a normal ticket; nothing is sent.
- If the store has **no OEM of the needed type**, the ticket stays **Open** and gets an **internal note**: "No Genset OEM is mapped to this store, so the ticket was not sent to an OEM automatically. Please send it to the OEM yourself." (A requester who is not linked to a store gets a similar note.) Nothing is ever sent to the wrong type of OEM.
- If the e-mail itself fails, the ticket stays open with the existing note "The automatic e-mail to … could not be sent".
- A technician changing the category **later** does not send anything (a re-classification never e-mails a vendor by surprise). This can be added later if wanted.

## Why a store cannot be mapped to two AC OEMs

- A store has **one slot per type**, so there is only one AC place and one Genset place.
- The **database refuses** an OEM of the wrong type in a slot (a Genset OEM cannot be the AC OEM, and the other way round) and an OEM of another organisation.
- An OEM that is mapped to stores **cannot change its type** until it is removed from them.
- On the OEM screen, "Assign stores" works on the slot of **that OEM's type**. If a ticked store already has another OEM of the same type, the screen shows an amber box listing those stores ("ALC (now Bluestar UP)"), the button changes to **"Confirm: replace N OEMs and save"**, and only the second click saves. Every change is written to the System Log with the replaced OEMs named.
- On the **Stores** tab each store shows both OEMs ("AC: …  Genset: …") and a line shows how many active stores have **no** AC OEM and how many have **no** Genset OEM.

## Setting it up (administrator, after the release)

1. **Rename the existing OEMs** so nobody confuses them: start every name with the type, for example "AC – Voltas", "AC – Bluestar UP". Renaming is safe (stores are linked by id). If you upload the Store Master Excel sheet, its OEM column must then use the new names.
2. **Add the Genset OEMs:** Admin → Organization → OEMs → Add OEM → type **Genset**, with their e-mail addresses and (optionally) their own e-mail template. The templates can use `{{ticket_no}}`, `{{subject}}`, `{{description}}`, `{{requester_name}}`, `{{requester_email}}`, `{{requester_phone}}`, `{{store_address}}` and the new `{{category}}`.
3. **Map the stores** to each Genset OEM: OEMs → **Assign stores** on the Genset OEM; or upload the Store Master sheet with a **GENSET OEM** column (the name of the Genset OEM). The OEM column (or "AC OEM") stays the AC OEM. A name of the wrong type in a column is refused, with the row number.
4. **Switch the category on last:** Admin → Categories → Edit the Genset category → "Auto-send … to the store's OEM" → **Genset OEM** (and the AC category → **AC OEM**). Do this only after the stores are mapped, so no ticket is raised before its OEM exists. Sub-categories follow their category.
5. **Check** the "stores without an OEM" line on the Stores tab; stores still unmapped will leave the ticket open with a note.

## Things to know

- Reports and dashboards that use a store's OEM keep using the **AC OEM** (as before); Genset tickets are **not** counted as AC tickets because the AC reports look at the AC service flag, which this feature does not touch.
- The store export has a new column "Genset OEM".
- Rollback (`172_oem_by_type_rollback.sql`) removes the type, the Genset slot and the category setting; the AC mapping is untouched. Genset mappings made after the migration would be lost, so note them first.

## Tests

`tests/vapt/31-oem-by-type.test.ts` (database guards, admin actions, ticket routing), `tests/unit/oem-route.test.ts`, `tests/unit/store-master-import.test.ts`. Run on the isolated test stack only.
