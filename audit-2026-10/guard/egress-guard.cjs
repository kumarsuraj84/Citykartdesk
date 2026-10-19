'use strict'
/**
 * CKDesk audit-mode egress guard (Node preload: NODE_OPTIONS="--require <this file>").
 *
 * Deny-by-default for every outbound TCP connection made by this Node process (and its children/workers):
 *   - ALLOWED: loopback only (127.0.0.0/8, ::1, "localhost", "*.localhost") and unix-socket paths.
 *   - DENIED:  the three production machines (10.0.1.98, 10.0.0.205, 10.0.0.25), the retired Main server (10.0.1.12),
 *              the public IP of the app (182.72.84.10) — and, because of deny-by-default, every other host.
 * A denied connect is refused INSIDE the process before the operating system is asked to open a socket, so no packet is sent.
 * Everything (http, https, fetch/undici, pg, nodemailer, imapflow, web-push) ends in net.Socket#connect, which is what is guarded.
 * dns.lookup results are checked as well, so a hostname that resolves to a forbidden address is refused.
 *
 * Evidence: every refusal is appended to audit-2026-10/evidence/egress-denied.jsonl; allowed loopback connects are counted
 * and written to egress-summary-<pid>.json at exit.
 */
const net = require('node:net')
const dns = require('node:dns')
const fs = require('node:fs')
const path = require('node:path')

const FORBIDDEN = new Set(['10.0.1.98', '10.0.0.205', '10.0.0.25', '10.0.1.12', '182.72.84.10'])
const evidenceDir = () => process.env.AUDIT_EVIDENCE_DIR || path.resolve(__dirname, '..', 'evidence')

function isLoopback(h) {
  if (!h) return true // node defaults to localhost
  let host = String(h).trim().toLowerCase()
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '0:0:0:0:0:0:0:1') return true
  const m4 = host.match(/^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m4) return Number(m4[1]) === 127
  return false
}
function isForbidden(h) {
  if (!h) return false
  let host = String(h).trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/^::ffff:/, '')
  return FORBIDDEN.has(host)
}
function allowed(h) {
  return !isForbidden(h) && isLoopback(h)
}

function normalizeArgs(args) {
  const a0 = args[0]
  if (a0 && typeof a0 === 'object' && !Array.isArray(a0)) return a0
  if (Array.isArray(a0)) return normalizeArgs(a0)
  if (typeof a0 === 'string' && Number.isNaN(Number(a0))) return { path: a0 }
  return { port: a0, host: typeof args[1] === 'string' ? args[1] : undefined }
}

const counts = Object.create(null)
function record(kind, target, extra) {
  try {
    fs.mkdirSync(evidenceDir(), { recursive: true })
    fs.appendFileSync(path.join(evidenceDir(), 'egress-denied.jsonl'), JSON.stringify({ t: new Date().toISOString(), pid: process.pid, kind, target, ...extra }) + '\n')
  } catch { /* evidence is best-effort; the refusal itself never depends on it */ }
}

function guardConnect(original) {
  const guarded = function (...args) {
    const o = normalizeArgs(args)
    if (!o.path) {
      const host = o.host || o.hostname || 'localhost'
      if (!allowed(host)) {
        record('connect', `${host}:${o.port ?? ''}`, { reason: isForbidden(host) ? 'production-or-retired-address' : 'not-loopback' })
        const err = new Error(`[ckdesk-audit-guard] outbound connection to ${host}:${o.port ?? ''} refused (audit mode allows loopback only)`)
        err.code = 'EAUDITGUARD'
        process.nextTick(() => this.destroy(err))
        return this
      }
      counts[`${host}:${o.port ?? ''}`] = (counts[`${host}:${o.port ?? ''}`] || 0) + 1
    }
    return original.apply(this, args)
  }
  guarded.__ckAuditGuard = true
  return guarded
}

function install() {
  if (net.Socket.prototype.connect.__ckAuditGuard) return
  net.Socket.prototype.connect = guardConnect(net.Socket.prototype.connect)

  // A hostname that resolves to a forbidden address is refused too.
  const origLookup = dns.lookup
  dns.lookup = function (hostname, options, cb) {
    if (typeof options === 'function') { cb = options; options = {} }
    return origLookup.call(dns, hostname, options, function (err, address, family) {
      const list = Array.isArray(address) ? address.map((x) => x.address) : [address]
      if (!err && list.some(isForbidden)) {
        record('dns', String(hostname), { address: list.join(',') })
        const e = new Error(`[ckdesk-audit-guard] ${hostname} resolves to a forbidden address`)
        e.code = 'EAUDITGUARD'
        return cb(e)
      }
      return cb(err, address, family)
    })
  }
}
install()

process.on('exit', () => {
  try {
    if (!Object.keys(counts).length) return
    fs.mkdirSync(evidenceDir(), { recursive: true })
    fs.writeFileSync(path.join(evidenceDir(), `egress-summary-${process.pid}.json`), JSON.stringify({ pid: process.pid, argv: process.argv.slice(1, 3), loopbackConnects: counts }, null, 1))
  } catch { /* ignore */ }
})

module.exports = { allowed, isForbidden, isLoopback, guardConnect, FORBIDDEN, normalizeArgs }
