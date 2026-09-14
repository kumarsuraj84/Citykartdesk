/** Stage 3 / 3.1, Step 7 — Subject/Title generation. Deterministic fallback
 *  is mandatory and, per the Stage 3.1 correction, description-focused
 *  rather than sub-category-focused; AI is optional and must never block on
 *  failure/timeout/empty output. */
import { describe, it, expect, vi } from 'vitest'
import { generateRequestTitle } from '@/lib/requests/questionnaire/title'

describe('generateRequestTitle() — deterministic fallback', () => {
  it('a substantive description produces a meaningful, description-derived phrase, not the bare sub-category name', async () => {
    const title = await generateRequestTitle({
      serviceName: 'IT',
      subCategoryName: 'Printer Issue',
      description: 'Billing counter printer is not printing and jobs are stuck in queue since morning.',
    })
    expect(title.startsWith('IT: ')).toBe(true)
    expect(title).not.toBe('IT: Printer Issue')
    // Not brittle to exact wording/capitalization — just that it's clearly
    // derived from the description's own words, not the sub-category alone.
    expect(title.toLowerCase()).toContain('billing')
    expect(title.toLowerCase()).toContain('printer')
  })

  it('preserves an all-caps acronym in the description (e.g. "AC") instead of collapsing it to "Ac"', async () => {
    const title = await generateRequestTitle({ serviceName: 'Facilities', description: 'The AC unit in Store 12 has stopped cooling entirely since this morning.' })
    expect(title).toContain('AC')
    expect(title).not.toContain('Ac ')
  })

  it('a short/thin description is paired with the sub-category for context rather than standing alone', async () => {
    const title = await generateRequestTitle({ serviceName: 'IT', subCategoryName: 'Printer Issue', description: 'not working' })
    expect(title).toBe('IT: Printer Issue: Not Working')
  })

  it('no description, sub-category available: uses the sub-category name', async () => {
    const title = await generateRequestTitle({ serviceName: 'AC Repair', subCategoryName: 'Not Cooling' })
    expect(title).toBe('AC Repair: Not Cooling')
  })

  it('no sub-category, a substantive description: derives a phrase from the description alone', async () => {
    const title = await generateRequestTitle({ serviceName: 'AC Repair', description: 'The compressor keeps shutting off randomly' })
    expect(title.startsWith('AC Repair: ')).toBe(true)
    expect(title.toLowerCase()).toContain('compressor')
  })

  it('no sub-category, no description: falls back to the service name alone', async () => {
    const title = await generateRequestTitle({ serviceName: 'AC Repair' })
    expect(title).toBe('AC Repair')
  })

  it('bounds overall length for a very long multi-word description (word-count capping keeps it short)', async () => {
    const longDesc = 'a very long issue description word '.repeat(20)
    const title = await generateRequestTitle({ serviceName: 'AC Repair', description: longDesc })
    expect(title.length).toBeLessThanOrEqual(120)
  })

  it('bounds overall length even for a single pathologically long "word" (no whitespace to cap by word count)', async () => {
    const title = await generateRequestTitle({ serviceName: 'AC Repair', description: 'a'.repeat(200) })
    expect(title.length).toBeLessThanOrEqual(120)
    expect(title.endsWith('…')).toBe(true)
  })

  it('a description phrase is capped to a handful of words (reads like a subject, not a restated sentence)', async () => {
    const title = await generateRequestTitle({
      serviceName: 'IT',
      description: 'The point of sale terminal at the billing counter keeps freezing every few minutes during checkout and nobody can process any transactions',
    })
    const subjectPart = title.replace(/^IT: /, '')
    expect(subjectPart.split(/\s+/).length).toBeLessThanOrEqual(8)
  })
})

describe('generateRequestTitle() — optional AI provider', () => {
  it('AI provider returns a usable title: used, truncated to the max length', async () => {
    const provider = vi.fn().mockResolvedValue('AI-Generated Concise Subject')
    const title = await generateRequestTitle({ serviceName: 'AC Repair', subCategoryName: 'Not Cooling' }, provider)
    expect(title).toBe('AI-Generated Concise Subject')
    expect(provider).toHaveBeenCalledOnce()
  })

  it('TEST 10: AI provider rejects/throws: falls back to the deterministic title, no failure', async () => {
    const provider = vi.fn().mockRejectedValue(new Error('AI unavailable'))
    const title = await generateRequestTitle({ serviceName: 'AC Repair', subCategoryName: 'Not Cooling' }, provider)
    expect(title).toBe('AC Repair: Not Cooling')
  })

  it('TEST 9: AI provider returns empty string: deterministic fallback is generated, progression succeeds', async () => {
    const provider = vi.fn().mockResolvedValue('')
    const title = await generateRequestTitle({ serviceName: 'AC Repair', subCategoryName: 'Not Cooling' }, provider)
    expect(title).toBe('AC Repair: Not Cooling')
  })

  it('AI provider returns whitespace-only: falls back to the deterministic title', async () => {
    const provider = vi.fn().mockResolvedValue('   ')
    const title = await generateRequestTitle({ serviceName: 'AC Repair', subCategoryName: 'Not Cooling' }, provider)
    expect(title).toBe('AC Repair: Not Cooling')
  })

  it('AI provider returns null: falls back to the deterministic title', async () => {
    const provider = vi.fn().mockResolvedValue(null)
    const title = await generateRequestTitle({ serviceName: 'AC Repair', subCategoryName: 'Not Cooling' }, provider)
    expect(title).toBe('AC Repair: Not Cooling')
  })

  it('TEST 10b: AI provider hangs past the timeout: falls back to the deterministic title, does not block indefinitely', async () => {
    vi.useFakeTimers()
    try {
      const provider = vi.fn(() => new Promise<string | null>(() => {})) // never resolves
      const promise = generateRequestTitle({ serviceName: 'AC Repair', subCategoryName: 'Not Cooling' }, provider)
      await vi.advanceTimersByTimeAsync(3000)
      const title = await promise
      expect(title).toBe('AC Repair: Not Cooling')
    } finally {
      vi.useRealTimers()
    }
  })
})
