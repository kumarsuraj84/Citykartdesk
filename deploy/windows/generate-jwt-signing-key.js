// Generates a fresh ES256 (P-256) JWT signing key and derives the three
// consumer-specific env/config values needed to roll it out across
// GoTrue, PostgREST and Storage while preserving verification of tokens
// already signed with the existing legacy HS256 secret.
//
// This does NOT modify any running service or file - it only prints the
// three values. Applying them (and restarting the affected services) is
// a separate, deliberate step. See docs/WINDOWS-DEPLOYMENT.md, "JWT
// signing keys (JWKS)" for the full rollout/rollback procedure.
//
// Usage: node generate-jwt-signing-key.js <current-GOTRUE_JWT_SECRET>
const crypto = require('crypto')

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const legacySecret = process.argv[2]
if (!legacySecret) {
  console.error('Usage: node generate-jwt-signing-key.js <current-GOTRUE_JWT_SECRET>')
  process.exit(1)
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
const pubJwk = publicKey.export({ format: 'jwk' })
const privJwk = privateKey.export({ format: 'jwk' })
const kid = crypto.randomUUID()

const gotrueSigningKey = {
  ...privJwk,
  kid,
  alg: 'ES256',
  use: 'sig',
  key_ops: ['sign'],
}

const consumerPublicKey = {
  ...pubJwk,
  kid,
  alg: 'ES256',
  use: 'sig',
  key_ops: ['verify'],
}

const legacyOctKey = {
  kty: 'oct',
  k: b64url(Buffer.from(legacySecret, 'utf8')),
  alg: 'HS256',
  key_ops: ['sign', 'verify'],
}

// GOTRUE_JWT_KEYS: bare JSON array of raw private JWKs (GoTrue's own format).
// The legacy secret does NOT need to be included here - GoTrue's
// FindPublicKeyByKid() already falls back to GOTRUE_JWT_SECRET for tokens
// whose kid is empty (i.e. every token issued before this key existed).
const gotrueJwtKeys = JSON.stringify([gotrueSigningKey])

// PostgREST jwt-secret: MUST include both keys as one JWKS. Unlike GoTrue
// and Storage, PostgREST's jwt-secret has no separate flat-secret fallback
// once it holds a JWKS value, so the legacy oct key has to be present for
// pre-existing (no-kid, HS256) tokens to keep verifying.
const postgrestJwtSecret = JSON.stringify({ keys: [legacyOctKey, consumerPublicKey] })

// Storage JWT_JWKS: public key only. Storage's own jwt.ts fast-paths any
// token with no kid and alg === jwtAlgorithm straight to AUTH_JWT_SECRET,
// so the legacy secret's flat form (already configured) covers old tokens.
const storageJwtJwks = JSON.stringify({ keys: [consumerPublicKey] })

console.log('kid=' + kid)
console.log('')
console.log('--- services/auth/.env ---')
console.log(`GOTRUE_JWT_KEYS='${gotrueJwtKeys}'`)
console.log('')
console.log('--- services/postgrest/postgrest.conf (replaces the jwt-secret line) ---')
console.log(`jwt-secret = "${postgrestJwtSecret.replace(/"/g, '\\"')}"`)
console.log('')
console.log('--- services/storage-src/.env ---')
console.log(`JWT_JWKS='${storageJwtJwks}'`)
