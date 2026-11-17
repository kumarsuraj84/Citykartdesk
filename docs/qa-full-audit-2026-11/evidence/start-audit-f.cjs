// QA 2026-11 — starts the isolated AUDIT app (same gate and egress guard as start-demo.cjs) with the CKOneAI assistant switched ON against a stub on 127.0.0.1:8100
// and the data API switched on, using SYNTHETIC secrets that exist only in this process. Never used outside the audit stack.
//   F_PILOT=<id>,<id> node docs/qa-full-audit-2026-11/evidence/start-audit-f.cjs
process.env.CKONEAI_ENABLED = '1'
process.env.CKONEAI_BASE_URL = 'http://127.0.0.1:8100'
process.env.CKONEAI_BRIDGE_SECRET_CKDESK = 'qa11-synthetic-bridge-secret-0123456789abcdef'
process.env.CKONEAI_PILOT_USER_IDS = process.env.F_PILOT || ''
process.env.DATA_API_TOKEN = 'qa11-synthetic-data-api-token-0123456789abcdef'
require('../../../audit-2026-10/demo/start-demo.cjs')
