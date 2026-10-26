// Appends one result line to an evidence log (JSON lines), so every journey / check has a timestamped record the reports are built from.
// Usage: node log-result.cjs <file-without-extension> <id> <PASS|FAIL|BLOCKED|NOT TESTED|OUT OF SCOPE> "<what was checked and the actual result>" [defect-id]
const fs = require('fs')
const path = require('path')
const [file, id, status, note, defect] = process.argv.slice(2)
if (!file || !id || !status) { console.error('usage: log-result.cjs <file> <id> <status> "<note>" [defect]'); process.exit(1) }
const dir = path.resolve(__dirname, '..', 'evidence')
fs.appendFileSync(path.join(dir, `${file}.jsonl`), JSON.stringify({ at: new Date().toISOString(), id, status, note: note ?? '', defect: defect ?? '' }) + '\n')
console.log(`logged ${file}: ${id} ${status}`)
