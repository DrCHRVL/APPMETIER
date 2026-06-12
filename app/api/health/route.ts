import { jsonResponse } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  return jsonResponse({ ok: true, ts: Date.now() })
}
