/** Déclenche un brief du majordome à la demande (lancé en fond côté service). */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const res = await attacheFetch('/briefing', { method: 'POST' })
    return jsonResponse(await res.json().catch(() => ({ ok: false })), { status: res.status })
  })
}
