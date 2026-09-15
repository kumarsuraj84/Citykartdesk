'use strict'
// Minimal reverse proxy unifying Auth/PostgREST/Storage under one client-facing
// port, mirroring Supabase's own Kong routing (strip the /xxx/v1 prefix before
// forwarding to the backend, which serves its routes unprefixed at its root).
const http = require('http')

const PORT = 8443
const ROUTES = [
  { prefix: '/auth/v1', target: { host: '127.0.0.1', port: 9999 } },
  { prefix: '/rest/v1', target: { host: '127.0.0.1', port: 3001 } },
  { prefix: '/storage/v1', target: { host: '127.0.0.1', port: 5000 } },
]

// agent: false - open a fresh connection per request instead of reusing a
// keep-alive pool. GoTrue's default Go http.Server idle-closes pooled
// connections; a reused-but-now-dead socket surfaces as an intermittent raw
// ECONNRESET/"socket hang up" on the NEXT request through it, which without
// this shows up client-side as a generic "unexpected response from the
// server" instead of a clean error. Low traffic here, so paying one extra
// TCP handshake per request is a fine trade for not hitting that.
const server = http.createServer((req, res) => {
  const route = ROUTES.find((r) => req.url === r.prefix || req.url.startsWith(r.prefix + '/') || req.url.startsWith(r.prefix + '?'))

  if (!route) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'no matching route', path: req.url }))
    return
  }

  const forwardPath = req.url.slice(route.prefix.length) || '/'
  const proxyReq = http.request(
    {
      host: route.target.host,
      port: route.target.port,
      path: forwardPath,
      method: req.method,
      headers: req.headers,
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
})

server.on('clientError', (err, socket) => {
  console.error('[proxy] client connection error:', err.message)
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Citykart Desk proxy listening on 0.0.0.0:${PORT}`)
})
