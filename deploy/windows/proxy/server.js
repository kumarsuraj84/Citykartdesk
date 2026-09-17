'use strict'
// Minimal reverse proxy unifying Auth/PostgREST/Storage under one client-facing
// port, mirroring Supabase's own Kong routing (strip the /xxx/v1 prefix before
// forwarding to the backend, which serves its routes unprefixed at its root).
const http = require('http')

const PORT = 8443
const ROUTES = [
  { prefix: '/auth/v1', target: { host: '127.0.0.1', port: 9999 }, pooled: true },
  { prefix: '/rest/v1', target: { host: '127.0.0.1', port: 3001 }, pooled: true },
  // Storage keeps the original one-socket-per-request behavior below - request
  // bodies here can be large file uploads, which the pooled path's retry
  // (buffers the whole body to safely replay it once) isn't safe for.
  { prefix: '/storage/v1', target: { host: '127.0.0.1', port: 5000 }, pooled: false },
]

// DESK-PERF-001 - root cause: every request through this proxy opened a brand
// new TCP connection to the upstream (agent: false below, kept for Storage).
// Proven via a staged concurrency test (120 concurrent requesters, the lowest
// of the planned 120-220 range): CitykartPostgrest_cpu spiked to 727% and
// postgres_cpu_pct_sum to 749% at the exact moment a burst of
// "connect ECONNREFUSED 127.0.0.1:3001" errors appeared client-side - while
// pg_stat_activity's actual connection count stayed at 13 the whole time, so
// this was never a Postgres capacity problem. PostgREST (and, downstream,
// Postgres) was being CPU-saturated by the sheer rate of fresh TCP
// handshakes + JWT/connection setup, not by real query load, to the point
// its own OS accept queue started refusing new connections outright.
//
// Fix: reuse persistent keep-alive connections for Auth/PostgREST (the two
// routes createRequestCore()'s per-operation fan-out actually hammers) via a
// shared http.Agent, instead of one-shot connections. This reintroduces the
// exact failure mode the original `agent: false` was chosen to avoid - a
// pooled socket that GoTrue's Go http.Server idle-closed while it sat unused
// in the pool, surfacing as ECONNRESET on the next reuse - but that failure
// mode is specific to LOW traffic (a socket sitting idle long enough to be
// closed); under the sustained real traffic this fix targets, sockets stay
// busy and are far less likely to go idle-then-die. `withStaleSocketRetry`
// below closes that gap for real: on the specific "reused connection died"
// error signatures, it retries exactly once against a fresh connection
// before giving up - the same principle lib/supabase/resilient-fetch.ts
// already applies client-side, now applied here too.
const pooledAgent = new http.Agent({ keepAlive: true, keepAliveMsecs: 1000, maxSockets: 256, maxFreeSockets: 64 })

function isStaleSocketError(err) {
  return err && (err.code === 'ECONNRESET' || err.code === 'EPIPE' || /socket hang up/i.test(err.message || ''))
}

/** Buffers the incoming request body (bounded - see MAX_BUFFERED_BODY_BYTES)
 *  so a stale-socket failure on the first attempt can be retried against a
 *  fresh connection with the exact same body, instead of a body stream that
 *  can only be piped once. */
function bufferBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > maxBytes) {
        reject(new Error(`request body exceeds ${maxBytes} bytes - not eligible for pooled/retryable forwarding`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

const MAX_BUFFERED_BODY_BYTES = 4 * 1024 * 1024 // generous for JSON auth/rest payloads

function forwardPooled(req, res, route, forwardPath) {
  bufferBody(req, MAX_BUFFERED_BODY_BYTES)
    .then((bodyBuffer) => {
      const attempt = (isRetry) => {
        const proxyReq = http.request(
          {
            host: route.target.host,
            port: route.target.port,
            path: forwardPath,
            method: req.method,
            headers: req.headers,
            agent: pooledAgent,
          },
          (proxyRes) => {
            res.writeHead(proxyRes.statusCode, proxyRes.headers)
            proxyRes.pipe(res)
          }
        )
        proxyReq.on('error', (err) => {
          if (!isRetry && isStaleSocketError(err)) {
            console.error(`[proxy] stale pooled connection for ${req.method} ${req.url}, retrying once:`, err.message)
            attempt(true)
            return
          }
          console.error(`[proxy] upstream error for ${req.method} ${req.url}:`, err.message)
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'upstream unavailable', detail: err.message }))
          } else {
            res.destroy()
          }
        })
        if (bodyBuffer.length > 0) proxyReq.write(bodyBuffer)
        proxyReq.end()
      }
      attempt(false)
    })
    .catch((err) => {
      console.error(`[proxy] failed to buffer request body for ${req.method} ${req.url}:`, err.message)
      if (!res.headersSent) {
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'request body too large for proxy buffering', detail: err.message }))
      }
    })
}

function forwardOneShot(req, res, route, forwardPath) {
  const proxyReq = http.request(
    {
      host: route.target.host,
      port: route.target.port,
      path: forwardPath,
      method: req.method,
      headers: req.headers,
      // agent: false - open a fresh connection per request instead of reusing
      // a keep-alive pool. Unchanged from the original design for this route:
      // Storage bodies can be large file uploads, which aren't safe to buffer
      // for a retry, and Storage traffic wasn't implicated in the CPU-spike
      // failure this file's pooled path above was written to fix.
      agent: false,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers)
      proxyRes.pipe(res)
    }
  )

  proxyReq.on('error', (err) => {
    console.error(`[proxy] upstream error for ${req.method} ${req.url}:`, err.message)
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'upstream unavailable', detail: err.message }))
    } else {
      res.destroy()
    }
  })

  req.on('error', (err) => {
    console.error(`[proxy] client request error for ${req.method} ${req.url}:`, err.message)
    proxyReq.destroy()
  })

  req.pipe(proxyReq)
}

const server = http.createServer((req, res) => {
  const route = ROUTES.find((r) => req.url === r.prefix || req.url.startsWith(r.prefix + '/') || req.url.startsWith(r.prefix + '?'))

  if (!route) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'no matching route', path: req.url }))
    return
  }

  const forwardPath = req.url.slice(route.prefix.length) || '/'
  if (route.pooled) {
    forwardPooled(req, res, route, forwardPath)
  } else {
    forwardOneShot(req, res, route, forwardPath)
  }
})

server.on('clientError', (err, socket) => {
  console.error('[proxy] client connection error:', err.message)
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Citykart Desk proxy listening on 0.0.0.0:${PORT}`)
})
