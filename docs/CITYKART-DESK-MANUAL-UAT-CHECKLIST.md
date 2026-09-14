# CITYKART DESK — MANUAL UAT CHECKLIST

This checklist is for Citykart employees to use when doing a final hands-on check of the application. No technical or database knowledge is needed — just click through the app and record what you see.

**How to use this:**
- Go through each test in order for your role.
- Follow the steps exactly.
- Write down what actually happened under "Actual Result."
- Mark PASS if it matches the expected result, FAIL if it doesn't.
- Add any comments — anything that looked wrong, confusing, or unexpected, even if you're not sure it's a real problem.

---

## SECTION 1 — REQUESTER

### Test 1: Sign in
**What to test:** You can log in with your email and password.
**Steps:**
1. Go to the sign-in page.
2. Enter your email and password.
3. Click "Sign in."
**Expected Result:** You land on your Home page and see your name.
**Actual Result:** _______________
**PASS / FAIL:** _______________
**Comments:** _______________

### Test 2: Wrong password shows an error
**Steps:**
1. On the sign-in page, enter your email with a wrong password.
2. Click "Sign in."
**Expected Result:** A clear message appears saying the login failed. You are not signed in.
**Actual Result:** _______________
**PASS / FAIL:** _______________
**Comments:** _______________

### Test 3: Browse services and submit a request
**Steps:**
1. From Home, click "New Request" (or "Browse Services").
2. Pick any service (e.g., HR Support, IT Support).
3. Fill in the required fields (marked with *).
4. Submit the request.
**Expected Result:** The request is created successfully and you're taken to its detail page, or told clearly it was submitted.
**Actual Result:** _______________
**PASS / FAIL:** _______________
**Comments:** _______________

### Test 4: View your request list
**Steps:**
1. Click "Requests" in the navigation.
**Expected Result:** You see a list of requests you've submitted, with status and priority shown clearly.
**Actual Result:** _______________
**PASS / FAIL:** _______________
**Comments:** _______________

### Test 5: Open a request and add a comment
**Steps:**
1. Click into any of your requests.
2. Add a comment in the conversation box and post it.
**Expected Result:** Your comment appears immediately in the conversation.
**Actual Result:** _______________
**PASS / FAIL:** _______________
**Comments:** _______________

### Test 6: Reopen a resolved request
**Steps:**
1. Find a request with status "Resolved."
2. Click the status and choose "Open" (reopen).
3. Enter a reason when asked.
**Expected Result:** The request successfully reopens — no error message.
**Actual Result:** _______________
**PASS / FAIL:** _______________
**Comments:** _______________

### Test 7: Check notifications
**Steps:**
1. Click the bell icon or "Notifications."
**Expected Result:** You see a list of notifications, or a clear "all caught up" message if there are none.
**Actual Result:** _______________
**PASS / FAIL:** _______________
**Comments:** _______________

### Test 8: Check approvals (if you have any)
**Steps:**
1. Click "Approvals."
**Expected Result:** You see any requests awaiting approval decisions relevant to you.
**Actual Result:** _______________
**PASS / FAIL:** _______________
**Comments:** _______________

---

## SECTION 2 — TECHNICIAN (AGENT)

### Test 9: Sign in and view your queue
**Steps:**
1. Sign in with your technician account.
2. Look at your Home page.
**Expected Result:** You see your assigned ticket count and any tickets needing attention.
**Actual Result:** _______________
**PASS / FAIL:** _______________
**Comments:** _______________

### Test 10: View your ticket queue (list and board)
**Steps:**
1. Click "Agent Requests."
2. Try both the "Table" and "Board" view buttons.
**Expected Result:** Both views show the same tickets, just laid out differently. Board view groups tickets by status.
**Actual Result:** _______________
**PASS / FAIL:** _______________
**Comments:** _______________

### Test 11: Start working on a ticket
**Steps:**
1. Open an assigned ticket that's still "Open" or "Assigned."
2. Click "Start Working."
3. Enter the required first message.
**Expected Result:** Status changes to "In Progress." Your message appears in the conversation.
**Actual Result:** _______________
**PASS / FAIL:** _______________
**Comments:** _______________

### Test 12: Resolve a ticket
**Steps:**
1. On a ticket you're working, click the status and choose "Resolved."
2. Enter a resolution message.
**Expected Result:** Status changes to "Resolved." Message appears in the conversation.
**Actual Result:** _______________
**PASS / FAIL:** _______________
**Comments:** _______________

### Test 13: Reassign a ticket to a teammate
**Steps:**
1. Open a ticket assigned to you.
2. Use the assignment option to reassign it to another technician on your team.
**Expected Result:** Assignment changes successfully. The new assignee's name shows on the ticket.
**Actual Result:** _______________
**PASS / FAIL:** _______________
**Comments:** _______________

