// Content inspection of an uploaded file, BEFORE it is stored (VAPT-065 / VA-INT-10 rest). Every upload path calls validateAttachment(), which calls this last,
// so nothing is saved - and therefore nothing can be opened by anybody - until the checks below have finished.
//
//  1. Macros. Legacy Word/Excel/PowerPoint files (.doc .xls .ppt) and any Office or ZIP file can carry a VBA macro project. Such files are refused unless
//     ALLOW_MACRO_OFFICE_FILES=1 (a business decision: some vendors send macro workbooks).
//  2. Malware scanning through a scanner the company runs itself (ClamAV's "clamd" network protocol). NOTHING is scanned unless it is configured:
//        ATTACHMENT_SCANNER=clamd   ATTACHMENT_SCANNER_HOST=<host>   ATTACHMENT_SCANNER_PORT=3310 (default)
//     With a scanner configured, a file that cannot be scanned (scanner down, timeout) is REFUSED by default (fail closed). ATTACHMENT_SCAN_ON_ERROR=allow
//     switches that to "let it through and log", for a deliberate choice only.
//     With no scanner configured the system says so (scannerStatus()) and does not pretend: files are checked for type, signature and macros only.
import net from 'node:net'
import { logger } from '@/lib/observability/logger'

export type InspectCode = 'macro' | 'infected' | 'scan_unavailable'
export type InspectResult = { ok: true; scanned: boolean } | { ok: false; code: InspectCode; error: string }

// ── macros ──
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const hasMagic = (b: Uint8Array, magic: number[]) => magic.every((x, i) => b[i] === x)
const VBA_OLE_MARKERS = ['_VBA_PROJECT', 'VBA', 'Macros'].map((s) => Buffer.from(s, 'utf16le'))   // directory entry names are UTF-16
const VBA_ZIP_MARKERS = ['vbaProject.bin', 'vbaData.xml'].map((s) => Buffer.from(s, 'latin1'))      // zip entry names are plain bytes

/** Does the file carry a VBA macro project? Looks for the project's directory entries (OLE files) or part names (OOXML / ZIP). */
export function containsMacros(bytes: Uint8Array): boolean {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (hasMagic(buf, OLE_MAGIC)) return VBA_OLE_MARKERS.some((m) => buf.includes(m))
  if (buf[0] === 0x50 && buf[1] === 0x4b) return VBA_ZIP_MARKERS.some((m) => buf.includes(m))
  return false
}

// ── scanner ──
export function scannerStatus(): { configured: boolean; kind: string | null; onError: 'reject' | 'allow' } {
  const kind = (process.env.ATTACHMENT_SCANNER ?? '').trim().toLowerCase()
  return { configured: kind === 'clamd' && !!process.env.ATTACHMENT_SCANNER_HOST, kind: kind || null, onError: process.env.ATTACHMENT_SCAN_ON_ERROR === 'allow' ? 'allow' : 'reject' }
}

/** Sends the bytes to clamd with its INSTREAM command and returns the verdict line ("stream: OK" or "stream: <name> FOUND"). */
export function clamdScan(bytes: Uint8Array, host: string, port: number, timeoutMs = 20_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port })
    let out = ''
    const done = (fn: () => void) => { sock.destroy(); fn() }
    sock.setTimeout(timeoutMs, () => done(() => reject(new Error('scanner timeout'))))
    sock.on('error', (e) => done(() => reject(e)))
    sock.on('data', (d) => { out += d.toString('latin1') })
    sock.on('end', () => resolve(out.replace(/\0/g, '').trim()))
    sock.on('connect', () => {
      sock.write('zINSTREAM\0')
      const CHUNK = 64 * 1024
      for (let i = 0; i < bytes.length; i += CHUNK) {
        const part = bytes.subarray(i, Math.min(i + CHUNK, bytes.length))
        const len = Buffer.alloc(4); len.writeUInt32BE(part.length)
        sock.write(len); sock.write(part)
      }
      sock.write(Buffer.alloc(4))   // zero-length chunk ends the stream
    })
  })
}

export async function inspectUpload(file: File, opts: { scan?: (bytes: Uint8Array) => Promise<string> } = {}): Promise<InspectResult> {
  return inspectBytes(new Uint8Array(await file.arrayBuffer()), opts)
}

/** The same inspection for bytes already in memory (a file downloaded from WhatsApp, for example). */
export async function inspectBytes(bytes: Uint8Array, opts: { scan?: (bytes: Uint8Array) => Promise<string> } = {}): Promise<InspectResult> {

  if (process.env.ALLOW_MACRO_OFFICE_FILES !== '1' && containsMacros(bytes)) {
    return { ok: false, code: 'macro', error: 'Files that contain macros are not accepted. Please send the file without macros (for example save it as .xlsx or .docx).' }
  }

  const st = scannerStatus()
  if (!st.configured && !opts.scan) return { ok: true, scanned: false }
  try {
    const verdict = await (opts.scan ?? ((b) => clamdScan(b, process.env.ATTACHMENT_SCANNER_HOST!, Number(process.env.ATTACHMENT_SCANNER_PORT ?? 3310))))(bytes)
    if (/\bFOUND$/.test(verdict)) {
      logger.warn({ event: 'attachments.scan.infected', message: 'An uploaded file was refused by the malware scanner', route: 'lib/attachments/scan.ts', context: { verdict: verdict.slice(0, 120), size: bytes.length } })
      return { ok: false, code: 'infected', error: 'This file was refused by the virus scanner.' }
    }
    if (/\bOK$/.test(verdict)) return { ok: true, scanned: true }
    throw new Error('unexpected scanner reply')
  } catch (e) {
    logger.error({ event: 'attachments.scan.unavailable', message: 'The malware scanner could not check an upload', route: 'lib/attachments/scan.ts', context: { error: e instanceof Error ? e.message : String(e), failMode: st.onError } })
    if (st.onError === 'allow') return { ok: true, scanned: false }
    return { ok: false, code: 'scan_unavailable', error: 'The file could not be checked for viruses right now. Please try again in a few minutes.' }
  }
}
