/**
 * Diagnostic de la boîte dédiée de l'attaché : teste la connexion IMAP en
 * lecture seule (aucune relève, aucun message marqué lu) et renvoie un
 * diagnostic lisible. Administrateur du TJ confié uniquement.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    // la connexion IMAP peut prendre quelques secondes (TLS, latence)
    const res = await attacheFetch('/mail-test', { method: 'POST', timeoutMs: 60_000 })
    return jsonResponse(await res.json().catch(() => ({ ok: false, error: 'service injoignable' })), { status: res.status })
  })
}
