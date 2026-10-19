import { describe, it, expect } from 'vitest'
import { resolveOemRoute } from '@/lib/oems/route'
import { isOemKind, storeOemFor, OEM_DEFAULT_TEXT } from '@/lib/oems/kinds'

const alc = { oem_id: 'bluestar-ac', genset_oem_id: 'cummins-gen' }

describe('OEM route at ticket creation', () => {
  it('a Genset category goes to the store\'s Genset OEM', () => {
    expect(resolveOemRoute({ serviceAutoOemRouting: false, categoryOemKind: 'genset', store: alc })).toEqual({ action: 'send', kind: 'genset', oemId: 'cummins-gen', fromCategory: true })
  })
  it('an AC category goes to the store\'s AC OEM', () => {
    expect(resolveOemRoute({ serviceAutoOemRouting: false, categoryOemKind: 'ac', store: alc })).toEqual({ action: 'send', kind: 'ac', oemId: 'bluestar-ac', fromCategory: true })
  })
  it('the AC service (flag, no category setting) still goes to the AC OEM exactly as before', () => {
    expect(resolveOemRoute({ serviceAutoOemRouting: true, categoryOemKind: null, store: alc })).toEqual({ action: 'send', kind: 'ac', oemId: 'bluestar-ac', fromCategory: false })
  })
  it('the category wins over the service flag', () => {
    expect(resolveOemRoute({ serviceAutoOemRouting: true, categoryOemKind: 'genset', store: alc })).toMatchObject({ kind: 'genset', oemId: 'cummins-gen' })
  })
  it('never sends a Genset ticket to the AC OEM, nor an AC ticket to the Genset OEM', () => {
    const onlyAc = { oem_id: 'bluestar-ac', genset_oem_id: null }
    const onlyGen = { oem_id: null, genset_oem_id: 'cummins-gen' }
    expect(resolveOemRoute({ serviceAutoOemRouting: false, categoryOemKind: 'genset', store: onlyAc })).toEqual({ action: 'unmapped', kind: 'genset' })
    expect(resolveOemRoute({ serviceAutoOemRouting: false, categoryOemKind: 'ac', store: onlyGen })).toEqual({ action: 'unmapped', kind: 'ac' })
  })
  it('a store with no OEM of the needed type: the AC service stays silent, a category reports it', () => {
    const none = { oem_id: null, genset_oem_id: null }
    expect(resolveOemRoute({ serviceAutoOemRouting: true, categoryOemKind: null, store: none })).toEqual({ action: 'none' })
    expect(resolveOemRoute({ serviceAutoOemRouting: false, categoryOemKind: 'genset', store: none })).toEqual({ action: 'unmapped', kind: 'genset' })
  })
  it('nothing asks for an OEM → a normal ticket; no store → nothing to send to', () => {
    expect(resolveOemRoute({ serviceAutoOemRouting: false, categoryOemKind: null, store: alc })).toEqual({ action: 'none' })
    expect(resolveOemRoute({ serviceAutoOemRouting: true, categoryOemKind: null, store: null })).toEqual({ action: 'none' })
    expect(resolveOemRoute({ serviceAutoOemRouting: false, categoryOemKind: 'genset', store: undefined })).toEqual({ action: 'unmapped', kind: 'genset' })
  })
})

describe('OEM kinds', () => {
  it('knows only ac and genset', () => {
    expect(isOemKind('ac')).toBe(true)
    expect(isOemKind('genset')).toBe(true)
    expect(isOemKind('ups')).toBe(false)
    expect(isOemKind(null)).toBe(false)
  })
  it('reads the right slot', () => {
    expect(storeOemFor(alc, 'ac')).toBe('bluestar-ac')
    expect(storeOemFor(alc, 'genset')).toBe('cummins-gen')
  })
  it('keeps the original AC wording', () => {
    expect(OEM_DEFAULT_TEXT.ac.subject).toBe('New AC Issue Ticket — {{ticket_no}}')
    expect(OEM_DEFAULT_TEXT.genset.subject).toContain('Genset')
  })
})
