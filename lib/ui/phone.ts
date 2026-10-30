// Phone-number clean-up for the request form's phone field (Indian 10-digit mobile numbers).

/**
 * Turn what a person typed or pasted into plain digits, at most 10.
 * A country code or trunk zero in front ("+91 98765 43210", "91 98765 43210", "0 98765 43210", "098765 43210")
 * is dropped when what is left is exactly a 10-digit number. Without this, the first 10 digits of "+91 98765 43210"
 * ("9198765432") would be kept, which looks valid but is a different number.
 */
export function normalizePhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length > 10) {
    for (const prefix of ['91', '0']) {
      if (digits.startsWith(prefix) && digits.length - prefix.length === 10) return digits.slice(prefix.length)
    }
    // a pasted "0091…" style prefix
    if (digits.startsWith('0091') && digits.length - 4 === 10) return digits.slice(4)
  }
  return digits.slice(0, 10)
}
