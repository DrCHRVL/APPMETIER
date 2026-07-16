/**
 * Réglages IMAP/SMTP de la boîte dédiée, saisis dans l'app. Simple relais
 * vers le service attaché (seul détenteur de la clé-maître, qui chiffre le
 * mot de passe au repos) ; réservé à l'administrateur du TJ confié.
 *
 * PUT    : enregistre/complète les réglages (mot de passe vide = inchangé).
 * DELETE : efface les réglages in-app — retour aux variables d'environnement.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function PUT(req: Request) {
  return handle(async () => {
    const session = requireAttacheAdmin(req)
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return jsonResponse({ error: 'Corps requis' }, { status: 400 })
    const res = await attacheFetch('/mail-config', { method: 'PUT', body: { ...body, par: session.u } })
    return jsonResponse(await res.json().catch(() => ({ ok: false, error: 'Réponse illisible' })), { status: res.status })
  })
}

export async function DELETE(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const res = await attacheFetch('/mail-config', { method: 'DELETE' })
    return jsonResponse(await res.json().catch(() => ({ ok: false, error: 'Réponse illisible' })), { status: res.status })
  })
}
