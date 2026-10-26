import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// QA-D008: the file picker of the vendor actions already adds the red star to its label, so a label that carries its own star showed "PMS report * *".
const src = readFileSync(path.resolve(__dirname, '..', '..', 'components', 'vendor', 'VendorTicketActions.tsx'), 'utf8')

describe('vendor file picker labels', () => {
  it('the picker adds the star itself', () => {
    expect(src).toMatch(/\{label\} \*/)
  })
  it('no label handed to the picker carries a star of its own', () => {
    const labels = [...src.matchAll(/<FilePick\s+label=\{([^}]*)\}/g)].map((m) => m[1])
    expect(labels.length).toBeGreaterThan(0)
    for (const l of labels) expect(l, l).not.toMatch(/\*/)
  })
})
