// Same env-loading + WebSocket polyfill as tests/setup/env.ts - duplicated
// rather than imported so loadtest/ has zero dependency on tests/ (the two
// suites must never accidentally couple).
import path from 'node:path'
import WebSocket from 'ws'

try {
  process.loadEnvFile(path.resolve(__dirname, '../../.env.local'))
} catch {
  // Fall back to whatever is already in process.env.
}

if (!globalThis.WebSocket) {
  // @ts-expect-error -- ws's Node WebSocket is not the DOM WebSocket type
  globalThis.WebSocket = WebSocket
}
