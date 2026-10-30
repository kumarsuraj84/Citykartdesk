// Vitest doesn't get Next.js's automatic .env.local loading, so do it
// ourselves before any test file's top-level code (which reads
// process.env.NEXT_PUBLIC_SUPABASE_URL etc.) runs.
import path from 'node:path'
import WebSocket from 'ws'
import { assertLocalSupabase } from './local-guard'

try {
  process.loadEnvFile(path.resolve(__dirname, '../../.env.local'))
} catch {
  // Fall back to whatever is already in process.env (e.g. CI-provided secrets).
}

// Never run against a database that is not on this machine (audit H-02): see tests/setup/local-guard.ts.
assertLocalSupabase()

// Switches that only exist for trying the app by hand on a development PC (mail saved to files instead of sent, sheets read from files) must never change how
// the tests run: a test that wants one sets it itself.
delete process.env.MAIL_SINK_DIR
delete process.env.MASTERS_DEMO_DIR

// Node 20 (unlike Next's own runtime, and unlike Node 22+) has no global
// WebSocket — @supabase/supabase-js's RealtimeClient requires one just to
// construct the client, even though these tests never subscribe to realtime.
if (!globalThis.WebSocket) {
  // @ts-expect-error -- ws's Node WebSocket is not the DOM WebSocket type
  globalThis.WebSocket = WebSocket
}
