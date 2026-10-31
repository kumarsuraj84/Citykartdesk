// Setup of the local demo runs: load .env.local, refuse anything that is not this PC, keep MAIL_SINK_DIR (the tests delete it; the demo needs it so mail is saved as files).
import path from 'node:path'
import { assertLocalSupabase } from '../../tests/setup/local-guard'

try {
  process.loadEnvFile(path.resolve(__dirname, '../../.env.local'))
} catch {
  // nothing to load
}
assertLocalSupabase()
if (!process.env.MAIL_SINK_DIR) throw new Error('MAIL_SINK_DIR is not set in .env.local: refusing to run, because a demo ticket could then try to send real mail.')
if (!globalThis.WebSocket) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  globalThis.WebSocket = require('ws')
}