### Test 14: Try to reassign to a different team (should be blocked)
**Steps:**
1. Try to reassign a ticket to someone NOT on your team.
**Expected Result:** You're blocked with a clear message explaining you can only assign to your own team.
**Actual Result:** _______________
**PASS / FAIL:** _______________
**Comments:** _______________

### Test 15: Check the SLA countdown
**Steps:**
1. Open any active ticket.
**Expected Result:** You see a countdown clock showing time remaining to resolve.
**Actual Result:** _______________
**PASS / FAIL:** _______________
**Comments:** _______________

---

## SECTION 3 — MANAGER

### Test 16: Sign in and view team workload
**Steps:**
1. Sign in with your manager account.
2. Look at your Home page.
**Expected Result:** You see a breakdown of your team's tickets by technician.
**Actual Result:** _______________
**PASS / FAIL:** _______________
**Comments:** _______________

### Test 17: Cross-team reassignment
**Steps:**
1. Open any ticket.
2. Try reassigning it to a technician on a DIFFERENT team.
**Expected Result:** As a manager, this should succeed (unlike a technician, who is blocked from this).
**Actual Result:** _______________
**PASS / FAIL:** _______________
**Comments:** _______________

### Test 18: Review and act on an approval
**Steps:**
1. Click "Approvals."
2. Open a pending approval, if any exist.
3. Approve or reject it, with a comment if asked.
**Expected Result:** The decision is recorded and the request updates accordingly.
**Actual Result:** _______________
**PASS / FAIL:** _______________
**Comments:** _______________

### Test 19: View Analytics/Reports dashboard
**Steps:**
1. Click "Analytics" or "Reports" in the navigation.
**Expected Result:** You see KPI numbers (open tickets, SLA breaches, resolved count) that look reasonable for your team.
**Actual Result:** _______________
**PASS / FAIL:** _______________
**Comments:** _______________

---

## SECTION 4 — ADMIN

### Test 20: Sign in and view User Management
**Steps:**
1. Sign in with your admin account.
2. Go to Admin → Users.
**Expected Result:** You see a full list of users with their roles and status.
**Actual Result:** _______________
**PASS / FAIL:** _______________
**Comments:** _______________

### Test 21: View Roles & Permissions
**Steps:**
1. Go to Admin → Roles & Permissions.
2. Click the "Permission Matrix" tab.
**Expected Result:** You see a clear notice that this screen is "Not enforced — Coming soon" and that editing is turned off. This is intentional, not a bug.
**Actual Result:** _______________
**PASS / FAIL:** _______________
**Comments:** _______________

### Test 22: View Business Rules
**Steps:**
1. Go to Admin → Business Rules.
**Expected Result:** You see the list of automation rules currently configured, with toggle switches to enable/disable each one.
**Actual Result:** _______________
**PASS / FAIL:** _______________
**Comments:** _______________

### Test 23: View System Monitoring
**Steps:**
1. Go to Admin → Monitoring.
**Expected Result:** You see live counts (open requests, SLA breaches, pending approvals) and a recent-activity feed.
**Actual Result:** _______________
**PASS / FAIL:** _______________
**Comments:** _______________

### Test 24: Try to access Report Builder as a non-admin (optional — needs a second, non-admin account)
**Steps:**
1. Sign in as a Requester or Technician.
2. Look for "Report Builder" in the sidebar under Analytics.
3. Click it.
**Expected Result — note: this is a KNOWN issue already reported (DESK-QA-001)** — clicking it currently sends you back to Home with no explanation, even though the menu shows it to you. Please confirm you see the same behavior; if it now works differently, that's useful to know.
**Actual Result:** _______________
**PASS / FAIL:** _______________
**Comments:** _______________

---

## SECTION 5 — PLATFORM OWNER

### Test 25: Sign in and confirm broadest access
**Steps:**
1. Sign in with your platform owner account.
2. Visit Admin → Users, Admin → Business Rules, and Admin → Monitoring.
**Expected Result:** You can view and manage everything an Admin can, with no restrictions.
**Actual Result:** _______________
**PASS / FAIL:** _______________
**Comments:** _______________

### Test 26: Delete a task created by someone else
**Steps:**
1. Find or create a task that was created by a different user.
2. Delete it.
**Expected Result:** The deletion succeeds — as Platform Owner you're allowed to delete any task, not just your own.
**Actual Result:** _______________
**PASS / FAIL:** _______________
**Comments:** _______________

---

## SUMMARY

Total tests run: _______________
Passed: _______________
Failed: _______________
Tester name: _______________
Date: _______________

**If anything failed or looked wrong, please describe it in as much detail as possible (what page, what you clicked, what you expected vs. what happened) and pass this checklist back for review. Do not attempt to fix anything yourself.**
