import { jsonResponse, clearSessionCookieHeader } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

export async function POST() {
  return jsonResponse({ ok: true }, { headers: { 'set-cookie': clearSessionCookieHeader() } })
}
