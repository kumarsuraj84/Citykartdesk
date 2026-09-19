'use client'

import { useState } from 'react'
import { ChevronRight, ChevronDown, BookOpen } from 'lucide-react'

type RunbookTopic = {
  id: string
  label: string
}

type RunbookSection = {
  id: string
  title: string
  topics: RunbookTopic[]
}

const sections: RunbookSection[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    topics: [
      { id: 'platform-overview', label: 'Platform Overview' },
      { id: 'role-guide', label: 'Role Guide' },
      { id: 'first-login', label: 'First Login & Profile Setup' },
    ],
  },
  {
    id: 'service-management',
    title: 'Service Management',
    topics: [
      { id: 'create-service', label: 'How to Create a Service' },
      { id: 'service-hierarchy', label: 'Service Hierarchy Setup' },
      { id: 'configure-sla', label: 'Configure SLA for a Service' },
      { id: 'assign-owners', label: 'Assign Owners and Teams' },
      { id: 'archive-service', label: 'How to Archive a Service' },
    ],
  },
  {
    id: 'workflow-configuration',
    title: 'Workflow Configuration',
    topics: [
      { id: 'create-approval-workflow', label: 'Create an Approval Workflow' },
      { id: 'add-approval-steps', label: 'Add Approval Steps' },
      { id: 'bind-workflow', label: 'Bind Workflow to a Service' },
      { id: 'routing-rules', label: 'Configure Routing Rules' },
    ],
  },
  {
    id: 'sla-escalation',
    title: 'SLA & Escalation',
    topics: [
      { id: 'business-hours', label: 'Set Up Business Hours' },
      { id: 'holiday-calendar', label: 'Add Holiday Calendar' },
      { id: 'escalation-rules', label: 'Configure Escalation Rules' },
      { id: 'sla-tiers', label: 'Set SLA Tiers' },
    ],
  },
  {
    id: 'team-user-management',
    title: 'Team & User Management',
    topics: [
      { id: 'create-team', label: 'How to Create a Team' },
      { id: 'add-team-members', label: 'Add Team Members' },
      { id: 'change-user-roles', label: 'Change User Roles' },
      { id: 'deactivate-user', label: 'Deactivate a User' },
    ],
  },
  {
    id: 'task-management',
    title: 'Task Management',
    topics: [
      { id: 'task-templates', label: 'Create Task Templates' },
      { id: 'task-statuses', label: 'Configure Task Statuses' },
      { id: 'task-priorities', label: 'Set Up Task Priorities' },
    ],
  },
  {
    id: 'reports-exports',
    title: 'Reports & Exports',
    topics: [
      { id: 'export-csv', label: 'How to Export to CSV' },
      { id: 'scheduled-reports', label: 'Set Up Scheduled Reports' },
      { id: 'audit-log', label: 'How to Read the Audit Log' },
    ],
  },
  {
    id: 'platform-settings',
    title: 'Platform Settings',
    topics: [
      { id: 'auto-close', label: 'Configure Auto-Close' },
      { id: 'data-retention', label: 'Set Data Retention' },
      { id: 'email-smtp', label: 'Wire Up Email (Google Workspace SMTP)' },
      { id: 'email-resend', label: 'Wire Up Email (Resend)' },
      { id: 'cron-jobs', label: 'Set Up Cron Jobs' },
    ],
  },
]

// ─── Content ────────────────────────────────────────────────────────────────

