const fs = require('fs'), path = require('path'); const d = path.join(__dirname, 'perf')
const rows = fs.readdirSync(d).filter((f) => /^ds.*-u\d+\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')))
const order = (l) => ({ ds3k: 0, ds100k: 1, ds500k: 2 }[l.label] ?? 9)
rows.sort((a, b) => order(a) - order(b) || a.users - b.users)
let out = '| Tickets in DB | Users | Requests | Errors | Req/s | P50 ms | P95 ms | P99 ms | Max ms | Server RAM MB (start→end) | Server CPU (one core) | Slowest page (P95) |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n'
for (const r of rows) { const s = r.rows[0]; out += `| ${Number(r.requestsInDb).toLocaleString()} | ${r.users} | ${r.requests} | ${r.errors} (${r.errorRate}%) | ${r.rps} | ${r.overall.p50} | ${r.overall.p95} | ${r.overall.p99} | ${r.overall.max} | ${r.serverRssMB.first}→${r.serverRssMB.last} | ${r.serverCpuPct}% | ${s.page} (${s.p95}) |\n` }
fs.writeFileSync(path.join(d, 'table.md'), out); console.log(out)
