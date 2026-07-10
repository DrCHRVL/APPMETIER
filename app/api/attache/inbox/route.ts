/**
 * Boîte dédiée de l'attaché : liste des messages (métadonnées) et
 * déclenchement manuel d'une relève. Admin du TJ confié uniquement.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const res = await attacheFetch('/inbox')
    return jsonResponse(await res.json().catch(() => ({ messages: [] })), { status: res.status })
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    // relève IMAP : peut prendre quelques dizaines de secondes
    const res = await attacheFetch('/check-mail', { method: 'POST', timeoutMs: 120_000 })
    return jsonResponse(await res.json().catch(() => ({ ok: false })), { status: res.status })
  })
}
