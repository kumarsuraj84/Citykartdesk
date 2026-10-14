// The database sends every timestamp with an offset of its own (on production "2026-10-12T11:45:52.273017-07:00"), so two timestamps, or a timestamp and a
// boundary written in UTC ("2026-10-12T18:30:00.000Z"), can only be compared as moments in time. Compared as text, a ticket created at 00:15 India time on
// 13 October (11:45 on 12 October at the database's offset) came out BEFORE a boundary at 00:00 India time on 13 October, and the dashboard card left it out.

/** A timestamp as a moment (epoch ms); NaN when it is not a timestamp. */
export const momentOf = (iso: string): number => new Date(iso).getTime()

/** How many of these timestamps are at or after the moment `startMs`. */
export const countSince = (stamps: readonly string[], startMs: number): number => stamps.reduce((n, s) => (momentOf(s) >= startMs ? n + 1 : n), 0)
