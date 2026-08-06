// Provider-agnostic classification contract.
//
// Every stage of the pipeline — Stage 1 (rules), Stage 2 (local models:
// Qwen/Llama/Mistral), Stage 3 (premium AI: Claude/GPT) — implements the SAME
// Classifier interface and returns the SAME ClassificationResult shape. The
// orchestrator is provider-blind; adding a stage never touches the orchestrator,
// the schema, or the API.

// request      = needs another function/department to fulfil a service (rare)
// task         = actionable work for the receiving team itself
// approval     = explicit sign-off / authorization ask
// informational = legitimate FYI / CC / notification — no work, just awareness
// ignore       = junk: newsletter, auto-reply, no-reply, promotion, spam
export type WorkType = 'request' | 'task' | 'approval' | 'informational' | 'ignore'
export type Priority = 'low' | 'medium' | 'high' | 'urgent'
export type Stage    = 'rule' | 'local_model' | 'premium_ai'

// Channel-agnostic AND provider-agnostic input. Email populates it today;
// WhatsApp/Slack/Teams populate the same shape later with zero engine changes.
export interface IntakeEnvelope {
  subject: string | null
  text: string                 // normalized body (signatures/quotes stripped)
  sender: string | null        // email / phone / handle — channel-dependent
  channelType: string          // 'email' | 'whatsapp' | ...
  recipientType?: 'to' | 'cc' | 'bcc'  // was the inbox directly TO'd or CC'd?
  metadata?: Record<string, unknown>
}

export interface ClassificationResult {
  suggestedType: WorkType
  suggestedDepartment: string | null   // canonical slug
  suggestedCategory: string | null     // canonical slug
  suggestedSubcategory: string | null  // canonical slug
  suggestedPriority: Priority
  confidence: number                   // 0–100
  evidence: Record<string, unknown>    // native explanation (rule matches | model output)
  rationale: string
  entities?: Record<string, unknown>
  costMicrocents?: number              // estimated spend for this call (rules = 0)
}

// The single contract every stage implements.
export interface Classifier {
  readonly stage: Stage
  readonly provider: string            // 'rule_engine' | 'qwen2.5' | 'claude' | ...
  readonly modelVersion: string
  classify(env: IntakeEnvelope): Promise<ClassificationResult>
}
