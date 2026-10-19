// Live self-test of the egress guard inside a real Node process (run through run.ps1). Loopback must work; anything else must be refused in-process.
(async () => {
  const out = []
  const t = async (label, url, expectRefused) => {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(4000) }); out.push([label, expectRefused ? 'FAIL (reached)' : 'PASS', 'HTTP ' + r.status]) }
    catch (e) { const code = e.cause && e.cause.code; out.push([label, expectRefused && code === 'EAUDITGUARD' ? 'PASS' : 'FAIL', 'refused=' + (code === 'EAUDITGUARD') + ' ' + (code || e.message)]) }
  }
  await t('loopback audit API (allowed)', 'http://127.0.0.1:55421/rest/v1/', false)
  await t('external host graph.facebook.com (must be refused)', 'https://graph.facebook.com/', true)
  await t('external host api.resend.com (must be refused)', 'https://api.resend.com/', true)
  await t('LAN address 10.0.0.205 (must be refused in-process)', 'http://10.0.0.205:5432/', true)
  await t('LAN address 10.0.1.98 (must be refused in-process)', 'http://10.0.1.98:3210/', true)
  await t('LAN address 10.0.0.25 (must be refused in-process)', 'http://10.0.0.25/', true)
  for (const r of out) console.log(r[1].padEnd(5), r[0], '-', r[2])
  process.exit(out.every((r) => r[1] === 'PASS') ? 0 : 1)
})()
