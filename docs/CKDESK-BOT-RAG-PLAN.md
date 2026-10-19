# CK Desk Bot (RAG): what it can do and how to build it

Written 15 October 2026, after reading the application, its database design and the live data counts. Plain language. This is a suggestion for your decision; nothing has been built.

---

## 1. What "RAG" means here, in one minute

A normal chatbot answers from what it learned long ago. It does not know Citykart's rules, stores or processes, so it guesses.

A **RAG bot** works like a careful assistant with a bookshelf:

1. You ask a question.
2. The bot first **looks up** the right pages from Citykart's own material (help articles, procedures, past solved tickets, service forms).
3. It then **writes the answer only from those pages**, and says which pages it used.
4. If it finds nothing, it says "I don't know, here is how to raise a ticket", instead of guessing.

For CK Desk, many questions are about **live data** ("What is the status of my ticket?", "How many AC tickets are open for Bhilai?"). Those are not looked up in a bookshelf; the bot should **ask the app for the answer** (this is called a "tool"). So the right design is:

> **CK Desk Bot = RAG (for knowledge and procedures) + Tools (for live ticket data), always limited to what the person asking is allowed to see.**

---

## 2. What the application holds today (from the live system, 15 Oct 2026)

| What | How much | Useful for the bot? |
|---|---|---|
| Tickets | 278 | Yes, but still few |
| Conversation messages | 477 (about 68,000 characters in total, all public; no internal notes yet) | Small, so easy and cheap to search |
| Ticket history events | 1,591 | For "what happened" answers |
| Attachments | 393 | Later (read Excel/PDF) |
| **Knowledge base articles** | **0** | **This is the gap: the bot has no books yet** |
| Services | 15, with 108 categories and 613 sub-categories | Very useful for "which service do I choose?" |
| Service forms (templates) | 15 | Useful for "what do I need to fill?" |
| SLA policies | 15 | Useful for "how long will it take?" |
| Business rules | 39 | Useful to explain "why was this assigned to X?" |
| Stores | 231 (with cluster, region, AC counts, AMC brand, OEM) | Useful for store and AC questions |
| OEMs | 14 | Useful for AC vendor questions |
| Users | 553 (only 29 have a mobile number) | Needed for WhatsApp |
| Approvals | 28 | For "what is waiting for me?" |
| CSAT ratings | 71 | Later, for quality checks |

**Honest finding:** the quality of knowledge is the main limit, not the technology.
- The knowledge base is **empty**.
- Past resolution notes are mostly "Done" or "Resolved" (we just fixed this for new tickets: minimum 10 characters, no passwords).
- Some old notes contain a default password. **These must never be given to any bot.** They must be excluded or cleaned before anything is indexed.

---

## 3. What the bot can help with (by person)

### Requesters (store and office staff)
1. **"I have a problem" helper.** The user types it in their own words (English, Hindi or Hinglish). The bot suggests the right service, category and sub-category and pre-fills the form. This reduces wrong-category tickets.
2. **Answers before a ticket.** "How do I get a Genisys ID?" The bot shows the exact steps from the help article, so no ticket is needed.
3. **"Where is my ticket?"** Live status, who has it, what is pending, expected resolution time.
4. **"What do I need to attach?"** For example, for PO ADVICE it explains the Excel format and the required fields.
5. **Duplicate warning.** "A ticket for this store and issue is already open (CKSD-…)."

### Technicians
6. **Catch me up** (already built as a basic version) written in natural language by the bot.
7. **Similar solved tickets and likely fix**, once there are enough good notes.
8. **Reply drafts** in the right tone, using the ticket and the help articles. The technician edits and sends.
9. **Procedure lookup.** "What are the steps to create a new site in Genisys?" answered from the SOP with the source shown.
10. **Resolution note helper.** Drafts "Cause / What I did" from the conversation so notes become useful.

