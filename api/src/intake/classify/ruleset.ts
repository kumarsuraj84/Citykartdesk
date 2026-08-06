import type { WorkType, Priority } from './types.js'

// Stage-1 default ruleset (code-defined; an org-configurable intake_rules table
// arrives in Phase E and merges over these). Keep deterministic and explainable.

export interface RuleMatch {
  anyKeywords?: string[]      // case-insensitive, word-boundary (phrases/addresses: substring)
  regex?: string              // optional pattern (case-insensitive)
  field?: 'subject' | 'text' | 'both' | 'sender' | 'all'   // default 'both'
}

export interface ClassificationRule {
  key: string                 // stable id, surfaced in evidence
  dimension: 'type' | 'department' | 'category' | 'subcategory' | 'priority'
  match: RuleMatch
  output: {
    type?: WorkType
    department?: string
    category?: string
    subcategory?: string
    priority?: Priority
  }
  weight: number              // 1–10, contributes to confidence
  isCustom?: boolean          // org-authored (intake_rules) — evaluated first and
                              // takes precedence: locks its dimension against defaults
}

// 07d: tiered sender/subject/body signals + sender-class gating + boilerplate
// stripping + entity extraction + corroboration confidence (F1–F3 redesign).
export const RULESET_VERSION = 'ruleset@2026-07d'