const content: Record<string, React.ReactNode> = {
  'platform-overview': (
    <article className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
      <h2>Platform Overview</h2>
      <p>
        Citykart Desk is an internal service management platform that connects employees with the teams
        that support them — IT, HR, Finance, Legal, and beyond. It provides a unified portal for
        submitting requests, a workbench for agents to resolve them, and an admin layer for
        configuring services, SLAs, and workflows.
      </p>
      <h3>Core Concepts</h3>
      <ul>
        <li>
          <strong>Services</strong> — the catalogue of things employees can request (e.g. &quot;Laptop
          Setup&quot;, &quot;New Hire Onboarding&quot;, &quot;Expense Reimbursement&quot;).
        </li>
        <li>
          <strong>Requests</strong> — an instance of an employee asking for a service. Each request
          has a status lifecycle (Open → In Progress → Resolved → Closed).
        </li>
        <li>
          <strong>Workflows</strong> — optional approval chains that gate a request before an agent
          works on it.
        </li>
        <li>
          <strong>SLAs</strong> — time-bound commitments for response and resolution, attached to
          services or request priorities.
        </li>
        <li>
          <strong>Tasks</strong> — sub-items that agents create within a request to track
          work items.
        </li>
      </ul>
      <div className="not-prose rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/40">
        <p className="text-sm font-medium text-blue-800 dark:text-blue-300">Note</p>
        <p className="mt-1 text-sm text-blue-700 dark:text-blue-400">
          All data is scoped to your organisation. No data crosses tenant boundaries.
        </p>
      </div>
    </article>
  ),

  'role-guide': (
    <article className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
      <h2>Role Guide</h2>
      <p>Citykart Desk has four built-in roles. Each controls what a user can see and do.</p>
      <h3>Requester</h3>
      <p>
        The default role. Requesters can browse the service catalogue, submit requests, track their
        own requests, and leave comments. They cannot see other users&apos; requests or admin pages.
      </p>
      <h3>Technician</h3>
      <p>
        Technicians are support staff. They see the full request queue for their assigned teams, can
        update statuses, add internal notes, manage tasks, and run SLA actions. They cannot change
        platform configuration.
      </p>
      <h3>Manager</h3>
      <p>
        Managers have all technician capabilities plus read access to admin reports, team management,
        and approval flow configuration. They can assign technicians but cannot change global platform
        settings.
      </p>
      <h3>Admin</h3>
      <p>
        Admins have full access — service catalogue, workflows, SLA configuration, user management,
        system settings, and audit logs.
      </p>
      <div className="not-prose rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
        <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Important</p>
        <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
          Role changes take effect immediately. The user does not need to log out and back in.
        </p>
      </div>
    </article>
  ),

  'first-login': (
    <article className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
      <h2>First Login &amp; Profile Setup</h2>
      <ol>
        <li>
          Navigate to your Citykart Desk URL and click <strong>Sign in with Google</strong> (or SSO
          provider configured by your admin).
        </li>
        <li>
          On first login, Citykart Desk creates your profile automatically using your email and display
          name from the identity provider.
        </li>
        <li>
          Go to <strong>Profile → Edit Profile</strong> to set your department, phone number, and
          avatar.
        </li>
        <li>
          Check <strong>Notifications → Preferences</strong> and choose which events should trigger
          in-app and email notifications.
        </li>
        <li>
          If you are an agent, confirm with your admin that you have been added to the correct
          team(s) — this determines which requests appear in your queue.
        </li>
      </ol>
      <div className="not-prose rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/40">
        <p className="text-sm font-medium text-blue-800 dark:text-blue-300">Tip</p>
        <p className="mt-1 text-sm text-blue-700 dark:text-blue-400">
          If your account was created by an admin before your first login, your role and team
          assignment will already be set when you arrive.
        </p>
      </div>
    </article>
  ),

  'create-service': (
    <article className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
      <h2>How to Create a Service</h2>
      <ol>
        <li>
          Go to <strong>Admin → Services</strong>.
        </li>
        <li>
          Click <strong>New Service</strong> in the top-right corner.
        </li>
        <li>
          Enter a <strong>Name</strong> (visible to employees) and a short <strong>Description</strong>.
        </li>
        <li>
          Select the <strong>Category</strong> this service belongs to. If none exists yet, create
          one first under <strong>Admin → Categories</strong>.
        </li>
        <li>
          Set the <strong>Visibility</strong>:{' '}
          <code>Public</code> (all employees) or <code>Restricted</code> (specific teams/groups).
        </li>
        <li>
          Optionally add a <strong>Custom Form</strong> by attaching field definitions. These
          appear on the request submission page.
        </li>
        <li>
          Set the <strong>Default Priority</strong> for requests created under this service.
        </li>
        <li>
          Click <strong>Save</strong>. The service is now live in the catalogue.
        </li>
      </ol>
    </article>
  ),

  'service-hierarchy': (
    <article className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
      <h2>Service Hierarchy Setup</h2>
      <p>Services are organised in a three-level hierarchy:</p>
      <pre>
        <code>{`Category
  └── Sub-category
        └── Service`}</code>
      </pre>
      <h3>Step 1 — Create Categories</h3>
      <ol>
        <li>Go to <strong>Admin → Categories</strong>.</li>
        <li>Click <strong>New Category</strong>.</li>
        <li>Enter a name (e.g. &quot;IT&quot;, &quot;HR&quot;, &quot;Finance&quot;) and an optional icon.</li>
        <li>Save.</li>
      </ol>
      <h3>Step 2 — Create Sub-categories</h3>
      <ol>
        <li>In the same Categories page, select a parent category.</li>
        <li>Click <strong>Add Sub-category</strong>.</li>
        <li>Enter the sub-category name (e.g. &quot;Hardware&quot; under &quot;IT&quot;).</li>
        <li>Save.</li>
      </ol>
      <h3>Step 3 — Attach Services</h3>
      <ol>
        <li>Go to <strong>Admin → Services → New Service</strong> (or edit an existing one).</li>
        <li>In the <strong>Category</strong> selector, choose the sub-category.</li>
        <li>Save the service.</li>
      </ol>
    </article>
  ),

  'configure-sla': (
    <article className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
      <h2>Configure SLA for a Service</h2>
      <ol>
        <li>Go to <strong>Admin → Services</strong> and open the service you want to configure.</li>
        <li>Click the <strong>SLA</strong> tab.</li>
        <li>
          Set <strong>First Response Time</strong> — the maximum time before an agent must
          acknowledge the request.
        </li>
        <li>
          Set <strong>Resolution Time</strong> — the maximum time before the request must be
          closed.
        </li>
        <li>
          Choose whether the SLA clock runs on <strong>Business Hours</strong> or{' '}
          <strong>Calendar Hours</strong>.
        </li>
        <li>
          Optionally override SLA by <strong>Priority</strong> — e.g. Critical requests get a
          shorter window than Low.
        </li>
        <li>Save.</li>
      </ol>
      <div className="not-prose rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/40">
        <p className="text-sm font-medium text-blue-800 dark:text-blue-300">Note</p>
        <p className="mt-1 text-sm text-blue-700 dark:text-blue-400">
          The SLA clock starts when a request is submitted and pauses when it enters a &quot;Pending
          Customer&quot; status.
        </p>
      </div>
    </article>
  ),

  'assign-owners': (
    <article className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
      <h2>Assign Owners and Teams to a Service</h2>
      <ol>
        <li>Open the service in <strong>Admin → Services</strong>.</li>
        <li>Click the <strong>Ownership</strong> tab.</li>
        <li>
          In <strong>Owning Team</strong>, select the team responsible for fulfilling requests
          under this service.
        </li>
        <li>
          Optionally set a <strong>Service Owner</strong> — a specific agent who is the point of
          contact for escalations.
        </li>
        <li>Save.</li>
      </ol>
      <p>
        When a request is submitted, it is automatically routed to the owning team&apos;s queue unless a
        more specific routing rule overrides it.
      </p>
    </article>
  ),

  'archive-service': (
    <article className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
      <h2>How to Archive a Service</h2>
      <ol>
        <li>Go to <strong>Admin → Services</strong>.</li>
        <li>Open the service you want to retire.</li>
        <li>
          Scroll to the bottom and click <strong>Archive Service</strong>.
        </li>
        <li>Confirm the action in the modal.</li>
      </ol>
      <div className="not-prose rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
        <p className="text-sm font-medium text-amber-800 dark:text-amber-300">What archiving does</p>
        <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
          Archived services are hidden from the employee catalogue. Existing open requests are not
          affected. Archiving is reversible — you can restore a service at any time from the
          Archived tab.
        </p>
      </div>
    </article>
  ),

  'create-approval-workflow': (
    <article className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
      <h2>Create an Approval Workflow</h2>
      <ol>
        <li>Go to <strong>Admin → Approval Flows</strong>.</li>
        <li>Click <strong>New Workflow</strong>.</li>
        <li>Give the workflow a descriptive name (e.g. &quot;Procurement Approval&quot;).</li>
        <li>
          Set <strong>Trigger</strong>: when should this workflow run?{' '}
          <code>On Submit</code> (blocks the request until approved) or{' '}
          <code>On Status Change</code>.
        </li>
        <li>Add one or more approval steps (see next section).</li>
        <li>
          Set the <strong>Rejection Action</strong>: reject the request outright, or return it to
          the submitter for revision.
        </li>
        <li>Save.</li>
      </ol>
    </article>
  ),

  'add-approval-steps': (
    <article className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
      <h2>Add Approval Steps</h2>
      <p>Each workflow consists of one or more sequential approval steps.</p>
      <ol>
        <li>Inside a workflow, click <strong>Add Step</strong>.</li>
        <li>
          Choose the <strong>Approver Type</strong>:
          <ul>
            <li><code>Specific User</code> — name a single approver.</li>
            <li><code>Team</code> — any member of a team can approve.</li>
            <li><code>Manager</code> — the requester&apos;s direct manager is resolved at runtime.</li>
            <li><code>Role</code> — any user with the given role can approve.</li>
          </ul>
        </li>
        <li>
          Set <strong>Approval Threshold</strong>:{' '}
          <code>Any One</code> or <code>All Approvers</code> (for team/role approvers).
        </li>
        <li>
          Set a <strong>Due In</strong> window — how long an approver has before the step escalates.
        </li>
        <li>Repeat for each step. Steps execute in the order listed.</li>
        <li>Save the workflow.</li>
      </ol>
    </article>
  ),

  'bind-workflow': (
    <article className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
      <h2>Bind a Workflow to a Service</h2>
      <ol>
        <li>Open the service in <strong>Admin → Services</strong>.</li>
        <li>Click the <strong>Workflow</strong> tab.</li>
        <li>
          In the <strong>Approval Workflow</strong> selector, choose the workflow you created.
        </li>
        <li>Save the service.</li>
      </ol>
      <p>
        From this point, any new request submitted against this service will automatically enter
        the approval workflow before reaching the agent queue.
      </p>
      <div className="not-prose rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/40">
        <p className="text-sm font-medium text-blue-800 dark:text-blue-300">Note</p>
        <p className="mt-1 text-sm text-blue-700 dark:text-blue-400">
          Existing open requests are not retroactively affected when you bind or unbind a workflow.
        </p>
      </div>
    </article>
  ),

  'routing-rules': (
    <article className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
      <h2>Configure Auto-Assignment (Business Rules)</h2>
      <p>
        Auto-assignment now lives under <strong>Business Rules</strong> — it replaced the old
        standalone Routing Rules screen so assignment, priority/status changes, and notifications
        are all configured in one place.
      </p>
      <ol>
        <li>Go to <strong>Admin → Business Rules</strong>.</li>
        <li>Click <strong>New Rule</strong>.</li>
        <li>Set <strong>Execute when a request is</strong> to <code>Created</code>.</li>
        <li>
          Add <strong>Conditions</strong> — one or more field/operator/value matches, all ANDed:
          <ul>
            <li>Service, Service Group, or Service Sub Group is…</li>
            <li>Priority or Status is…</li>
            <li>Team or Requester is…</li>
            <li>Title/Description contains…</li>
          </ul>
        </li>
        <li>
          Add an <strong>Assign</strong> action: choose Direct (a specific agent), Round-robin, or
          Load-balanced (fewest open requests), and pick the candidate agent(s).
        </li>
        <li>
          Set <strong>Execution order</strong> — lower runs first; a later matching rule&apos;s
          action can override an earlier one.
        </li>
        <li>Save.</li>
      </ol>
      <div className="not-prose rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
        <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Rule evaluation order</p>
        <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
          Every active rule whose conditions match runs, in ascending execution order — not just
          the first match. If no rule assigns the request, it&apos;s left unassigned for the
          owning team to pick up.
        </p>
      </div>
    </article>
  ),

  'business-hours': (
    <article className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
      <h2>Set Up Business Hours</h2>
      <ol>
        <li>Go to <strong>Admin → Request Config → Business Hours</strong>.</li>
        <li>Click <strong>New Schedule</strong>.</li>
        <li>Name the schedule (e.g. &quot;Standard 9–5 EST&quot;).</li>
        <li>
          For each day of the week, toggle it on/off and set the open and close times.
        </li>
        <li>Select the <strong>Timezone</strong> this schedule runs in.</li>
        <li>Save.</li>
        <li>
          Assign this schedule to one or more services via <strong>Admin → Services → SLA tab</strong>.
        </li>
      </ol>
    </article>
  ),

  'holiday-calendar': (
    <article className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
      <h2>Add a Holiday Calendar</h2>
      <ol>
        <li>Go to <strong>Admin → Request Config → Holiday Calendars</strong>.</li>
        <li>Click <strong>New Calendar</strong>.</li>
        <li>Name it (e.g. &quot;US Federal Holidays 2026&quot;).</li>
        <li>
          Click <strong>Add Date</strong> to add each holiday. Enter a date and an optional label.
        </li>
        <li>Save the calendar.</li>
        <li>
          Link the calendar to a Business Hours schedule: open the schedule and select this
          calendar in the <strong>Holiday Calendar</strong> field.
        </li>
      </ol>
      <p>
        On holiday dates, the SLA clock treats the day as if the office is closed, regardless of
        the day-of-week schedule.
      </p>
    </article>
  ),

  'escalation-rules': (
    <article className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
      <h2>Configure SLA Escalation (Business Rules)</h2>
      <p>
        SLA escalation now lives under <strong>Business Rules</strong> — it replaced the old
        standalone Escalation Rules screen.
      </p>
      <ol>
        <li>Go to <strong>Admin → Business Rules</strong>.</li>
        <li>Click <strong>New Rule</strong>.</li>
        <li>Set <strong>Execute when a request is</strong> to <code>On a schedule</code>.</li>
        <li>
          Set the schedule check:
          <ul>
            <li><code>% of SLA elapsed</code> — fires once a request crosses the threshold you set (e.g. 80%).</li>
            <li><code>Unassigned for N minutes</code> — fires once an unassigned request has waited that long.</li>
          </ul>
        </li>
        <li>Optionally add a <strong>Priority is…</strong> condition to scope the rule to one tier.</li>
        <li>
          Add a <strong>Notify</strong> action: choose roles and/or the assignee/requester, and
          in-app and/or email delivery.
        </li>
        <li>Save.</li>
      </ol>
      <div className="not-prose rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/40">
        <p className="text-sm font-medium text-blue-800 dark:text-blue-300">Note</p>
        <p className="mt-1 text-sm text-blue-700 dark:text-blue-400">
          Schedule-trigger rules fire via the <code>/api/business-rules/run</code> cron job.
          Confirm it&apos;s registered in your deployment&apos;s <code>CRON_JOBS</code> (see
          docs/RAILWAY-DEPLOYMENT.md).
        </p>
      </div>
    </article>
  ),

  'sla-tiers': (
    <article className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
      <h2>Set SLA Tiers</h2>
      <p>
        SLA tiers let you define named SLA policies that can be reused across multiple services
        rather than configuring SLA per service individually.
      </p>
      <ol>
        <li>Go to <strong>Admin → Request Config → SLA Tiers</strong>.</li>
        <li>Click <strong>New Tier</strong>.</li>
        <li>
          Name the tier (e.g. &quot;Gold&quot;, &quot;Silver&quot;, &quot;Bronze&quot;) and set response and resolution
          targets for each priority level.
        </li>
        <li>Save.</li>
        <li>
          When configuring a service SLA, select this tier instead of entering times manually.
        </li>
      </ol>
    </article>
  ),

  'create-team': (
    <article className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
      <h2>How to Create a Team</h2>
      <ol>
        <li>Go to <strong>Admin → Teams</strong>.</li>
        <li>Click <strong>New Team</strong>.</li>
        <li>Enter a <strong>Team Name</strong> (e.g. &quot;IT Support&quot;, &quot;HR Ops&quot;).</li>
        <li>Select a <strong>Team Lead</strong> from the user list.</li>
        <li>Optionally add a <strong>Description</strong> and a <strong>Colour</strong> for UI labelling.</li>
        <li>Save.</li>
      </ol>
      <p>
        The team is now available to be assigned to services and routing rules, and to be used as
        an approver group in workflows.
      </p>
    </article>
  ),

  'add-team-members': (
    <article className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
      <h2>Add Team Members</h2>
      <ol>
        <li>Go to <strong>Admin → Teams</strong> and open the team.</li>
        <li>Click the <strong>Members</strong> tab.</li>
        <li>Click <strong>Add Member</strong>.</li>
        <li>Search for the user by name or email and select them.</li>
        <li>Click <strong>Add</strong>.</li>
      </ol>
      <p>
        Members immediately gain access to the team&apos;s request queue. There is no limit on the
        number of members per team.
      </p>
    </article>
  ),

  'change-user-roles': (
    <article className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
      <h2>Change User Roles</h2>
      <ol>
        <li>Go to <strong>Admin → Users</strong>.</li>
        <li>Find the user using the search bar.</li>
        <li>Click on the user to open their profile.</li>
        <li>
          In the <strong>Role</strong> field, select the new role:{' '}
          <code>user</code> (Requester), <code>agent</code> (Technician), <code>manager</code>, or <code>admin</code>.
        </li>
        <li>Click <strong>Save Changes</strong>.</li>
      </ol>
      <div className="not-prose rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
        <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Important</p>
        <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
          Only Admins can assign the Admin role. Managers can promote Requesters to Technician but cannot
          grant Manager or Admin.
        </p>
      </div>
    </article>
  ),

  'deactivate-user': (
    <article className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
      <h2>Deactivate a User</h2>
      <ol>
        <li>Go to <strong>Admin → Users</strong> and open the user&apos;s profile.</li>
        <li>Scroll to the bottom and click <strong>Deactivate Account</strong>.</li>
        <li>Confirm in the dialog.</li>
      </ol>
      <div className="not-prose rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
        <p className="text-sm font-medium text-amber-800 dark:text-amber-300">What deactivation does</p>
        <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
          The user cannot log in. Their historical data (requests, comments, audit entries) is
          preserved. Any open requests assigned to them remain open and should be reassigned
          manually. Deactivation is reversible.
        </p>
      </div>
    </article>
  ),

  'task-templates': (
    <article className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
      <h2>Create Task Templates</h2>
      <p>
        Task templates let you predefine a checklist of tasks that should be created whenever a
        request is submitted for a specific service.
      </p>
      <ol>
        <li>Go to <strong>Admin → Task Config → Task Templates</strong>.</li>
        <li>Click <strong>New Template</strong>.</li>
        <li>Name the template (e.g. &quot;New Employee Onboarding Checklist&quot;).</li>
        <li>
          Click <strong>Add Task</strong> to add each task item. For each task, set:
          <ul>
            <li>Title</li>
            <li>Optional description</li>
            <li>Default assignee (team or role)</li>
            <li>Default due offset (e.g. &quot;+2 business days from request creation&quot;)</li>
          </ul>
        </li>
        <li>Save.</li>
        <li>
          Attach the template to a service via <strong>Admin → Services → Tasks tab</strong>.
        </li>
      </ol>
    </article>
  ),

  'task-statuses': (
    <article className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
      <h2>Configure Task Statuses</h2>
      <ol>
        <li>Go to <strong>Admin → Task Config → Statuses</strong>.</li>
        <li>
          The default statuses are <code>Open</code>, <code>In Progress</code>, and{' '}
          <code>Done</code>. You can add custom statuses by clicking <strong>New Status</strong>.
        </li>
        <li>Enter a name and choose a colour for the status badge.</li>
        <li>
          Mark whether the status counts as a <strong>terminal state</strong> (i.e. the task is
          complete when it reaches this status).
        </li>
        <li>Save.</li>
      </ol>
    </article>
  ),

  'task-priorities': (
    <article className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
      <h2>Set Up Task Priorities</h2>
      <ol>
        <li>Go to <strong>Admin → Task Config → Priorities</strong>.</li>
        <li>The system ships with <code>Low</code>, <code>Medium</code>, <code>High</code>, and <code>Critical</code>.</li>
        <li>Click a priority to edit its colour or label.</li>
        <li>Click <strong>New Priority</strong> to add a custom level.</li>
        <li>Use the drag handle to reorder priorities from lowest to highest.</li>
        <li>Save.</li>
      </ol>
    </article>
  ),

  'export-csv': (
    <article className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
      <h2>How to Export to CSV</h2>
      <ol>
        <li>Go to <strong>Admin → Reports</strong>.</li>
        <li>Select the report type: <em>Requests</em>, <em>SLA Performance</em>, or <em>Technician Activity</em>.</li>
        <li>Apply date range and any filters (service, team, status, priority).</li>
        <li>
          Click <strong>Export CSV</strong>. The file downloads immediately in your browser.
        </li>
      </ol>
      <div className="not-prose rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/40">
        <p className="text-sm font-medium text-blue-800 dark:text-blue-300">Tip</p>
        <p className="mt-1 text-sm text-blue-700 dark:text-blue-400">
          Exports are limited to 50,000 rows. For larger datasets, use the scheduled report feature
          or export multiple smaller date ranges.
        </p>
      </div>
    </article>
  ),

  'scheduled-reports': (
    <article className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
      <h2>Set Up Scheduled Reports</h2>
      <ol>
        <li>Go to <strong>Admin → Reports → Scheduled</strong>.</li>
        <li>Click <strong>New Scheduled Report</strong>.</li>
        <li>Select the report type and configure filters (same as manual export).</li>
        <li>
          Set the <strong>Frequency</strong>: Daily, Weekly (pick day), or Monthly (pick date).
        </li>
        <li>
          Enter one or more <strong>Recipient Emails</strong>. These do not need to be Citykart Desk
          users.
        </li>
        <li>Set the delivery time and timezone.</li>
        <li>Save and toggle the schedule <strong>Active</strong>.</li>
      </ol>
      <p>
        Recipients will receive an email with the CSV attached at each scheduled time.
      </p>
    </article>
  ),

  'audit-log': (
    <article className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
      <h2>How to Read the Audit Log</h2>
      <p>
        The audit log records every meaningful action taken in Citykart Desk — who did what, to which
        record, and when.
      </p>
      <ol>
        <li>Go to <strong>Admin → Audit Log</strong>.</li>
        <li>Use the filters to narrow by actor, action type, record type, or date range.</li>
        <li>Click any row to expand the full diff (before/after values).</li>
      </ol>
      <h3>Common action types</h3>
      <ul>
        <li><code>request.created</code> — a new request was submitted.</li>
        <li><code>request.status_changed</code> — a status transition occurred.</li>
        <li><code>request.assigned</code> — the request was assigned or reassigned.</li>
        <li><code>approval.approved</code> / <code>approval.rejected</code> — an approval step was actioned.</li>
        <li><code>user.role_changed</code> — an admin changed a user&apos;s role.</li>
        <li><code>service.archived</code> — a service was archived.</li>
      </ul>
      <div className="not-prose rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/40">
        <p className="text-sm font-medium text-blue-800 dark:text-blue-300">Retention</p>
        <p className="mt-1 text-sm text-blue-700 dark:text-blue-400">
          Audit log entries are retained according to your Data Retention policy (see Platform
          Settings). The default is 2 years.
        </p>
      </div>
    </article>
  ),

  'auto-close': (
    <article className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
      <h2>Configure Auto-Close</h2>
      <p>
        Auto-close automatically moves resolved requests to Closed status after a configurable
        inactivity period.
      </p>
      <ol>
        <li>Go to <strong>Admin → Settings → Automation</strong>.</li>
        <li>Enable <strong>Auto-Close Resolved Requests</strong>.</li>
        <li>
          Set the <strong>Inactivity Window</strong> — e.g. <code>72 hours</code> after a request
          enters Resolved status with no new activity.
        </li>
        <li>
          Optionally enable <strong>Notify Requester Before Close</strong> — sends a warning email
          24 hours before auto-close fires.
        </li>
        <li>Save.</li>
      </ol>
    </article>
  ),

  'data-retention': (
    <article className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
      <h2>Set Data Retention</h2>
      <ol>
        <li>Go to <strong>Admin → Settings → Data &amp; Privacy</strong>.</li>
        <li>
          Set retention periods for each data class:
          <ul>
            <li><strong>Closed Requests</strong> — default 7 years.</li>
            <li><strong>Audit Log</strong> — default 2 years.</li>
            <li><strong>Notifications</strong> — default 90 days.</li>
            <li><strong>Attachments</strong> — default 3 years.</li>
          </ul>
        </li>
        <li>Save.</li>
      </ol>
      <div className="not-prose rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
        <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Warning</p>
        <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
          Reducing a retention period will cause the nightly purge job to permanently delete data
          that falls outside the new window. This action cannot be undone. Consult your legal or
          compliance team before lowering retention periods.
        </p>
      </div>
    </article>
  ),

  'email-smtp': (
    <article className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
      <h2>Wire Up Email (Google Workspace SMTP)</h2>
      <p>
        Send every notification email straight through a Google Workspace mailbox — no third-party
        email service. Replies to notifications land in that mailbox.
      </p>
      <ol>
        <li>
          Create the mailbox in Google Workspace, e.g. <code>citykartdesk@citykartstores.com</code>.
        </li>
        <li>
          Sign in to that account, turn on <strong>2-Step Verification</strong>, then
          {' '}<strong>Security → App passwords</strong> and create one named &quot;Citykart Desk&quot;. Copy the
          16-character password. (If App passwords is missing, a Workspace admin must allow it.)
        </li>
        <li>
          On the server, add these lines to the app&apos;s <code>.env.local</code> and restart the app:
          <pre>
            <code>{'SMTP_HOST=smtp.gmail.com\nSMTP_PORT=587\nSMTP_USER=citykartdesk@citykartstores.com\nSMTP_PASS=<the app password>'}</code>
          </pre>
          The password lives only on the server — never in the database or in git.
        </li>
        <li>
          Go to <strong>Admin → Platform Settings → Integrations → Email Sending</strong>. Delivery should show
          as configured. Set the <strong>Display name</strong> and use <strong>Send a test email</strong> to confirm.
        </li>
      </ol>
      <p>
        Notes: Google only lets a mailbox send as itself, so the sender address is always the SMTP user. A
        Workspace mailbox has a daily sending limit (about 2,000 messages). Prefer no password? Use Google&apos;s SMTP
        relay (<code>smtp-relay.gmail.com</code>) allow-listed by the server&apos;s IP and leave <code>SMTP_PASS</code> unset.
      </p>
    </article>
  ),

  'email-resend': (
    <article className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
      <h2>Wire Up Email (Resend)</h2>
      <p>Citykart Desk uses Resend to send transactional emails. You need a Resend account and a verified sending domain.</p>
      <ol>
        <li>
          Sign up at{' '}
          <code>https://resend.com</code> and verify your domain by adding the DNS records Resend
          provides.
        </li>
        <li>
          In the Resend dashboard, go to <strong>API Keys → Create API Key</strong>. Give it a
          name (e.g. &quot;Citykart Desk Production&quot;) and copy the key.
        </li>
        <li>
          In your deployment environment, set the following environment variable:
          <pre>
            <code>RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx</code>
          </pre>
        </li>
        <li>
          Go to <strong>Admin → Settings → Email</strong> and set:
          <ul>
            <li><strong>From Address</strong> — e.g. <code>support@yourdomain.com</code></li>
            <li><strong>From Name</strong> — e.g. <code>Citykart Desk Support</code></li>
          </ul>
        </li>
        <li>
          Click <strong>Send Test Email</strong> to verify the connection.
        </li>
        <li>Save.</li>
      </ol>
    </article>
  ),

  'cron-jobs': (
    <article className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
      <h2>Set Up Cron Jobs</h2>
      <p>
        Citykart Desk has several background jobs that must run on a schedule for SLA timers,
        escalations, auto-close, and scheduled reports to work.
      </p>
      <h3>Jobs and their schedules</h3>
      <div className="not-prose overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="py-2 pr-4 text-left font-semibold">Job</th>
              <th className="py-2 pr-4 text-left font-semibold">Recommended Schedule</th>
              <th className="py-2 text-left font-semibold">Purpose</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            <tr>
              <td className="py-2 pr-4 font-mono text-xs">/api/cron/sla-check</td>
              <td className="py-2 pr-4">Every 5 minutes</td>
              <td className="py-2">Evaluate SLA breaches and fire escalations</td>
            </tr>
            <tr>
              <td className="py-2 pr-4 font-mono text-xs">/api/cron/auto-close</td>
              <td className="py-2 pr-4">Every hour</td>
              <td className="py-2">Close resolved requests past the inactivity window</td>
            </tr>
            <tr>
              <td className="py-2 pr-4 font-mono text-xs">/api/cron/scheduled-reports</td>
              <td className="py-2 pr-4">Daily at 06:00 UTC</td>
              <td className="py-2">Generate and email scheduled reports</td>
            </tr>
            <tr>
              <td className="py-2 pr-4 font-mono text-xs">/api/cron/purge</td>
              <td className="py-2 pr-4">Daily at 02:00 UTC</td>
              <td className="py-2">Delete data outside retention windows</td>
            </tr>
          </tbody>
        </table>
      </div>
      <h3>Setting up on Vercel</h3>
      <ol>
        <li>
          In your <code>vercel.json</code>, add a <code>crons</code> block:
          <pre>
            <code>{`{
  "crons": [
    { "path": "/api/cron/sla-check",        "schedule": "*/5 * * * *" },
    { "path": "/api/cron/auto-close",        "schedule": "0 * * * *" },
    { "path": "/api/cron/scheduled-reports", "schedule": "0 6 * * *" },
    { "path": "/api/cron/purge",             "schedule": "0 2 * * *" }
  ]
}`}</code>
          </pre>
        </li>
        <li>Deploy. Vercel will register the crons automatically.</li>
        <li>
          Protect the endpoints with a shared secret. Set the environment variable:
          <pre>
            <code>CRON_SECRET=your-secret-here</code>
          </pre>
          Each cron route should verify the <code>Authorization: Bearer {'{CRON_SECRET}'}</code>{' '}
          header.
        </li>
      </ol>
      <h3>Setting up on other platforms</h3>
      <p>
        Use any external cron service (e.g. cron-job.org, GitHub Actions schedule, EasyCron) to
        send an HTTP GET request to each endpoint on the schedules above, passing the
        Authorization header.
      </p>
    </article>
  ),
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function RunbooksClient() {
  const [openSections, setOpenSections] = useState<Set<string>>(
    new Set([sections[0].id]),
  )
  const [activeTopic, setActiveTopic] = useState<string>(sections[0].topics[0].id)

  function toggleSection(id: string) {
    setOpenSections((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function selectTopic(sectionId: string, topicId: string) {
    setOpenSections((prev) => new Set([...prev, sectionId]))
    setActiveTopic(topicId)
  }

  const activeContent = content[activeTopic]

  return (
    <div className="flex h-full min-h-[calc(100vh-4rem)] divide-x divide-border">
      {/* Sidebar */}
      <nav className="w-64 shrink-0 overflow-y-auto py-4 pl-6 pr-4">
        <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          <BookOpen className="h-3.5 w-3.5" />
          Runbooks
        </p>
        <ul className="space-y-1">
          {sections.map((section) => {
            const isOpen = openSections.has(section.id)
            return (
              <li key={section.id}>
                <button
                  onClick={() => toggleSection(section.id)}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm font-medium text-foreground hover:bg-accent"
                >
                  {section.title}
                  {isOpen ? (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </button>
                {isOpen && (
                  <ul className="ml-2 mt-0.5 space-y-0.5 border-l border-border pl-3">
                    {section.topics.map((topic) => (
                      <li key={topic.id}>
                        <button
                          onClick={() => selectTopic(section.id, topic.id)}
                          className={`w-full rounded-md px-2 py-1 text-left text-sm transition-colors ${
                            activeTopic === topic.id
                              ? 'bg-primary/10 font-medium text-primary'
                              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                          }`}
                        >
                          {topic.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Content */}
      <main className="min-w-0 flex-1 overflow-y-auto px-10 py-6">
        {activeContent ?? (
          <p className="text-sm text-muted-foreground">Select a topic from the sidebar.</p>
        )}
      </main>
    </div>
  )
}
