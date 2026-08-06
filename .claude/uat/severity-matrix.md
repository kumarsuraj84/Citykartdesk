# FlowDesk UAT Severity Matrix

---

## Severity Levels

### Critical — Fix Before Next Test Cycle

Any defect that:
- Makes a core user journey completely impossible
- Causes data loss or data corruption
- Creates a security vulnerability (unauthenticated access, privilege escalation, RLS bypass)
- Blocks authentication or login
- Produces unhandled server errors visible to end users (500 pages, crashes)

**Examples:**
- Employee cannot submit a request
- Agent cannot see their queue
- Manager approval action errors out
- Admin cannot access the admin panel
- A user can view another user's private data

---

### High — Fix Within 24 Hours

Any defect that:
- Breaks a primary UAT scenario step but a workaround exists
- Produces incorrect data in a KPI, dashboard, or record (wrong count, wrong status)
- Causes a notification or email to not be sent when it should be
- Makes a required form field unsubmittable
- Produces a console error that impairs a visible UI feature

**Examples:**
- SLA badge shows wrong time
- Assignment notification not delivered
- Request status transition fails silently
- Approval step skipped in multi-step workflow
- Export CSV contains wrong data

---

### Medium — Fix Before Go-Live

Any defect that:
- Affects secondary workflows but does not block the primary path
- Produces cosmetic errors with functional side effects (wrong label, misleading count)
- Breaks a non-primary view (calendar/board while table works)
- Causes a minor data mismatch that does not affect decisions
- Degrades performance noticeably (>3s page load on normal dataset)

**Examples:**
- Calendar view overflow indicator not expanding
- Board column "Add task" creates task in wrong status
- Pagination showing incorrect page count
- Admin monitoring refresh not working
- Search returning no results for valid query

---

### Low — Deferred Acceptable

Any defect that:
- Is purely cosmetic (spacing, colour, icon choice)
- Is a phrasing or label improvement
- Affects an edge case with extremely low user impact
- Is a nice-to-have UX improvement, not a correctness issue

**Examples:**
- Button label grammar
- Minor alignment issue
- Tooltip text improvement
- Dark mode colour contrast edge case

---

## Triage Matrix

| Impact × Frequency | Rare | Occasional | Frequent |
|---------------------|------|------------|----------|
| **Blocks workflow** | High | Critical | Critical |
| **Incorrect data** | Medium | High | Critical |
| **Cosmetic only** | Low | Low | Medium |
| **Security** | Critical | Critical | Critical |

---

## UAT Personas & Coverage

| Persona | Seed Credentials | Primary Scenarios |
|---------|-----------------|-------------------|
| Employee | Standard user (no team) | Browse catalog → Submit request → Track status → Close |
| Collaborator | Standard user added to a request | View shared request → Comment → Cannot reassign |
| Agent | `agent@flowdesk.dev` / `Password123!` | See queue → Assign → Transition → Resolve → Internal notes |
| Manager | `manager@flowdesk.dev` / `Password123!` | Dashboard KPIs → Approve → Team queue → Export |
| Admin | Admin-role account | Full admin panel → User mgmt → SLA config → Monitoring |

---

## Defect Flow

```
Found during UAT
    ↓
Log in defect-register.md
    ↓
Severity triage
    ↓
Critical/High → Fix immediately → Re-test same session
Medium        → Fix before go-live → Re-test next cycle
Low           → Deferred list → Review at go/no-go gate
    ↓
Move to Closed Defects when verified fixed
    ↓
Update daily-status.md
```