// ── Default rules ────────────────────────────────────────────
// IMPORTANT: department rules tag the TOPIC only — they no longer force a work
// type. Type is decided by explicit INTENT (someone is asking for something),
// otherwise the message is 'informational' (FYI/CC). This stops ordinary mail
// that merely mentions a department from being turned into a request.
export const DEFAULT_RULES: ClassificationRule[] = [
  // ----- Department + Category (TOPIC only, no type) -----
  {
    key: 'dept_payroll',
    dimension: 'department',
    match: { anyKeywords: ['salary', 'payroll', 'bonus', 'arrears', 'payslip', 'reimbursement', 'ctc', 'increment'] },
    output: { department: 'payroll', category: 'payroll' },
    weight: 8,
  },
  {
    key: 'dept_hr',
    dimension: 'department',
    match: { anyKeywords: ['leave', 'attendance', 'onboarding', 'resignation', 'appraisal', 'offer letter', 'holiday', 'pf', 'provident fund'] },
    output: { department: 'hr', category: 'hr' },
    weight: 7,
  },
  {
    key: 'dept_finance',
    dimension: 'department',
    match: { anyKeywords: ['invoice', 'payment', 'prepayment', 'billing', 'budget', 'expense', 'vendor', 'gst', 'tax', 'subscription', 'auto-renewal', 'purchase order', 'po '] },
    output: { department: 'finance', category: 'finance' },
    weight: 7,
  },
  {
    key: 'dept_it',
    dimension: 'department',
    match: { anyKeywords: ['password', 'laptop', 'access', 'vpn', 'software', 'error', 'bug', 'login', 'wifi', 'network', 'email not working', 'reset'] },
    output: { department: 'it', category: 'it_support' },
    weight: 7,
  },
  {
    key: 'dept_facilities',
    dimension: 'department',
    match: { anyKeywords: ['desk', 'seating', 'air conditioning', 'cleaning', 'maintenance', 'cafeteria', 'parking', 'washroom'] },
    output: { department: 'facilities', category: 'facilities' },
    weight: 6,
  },
  {
    key: 'dept_admin',
    dimension: 'department',
    match: { anyKeywords: ['id card', 'stationery', 'courier', 'travel', 'booking', 'visiting card'] },
    output: { department: 'admin', category: 'admin' },
    weight: 5,
  },
  {
    key: 'dept_operations',
    dimension: 'department',
    match: { anyKeywords: ['order', 'shipment', 'delivery', 'logistics', 'inventory', 'dispatch', 'supply'] },
    output: { department: 'operations', category: 'operations' },
    weight: 5,
  },
  {
    key: 'dept_legal',
    dimension: 'department',
    match: { anyKeywords: ['contract', 'agreement', 'nda', 'non-disclosure', 'compliance', 'gdpr', 'litigation', 'legal notice', 'terms and conditions', 'msa', 'sow'] },
    output: { department: 'legal', category: 'legal' },
    weight: 7,
  },
  {
    key: 'dept_procurement',
    dimension: 'department',
    match: { anyKeywords: ['procurement', 'rfq', 'rfp', 'quotation', 'tender', 'vendor onboarding', 'purchase requisition', 'supplier registration'] },
    output: { department: 'procurement', category: 'procurement' },
    weight: 7,
  },
  {
    key: 'dept_support',
    dimension: 'department',
    match: { anyKeywords: ['complaint', 'ticket', 'refund', 'return request', 'customer issue', 'grievance', 'not satisfied', 'escalation'] },
    output: { department: 'support', category: 'customer_support' },
    weight: 6,
  },
  {
    key: 'dept_sales',
    dimension: 'department',
    match: { anyKeywords: ['sales lead', 'new lead', 'deal', 'proposal', 'quote request', 'prospect', 'demo request', 'pricing enquiry', 'pricing inquiry'] },
    output: { department: 'sales', category: 'sales' },
    weight: 5,
  },
  {
    key: 'dept_marketing',
    dimension: 'department',
    match: { anyKeywords: ['campaign', 'seo', 'social media', 'branding', 'press release', 'webinar', 'event invite'] },
    output: { department: 'marketing', category: 'marketing' },
    weight: 4,
  },
  {
    key: 'dept_security',
    dimension: 'department',
    match: { anyKeywords: ['data breach', 'phishing', 'malware', 'ransomware', 'vulnerability', 'security incident', 'compromised'] },
    output: { department: 'security', category: 'security_incident', priority: 'urgent' },
    weight: 8,
  },

  // ----- IT subcategories (finer-grained than dept_it) -----
  {
    key: 'sub_it_access',
    dimension: 'subcategory',
    match: { anyKeywords: ['password', 'login', 'sign in', 'sso', 'mfa', '2fa', 'locked out', 'account access', 'permission'] },
    output: { department: 'it', category: 'it_support', subcategory: 'access' },
    weight: 6,
  },
  {
    key: 'sub_it_hardware',
    dimension: 'subcategory',
    match: { anyKeywords: ['laptop', 'desktop', 'monitor', 'keyboard', 'mouse', 'hardware', 'device', 'charger'] },
    output: { department: 'it', category: 'it_support', subcategory: 'hardware' },
    weight: 6,
  },
  {
    key: 'sub_it_network',
    dimension: 'subcategory',
    match: { anyKeywords: ['wifi', 'wi-fi', 'network', 'internet', 'connectivity', 'vpn'] },
    output: { department: 'it', category: 'it_support', subcategory: 'network' },
    weight: 6,
  },

  // ----- Sender-based signals (the From address, not the body) -----
  {
    // Automated/no-reply senders → informational notification. Weighted high
    // (8) so the automated nature of the sender beats imperative body text that
    // would otherwise mis-read a notification as a request/task (e.g. a
    // "update your tax info" billing notice from payments-noreply@). Still loses
    // to an explicit 'approve' (9) or junk 'ignore' (9) signal.
    key: 'sender_automated',
    dimension: 'type',
    match: {
      field: 'sender',
      anyKeywords: ['noreply', 'no-reply', 'no_reply', 'donotreply', 'do-not-reply', 'mailer-daemon',
        'notifications@', 'notification@', 'notify@', 'alerts@', 'alert@', 'updates@', 'automated@', 'auto@', 'system@'],
    },
    output: { type: 'informational', category: 'notification' },
    weight: 8,
  },
  {
    // Marketing/bulk senders → ignore.
    key: 'sender_bulk',
    dimension: 'type',
    match: { field: 'sender', anyKeywords: ['newsletter@', 'marketing@', 'promotions@', 'promo@', 'news@', 'campaign@'] },
    output: { type: 'ignore' },
    weight: 6,
  },

  // ----- Transactional / notification content → confident informational -----
  {
    key: 'notif_transactional',
    dimension: 'category',
    match: { anyKeywords: ['receipt', 'payment received', 'payment successful', 'has been processed', 'confirmation',
      'your order', 'order #', 'statement is ready', 'thank you for your payment', 'has been completed',
      'invoice attached', 'subscription renewed', 'auto-renewal'] },
    output: { type: 'informational', category: 'notification' },
    weight: 5,
  },
  {
    key: 'notif_security',
    dimension: 'category',
    match: { anyKeywords: ['verification code', 'one-time password', 'otp', 'security alert', 'new sign-in',
      'sign-in attempt', 'password was changed', 'suspicious activity', 'two-factor', 'security code'] },
    output: { type: 'informational', department: 'it', category: 'security_alert' },
    weight: 6,
  },

  // ----- Work type from INTENT (someone is asking for something) -----
  {
    key: 'type_approval',
    dimension: 'type',
    match: { anyKeywords: ['approve', 'approval', 'sanction', 'sign-off', 'sign off', 'authorize', 'authorized', 'authorisation', 'authorization', 'kindly approve', 'need your approval'] },
    output: { type: 'approval' },
    weight: 9,
  },
  {
    // Request = explicit ask to fulfil a service (typically another function).
    key: 'type_request',
    dimension: 'type',
    match: { anyKeywords: [
      'please process', 'kindly process', 'request for', 'requesting', 'i would like to request',
      'please arrange', 'kindly arrange', 'please issue', 'please provide', 'could you provide',
      'please share the', 'need access', 'raise a request', 'apply for', 'please grant',
      'please resolve', 'please fix', 'reset my', 'not working', 'unable to', 'need a replacement',
    ] },
    output: { type: 'request' },
    weight: 7,
  },
  {
    // Task = actionable work for the receiving team.
    key: 'type_task',
    dimension: 'type',
    match: { anyKeywords: ['please update', 'complete the', 'submit the', 'review the', 'prepare the', 'action required', 'to-do', 'follow up', 'follow-up', 'please assign', 'assign to'] },
    output: { type: 'task' },
    weight: 6,
  },
  {
    key: 'type_ignore',
    dimension: 'type',
    match: { anyKeywords: ['unsubscribe', 'newsletter', 'no-reply', 'noreply', 'out of office', 'auto-reply', 'delivery status notification', 'promotion', 'do not reply', 'this is an automated'] },
    output: { type: 'ignore' },
    weight: 9,
  },

  // ----- Priority heuristics -----
  {
    key: 'prio_urgent',
    dimension: 'priority',
    match: { anyKeywords: ['urgent', 'asap', 'critical', 'immediately', 'right away', 'emergency', 'outage', 'system down', 'not working', 'escalate', 'escalation'] },
    output: { priority: 'urgent' },
    weight: 8,
  },
  {
    key: 'prio_high',
    dimension: 'priority',
    match: { anyKeywords: ['end of day', 'eod', 'by today', 'before friday', 'by tomorrow', 'high priority', 'deadline', 'time sensitive'] },
    output: { priority: 'high' },
    weight: 5,
  },
]

// Derives the canonical taxonomy from the ruleset so every stage (rules, local
// model, premium AI) constrains its output to the SAME set of slugs. Stage 2/3
// prompts feed these lists to the model — keeps cross-stage results comparable.
export interface Taxonomy {
  departments: string[]
  categories: string[]
}

export function deriveTaxonomy(rules: ClassificationRule[] = DEFAULT_RULES): Taxonomy {
  const departments = new Set<string>()
  const categories = new Set<string>()
  for (const r of rules) {
    if (r.output.department) departments.add(r.output.department)
    if (r.output.category) categories.add(r.output.category)
  }
  return { departments: [...departments], categories: [...categories] }
}
