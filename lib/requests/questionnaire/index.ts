// Channel-neutral ticket questionnaire/draft engine — see STAGE_3_REPORT.md.
// Deliberately not named after any channel: this drives Service -> issue
// search -> Sub-category -> auto Category -> Description -> auto Subject ->
// remaining mandatory fields -> Review, for any future conversational
// channel (WhatsApp first), reusing DESK's existing form/validation/creation
// logic throughout rather than building a parallel system.

export * from './types'
export * from './catalog'
export * from './subcategory'
export * from './title'
export * from './question-plan'
export * from './answers'
export * from './review'
export * from './adapter'