### Managers and admins
11. **Ask in plain language.** "Show AC tickets by brand for last month." The bot does not write database queries. It chooses an existing, tested report and fills in the filters.
12. **Explain the numbers.** "Why did inflow go up this week?" using the dashboard data.
13. **Approver help.** A short summary of each pending approval and anything unusual.
14. **Policy answers.** "What is the SLA for IT tickets?" from the SLA policies.

### Everyone (later, through WhatsApp)
15. The same bot over WhatsApp: describe a problem, send a photo or voice note, get a ticket created or an answer.

---

## 4. How it should work, step by step

```
Person asks (web chat / ticket form / WhatsApp)
        │
        ▼
1. Who is asking?  -> the bot uses THEIR login and permissions only
        │
        ▼
2. What kind of question?
        ├─ "knowledge" question  -> search the bookshelf (RAG)
        └─ "my data" question    -> call a tool (status, my approvals, report)
        │
        ▼
3. Search (for knowledge): keyword search + meaning search, filtered by what this person may see
        │
        ▼
4. Write the answer ONLY from what was found, with sources ("From: SOP – Genisys ID creation")
        │
        ▼
5. Safety checks: no passwords, no other people's private data, "I don't know" when nothing found
        │
        ▼
6. Show the answer + thumbs up/down. Log the question, sources and feedback.
```

### The bookshelf (what gets indexed)
| Source | Who may be answered from it |
|---|---|
| Help articles / SOPs (to be written) | Everyone (or by audience) |
| Service catalogue, categories, form fields, SLA policies | Everyone |
| Store master and AC/OEM facts | Staff who may see stores |
| Past solved tickets (resolution notes and public replies) | Technicians and managers only; never internal notes for requesters; never anything with a password |
| Business rules explanations | Managers and admins |

Each piece is cut into small chunks, and each chunk carries labels: its source, service, audience, language and last-updated date. The bot only searches chunks that the asking person is allowed to read.

### Live data (tools, not RAG)
The bot calls small, safe functions that the app already supports, always as the signed-in person:
- my tickets and their status
- ticket details and the "Catch me up" facts
- my pending approvals
- predefined reports and dashboard numbers (with their own filters)
- store and AC lookups
- **create a ticket draft** (the person confirms before it is created)

The bot **never** changes a ticket, an approval or any number by itself. It prepares; a person confirms.

---

## 5. What to use (and what fits our servers)

Our database server is a normal PostgreSQL install on Windows. It has the text-search extension (`pg_trgm`) but **not** the usual vector extension (`pgvector`). Because the knowledge is small (a few thousand chunks at most), we do not need a heavy vector database.

| Part | Recommended | Why |
|---|---|---|
| Where knowledge lives | The existing database: new tables for articles, chunks and chat logs | No new server; same backups; same permissions |
| Search | **Hybrid**: Postgres text search first, plus meaning search | Words like store codes and ticket numbers need exact matching; meaning search helps with Hinglish and different wording |
| Meaning search storage | Store the numbers (embeddings) in a table and compare in the app at this size; install `pgvector` later if it grows | Works today without changing the database server |
| Embeddings (turning text into numbers) | A multilingual model that can run on our own server's CPU, so text stays in-house, or an API | Hindi/Hinglish support matters |
| Answer writer (the language model) | Needs a decision (see section 8) | Quality, cost and privacy trade-off |
| Chat place | A chat button inside CK Desk, and the "Describe your problem" box on the new-ticket form | Where people already are |
| Later | WhatsApp, using the same bot core | WhatsApp setup is a separate pending project |

The app already has one AI connection (email sorting through Groq/Llama), so there is a working pattern for calling an outside model, with keys kept in server settings.

---

## 6. Safety rules (non-negotiable)

