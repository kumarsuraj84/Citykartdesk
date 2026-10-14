// Most webhook calls one caller address may make per minute (a Next.js route file may export only HTTP handlers, so the number lives here).
export const MAX_REQUESTS_PER_MINUTE_PER_CALLER = 1200
