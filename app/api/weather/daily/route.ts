import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyCronSecret } from '@/lib/cron-auth'
import { refreshWeather } from '@/lib/weather/refresh'
import { recordAudit } from '@/lib/syslog/audit'

// Scheduled job (cron-tick job "weather-daily", every day at 08:00 India time): saves the highest and lowest outside temperature of every city that has an AC, for the
// AC Calendar on the Smart Dashboard. It is the only caller of the weather service; page views never are. Only city names and states are sent out.
export async function GET(req: NextRequest) {
  const verified = verifyCronSecret(req)
  if (verified === null) return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 })
  if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await refreshWeather(createAdminClient() as any, fetch as never)
    await recordAudit({ action: 'weather.refreshed', source: 'cron', entityType: 'weather', message: `Temperatures saved for ${result.refreshed} of ${result.cities} cities (${result.geocodeFailed} not found: ${result.notFound.slice(0, 8).join(', ') || 'none'}; ${result.failed} failed)`, detail: { ...result } })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[weather/daily] failed', e)
    return NextResponse.json({ ok: false, error: 'weather refresh failed' }, { status: 500 })
  }
}