1. **Same permissions as the person.** The bot sees only what that person can see in CK Desk. A requester never gets technician-only or internal information.
2. **No passwords, ever.** Anything that looks like a password is removed before indexing and before sending to any model.
3. **Minimum data out.** Only the question and the few chunks needed are sent to an outside model. No attachments, no personal numbers, no bulk exports.
4. **Cite or refuse.** Every answer shows its sources. If nothing relevant is found, it says so and offers to raise a ticket.
5. **Treat ticket text as untrusted.** A ticket could contain "ignore your rules"; the bot must not follow instructions found inside tickets or articles.
6. **People confirm actions.** The bot suggests and drafts; it never approves, resolves, assigns or deletes.
7. **Audit and limits.** Every question and answer is logged (who, what, which sources). Per-user daily limits and a monthly cost cap.
8. **Switches.** An admin can switch the bot off, or switch each use (requesters, technicians, managers) on and off separately.

---

## 7. Build plan in phases

| Phase | What | Result | Rough effort |
|---|---|---|---|
| **0. Prepare (before any code)** | Decide the AI provider. Write the first 15–30 help articles/SOPs for the busiest ticket types (Genisys ID, new site creation, OTP issues, Code S entry, bill/CN cancellation, PO advice, AC complaints). Clean passwords out of old notes. | The bookshelf exists | Mostly your team's content work; I can draft articles from tickets for review |
| **1. Help bot for requesters** | Chat button: answers from articles and the service catalogue; "where is my ticket?"; "describe your problem" fills the form | Fewer wrong-category and avoidable tickets | A few weeks |
| **2. Technician assistant** | Natural-language "Catch me up", reply drafts, procedure lookup, resolution-note draft, similar tickets | Faster handling | A few weeks |
| **3. Manager assistant** | Plain-language reports and "explain this number" using tested reports only | Less dependence on analysts | A few weeks |
| **4. WhatsApp** | Same bot over WhatsApp (needs the WhatsApp setup first: secure web address, Meta account, user mobile numbers) | Tickets and answers from a phone | After the WhatsApp project |
| **5. Improve** | Weekly review of questions the bot could not answer; turn them into new articles; track thumbs and accuracy | The bot gets better every week | Ongoing |

Each phase is built locally first, shown to you, and deployed only on your OK, as we do now.

### How we will measure it
- A fixed list of 50–100 real questions with the correct answers; run after every change.
- Answer rate (answered vs. "I don't know"), thumbs up/down, tickets avoided (people who asked the bot and did not raise a ticket), time saved per ticket for technicians.

---

## 8. Decisions needed from you

1. **AI provider** for the answer writer:
   - *Claude (Anthropic)*: best quality and instruction-following; data leaves the company to the provider.
   - *Groq (Llama)*: already used for email sorting; cheaper and fast; somewhat lower quality on Hindi/Hinglish and strict rules.
   - *Self-hosted model*: data stays in-house, but we have no GPU server; slower and weaker.
2. **Who gets it first:** requesters, technicians, or managers? (My suggestion: requesters and technicians together, starting with the busiest services: IT, Admin Repair, PO ADVICE.)
3. **Languages:** English only, or Hindi/Hinglish too? (My suggestion: both; most store staff write in Hinglish.)
4. **Is it acceptable** to send a question plus a few matched text chunks (never personal numbers, passwords or attachments) to an outside provider?
5. **Who owns the content** (the help articles)? A bot is only as good as its articles; one named person should review new articles weekly.
6. **Budget guardrail:** at your size the cost is small (a question is a few thousand words of text in total); I suggest a monthly cap that you set.

---

## 9. What I recommend

1. Start with **Phase 0 and Phase 1 together** on the busiest services.
2. In parallel, I draft the help articles from your real tickets for your team to correct and approve (the content is the real work).
3. Use **hybrid search stored inside our existing database**, no new servers.
4. Keep the bot **read-only**: it explains and prepares; people click the final button.
5. Keep **WhatsApp for later**, after the secure-address and Meta setup is done.

This gives a useful bot in a few weeks, without new infrastructure, and a safe path to the technician and manager features.
