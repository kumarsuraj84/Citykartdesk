// Creates the synthetic users for the browser UAT and LEAVES them in the disposable audit database (no cleanup).
// It writes the e-mails (never the password) to security-assessment-2026-10/02-VAPT/work/uat-users.json.
import { it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { setupD03Fixtures } from '../setup/fixtures-d03'

it('creates UAT users and keeps them', async () => {
  const fx = await setupD03Fixtures()
  writeFileSync('security-assessment-2026-10/02-VAPT/work/uat-users.json', JSON.stringify({
    requesterA: fx.requesterA.email, requesterB: fx.requesterB.email, agentA: fx.agentA.email, agentB: fx.agentB.email, manager: fx.manager.email, admin: fx.admin.email,
    requestA: fx.requestA.id, requestB: fx.requestB.id,
  }, null, 1))
}, 180_000)
