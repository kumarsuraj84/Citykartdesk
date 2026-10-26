// Proves, with the egress guard preloaded the way every QA run loads it, that this process cannot reach anything but loopback:
// the production hosts, a public site, an e-mail server, the weather service. Prints one line per attempt. Exit code 0 only if EVERY outside attempt was refused.
// Run: powershell -File audit-2026-10\guard\run.ps1 -- node qa-release-candidate-2026-10\tooling\egress-proof.cjs
const net = require('net')
const targets = [
  ['production app server', '10.0.1.98', 3210], ['production database', '10.0.0.205', 5432], ['production NAS', '10.0.0.25', 445],
  ['retired main server', '10.0.1.12', 3210], ['public production address', '182.72.84.10', 3210],
  ['public web', 'example.com', 443], ['weather service', 'api.open-meteo.com', 443], ['google sheets api', 'sheets.googleapis.com', 443],
  ['smtp server', 'smtp.gmail.com', 587],
]
function attempt([label, host, port]) {
  return new Promise((resolve) => {
    let done = false
    const finish = (r) => { if (!done) { done = true; resolve({ label, host, port, ...r }) } }
    try {
      const s = net.connect({ host, port, timeout: 3000 })
      s.on('connect', () => { s.destroy(); finish({ result: 'CONNECTED (BAD)' }) })
      s.on('timeout', () => { s.destroy(); finish({ result: 'timeout (no connection made)' }) })
      s.on('error', (e) => finish({ result: `refused: ${String(e.message).slice(0, 90)}` }))
    } catch (e) { finish({ result: `refused: ${String(e.message).slice(0, 90)}` }) }
  })
}
;(async () => {
  console.log('NODE_OPTIONS has the guard:', /egress-guard/.test(process.env.NODE_OPTIONS || ''))
  let bad = 0
  for (const t of targets) { const r = await attempt(t); if (/BAD/.test(r.result)) bad++; console.log(`${r.label.padEnd(26)} ${r.host}:${r.port}  ->  ${r.result}`) }
  const loop = await attempt(['loopback API of the isolated stack', '127.0.0.1', 55421])
  console.log(`${loop.label.padEnd(26)} 127.0.0.1:55421  ->  ${loop.result.replace('BAD', 'expected: this is the isolated stack itself')}`)
  console.log(bad === 0 ? 'RESULT: every outside connection was refused or never made' : `RESULT: ${bad} OUTSIDE CONNECTION(S) SUCCEEDED`)
  process.exit(bad === 0 ? 0 : 1)
})()
