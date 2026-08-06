// Minimal structured logger — timestamped, level-prefixed.
function ts() {
  return new Date().toISOString()
}

export const log = {
  info:  (msg: string, meta?: unknown) => console.log(`${ts()} [info]  ${msg}`, meta ?? ''),
  warn:  (msg: string, meta?: unknown) => console.warn(`${ts()} [warn]  ${msg}`, meta ?? ''),
  error: (msg: string, meta?: unknown) => console.error(`${ts()} [error] ${msg}`, meta ?? ''),
}
