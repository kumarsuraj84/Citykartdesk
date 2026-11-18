// Short interruptions: the probe's tracker (what it stores) and the page's merge (what it shows). A restart or deployment of 10-30 seconds must not be lost.
import { describe, it, expect } from 'vitest'
import { createOutageTracker } from '../../scripts/health-probe.mjs'
import { mergeBlips, sumInterruptions, humanSeconds } from '@/lib/health/blips'

describe('the probe follows a failing check and reports each stretch once', () => {
  it('a stretch ends at the first good answer, and lasts from the first failed one', () => {
    const t = createOutageTracker()
    expect(t.observe('app', true, '', 0)).toBeNull()
    expect(t.observe('app', false, 'the app answered 502', 5_000)).toBeNull()
    expect(t.observe('app', false, 'the app answered 502', 10_000)).toBeNull()
    const done = t.observe('app', true, '', 25_000)
    expect(done).toMatchObject({ key: 'app', startedAt: 5_000, endedAt: 25_000, seconds: 20, detail: 'the app answered 502', ongoing: false })
    expect(t.finish(30_000)).toEqual([])                       // nothing left over
  })
  it('a stretch still going when the minute ends is reported as ongoing, once', () => {
    const t = createOutageTracker()
    t.observe('postgrest', false, 'refused', 1_000)
    expect(t.finish(50_000)).toMatchObject([{ key: 'postgrest', seconds: 49, ongoing: true }])
    expect(t.finish(55_000)).toEqual([])
  })
  it('keeps each check separate', () => {
    const t = createOutageTracker()
    t.observe('app', false, 'x', 0); t.observe('proxy', false, 'y', 0)
    expect(t.observe('proxy', true, '', 7_000)).toMatchObject({ key: 'proxy', seconds: 7 })
    expect(t.finish(9_000)).toMatchObject([{ key: 'app' }])
  })
})

describe('the page list of interruptions', () => {
  const row = (key: string, at: string, ms: number, detail: string | null = 'the app answered 502') => ({ check_key: `blip_${key}`, at, ms, detail })
  it('shows a short stretch as one line with its length, newest first', () => {
    const list = mergeBlips([row('app', '2026-11-18T05:00:10Z', 18_000), row('postgrest', '2026-11-18T06:00:00Z', 6_000, 'refused')])
    expect(list.map((i) => [i.checkKey, i.seconds])).toEqual([['postgrest', 6], ['app', 18]])
    expect(list[1]).toMatchObject({ startedAt: '2026-11-18T05:00:10.000Z', ongoing: false })
  })
  it('joins a stretch that carried on into the next minute into ONE interruption', () => {
    const cont = ' (still not answering when this minute ended)'
    const list = mergeBlips([
      row('app', '2026-11-18T05:00:10Z', 49_000, 'refused' + cont),
      row('app', '2026-11-18T05:01:00Z', 40_000, 'refused' + cont),   // begins 1 s after the first ended
      row('app', '2026-11-18T05:01:50Z', 12_000, 'refused'),          // ends here: the app is back
    ])
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ checkKey: 'app', seconds: 112, ongoing: false, detail: 'refused' })
  })
  it('keeps two separate hiccups separate, and ignores rows that are not interruptions', () => {
    const list = mergeBlips([row('app', '2026-11-18T05:00:00Z', 5_000), row('app', '2026-11-18T07:00:00Z', 5_000), { check_key: 'app', at: '2026-11-18T07:00:00Z', ms: 30, detail: 'x' }])
    expect(list).toHaveLength(2)
  })
  it('adds up per check, and says the time in plain words', () => {
    const list = mergeBlips([row('app', '2026-11-18T05:00:00Z', 20_000), row('app', '2026-11-18T05:30:00Z', 15_000), row('proxy', '2026-11-17T01:00:00Z', 9_000)])
    expect(sumInterruptions(list, new Date('2026-11-18T00:00:00Z').getTime())).toEqual({ app: { count: 2, seconds: 35 } })
    expect([18, 60, 125, 3600, 3780].map(humanSeconds)).toEqual(['18 s', '1 min', '2 min 5 s', '1 h', '1 h 3 min'])
  })
})
