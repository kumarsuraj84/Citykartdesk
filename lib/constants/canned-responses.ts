export type CannedResponse = {
  id: string
  label: string
  body: string
  category: 'greeting' | 'update' | 'resolution' | 'escalation' | 'closing'
}

export const CANNED_RESPONSES: CannedResponse[] = [
  // Greetings
  {
    id: 'greet-ack',
    label: 'Acknowledge receipt',
    category: 'greeting',
    body: "Hi, thank you for reaching out. I've received your request and will begin looking into it shortly. I'll keep you updated on the progress.",
  },
  {
    id: 'greet-review',
    label: 'Under review',
    category: 'greeting',
    body: "Hello, I'm reviewing your request now and will provide an update as soon as I have more information. Thank you for your patience.",
  },

  // Status updates
  {
    id: 'update-investigating',
    label: 'Investigating',
    category: 'update',
    body: "I'm actively investigating this issue. I'll have an update for you within the next few hours.",
  },
  {
    id: 'update-waiting-team',
    label: 'Waiting on team',
    category: 'update',
    body: "I've escalated this to the relevant team and am waiting for their response. I'll update you as soon as I hear back.",
  },
  {
    id: 'update-need-info',
    label: 'Need more information',
    category: 'update',
    body: "Could you please provide some additional information to help us resolve this faster? Specifically, it would help to know:\n\n1. \n2. \n\nThank you!",
  },
  {
    id: 'update-scheduled',
    label: 'Work scheduled',
    category: 'update',
    body: "I've scheduled the necessary work to address your request. You can expect this to be completed by [date/time]. I'll notify you once it's done.",
  },

  // Resolutions
  {
    id: 'resolve-fixed',
    label: 'Issue resolved',
    category: 'resolution',
    body: "Great news — I've resolved the issue. Please give it a try and let me know if everything is working as expected. If you have any further concerns, don't hesitate to reach out.",
  },
  {
    id: 'resolve-workaround',
    label: 'Workaround provided',
    category: 'resolution',
    body: "While we work on a permanent fix, here's a workaround that should help:\n\n[Describe workaround here]\n\nI'll follow up once the permanent solution is in place.",
  },

  // Escalation
  {
    id: 'escalate-priority',
    label: 'Escalating priority',
    category: 'escalation',
    body: "Given the impact of this issue, I'm escalating the priority of this request. Our senior team will be taking over and will reach out shortly.",
  },
  {
    id: 'escalate-vendor',
    label: 'Vendor escalation',
    category: 'escalation',
    body: "This issue requires involvement from our vendor/third-party provider. I've opened a support case with them and will keep you updated on their response.",
  },

  // Closing
  {
    id: 'close-resolved',
    label: 'Closing — resolved',
    category: 'closing',
    body: "I'm marking this request as resolved. If you experience any further issues related to this, please don't hesitate to open a new request. Thank you!",
  },
  {
    id: 'close-no-response',
    label: 'Closing — no response',
    category: 'closing',
    body: "Since we haven't heard back from you, I'm going to close this request for now. Please feel free to open a new request if you need further assistance.",
  },
]

export const CANNED_CATEGORIES = {
  greeting: 'Greeting',
  update: 'Status Update',
  resolution: 'Resolution',
  escalation: 'Escalation',
  closing: 'Closing',
} as const
