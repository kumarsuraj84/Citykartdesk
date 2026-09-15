const crypto = require('crypto')

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function sign(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' }
  const h = b64url(JSON.stringify(header))
  const p = b64url(JSON.stringify(payload))
  const sig = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${h}.${p}.${sig}`
}

const secret = process.argv[2]
const iat = Math.floor(Date.now() / 1000)
const exp = iat + 60 * 60 * 24 * 365 * 10 // 10 years

const anon = sign({ role: 'anon', iss: 'supabase', iat, exp }, secret)
const serviceRole = sign({ role: 'service_role', iss: 'supabase', iat, exp }, secret)

console.log('ANON_KEY=' + anon)
console.log('SERVICE_ROLE_KEY=' + serviceRole)
