// Files that arrive by paste (Ctrl+V) or by drag-and-drop into a conversation box. Pure, so it can be tested without a browser.
//   - copied file(s) / a screenshot on the clipboard  -> attached, like the Attach button
//   - plain text                                      -> not ours, the box pastes it as text
//   - a copy from Excel / Word / a web page (text AND a picture of it) -> text wins, nothing is attached by surprise

interface TransferLike {
  files: ArrayLike<File>
  getData?: (type: string) => string
}

function two(n: number): string { return String(n).padStart(2, '0') }

/** A screenshot from the clipboard is always called "image.png"; give it a name that tells screenshots apart. */
function readableName(file: File, now: Date): File {
  if (!/^image\.(png|jpe?g|gif|webp)$/i.test(file.name)) return file
  const ext = (file.name.split('.').pop() ?? 'png').toLowerCase()
  const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`
  return new File([file], `screenshot-${stamp}.${ext}`, { type: file.type, lastModified: file.lastModified })
}

export function filesToAttachFromTransfer(dt: TransferLike | null | undefined, now: Date = new Date(), { textWins = true }: { textWins?: boolean } = {}): File[] {
  if (!dt || !dt.files || dt.files.length === 0) return []
  if (textWins && (dt.getData?.('text/plain') ?? '').length > 0) return []
  return Array.from(dt.files).map((f) => readableName(f, now))
}
