/**
 * Error monitoring facade.
 * Currently logs to console; swap captureException for @sentry/nextjs once you
 * add SENTRY_DSN to your environment:
 *
 *   npm install @sentry/nextjs
 *   npx @sentry/wizard@latest -i nextjs
 *   Add SENTRY_DSN to .env.local
 *
 * Then replace the body of captureException with:
 *   import * as Sentry from '@sentry/nextjs'
 *   Sentry.captureException(err, { extra: context })
 */

export function captureException(err: unknown, context?: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'production') {
    // TODO: replace with Sentry.captureException(err, { extra: context })
    console.error('[ERROR]', err, context)
  } else {
    console.error('[ERROR]', err, context)
  }
}

export function captureMessage(msg: string, level: 'info' | 'warning' | 'error' = 'info') {
  if (process.env.NODE_ENV === 'production') {
    // TODO: replace with Sentry.captureMessage(msg, level)
    console.log(`[${level.toUpperCase()}]`, msg)
  }
}
