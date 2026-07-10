/** Conversations de l'attaché : liste (métadonnées) — admin du TJ confié. */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const res = await attacheFetch('/conversations')
    return jsonResponse(await res.json().catch(() => ({ conversations: [] })), { status: res.status })
  })
}
