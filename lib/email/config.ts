export const EMAIL_FROM = process.env.EMAIL_FROM ?? 'Citykart Desk <noreply@citykart.org>'
export const RESEND_API_KEY = process.env.RESEND_API_KEY ?? ''
export const EMAIL_ENABLED = !!RESEND_API_KEY
