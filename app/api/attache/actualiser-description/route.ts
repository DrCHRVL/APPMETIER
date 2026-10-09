/**
 * Actualise « à la demande » la description (l'« objet ») d'un dossier : l'icône
 * « Actualiser » à côté du titre Description déclenche l'attaché, qui relit
 * TOUT le dossier (CR, actes, sommaire des pièces serveur) et, d'un même
 * passage, rédige la description, tient les rôles des mis en cause, propose
 * suspects et liens de cartographie, et note les acquis en mémoire.
 *
 * POST : démarre le travail EN FOND (réponse immédiate, ou 202 si une
 *        actualisation tourne déjà).
 * GET  : avancement — phase, étapes, pourcentage, temps restant estimé,
 *        bilan une fois terminé. Le navigateur l'interroge toutes les 2-3 s.
 * Admin du TJ confié uniquement — 404 pour tout autre compte.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const body = await req.json().catch(() => null)
    const numero = body && typeof body.numero === 'string' ? body.numero.trim() : ''
    if (!numero) return jsonResponse({ error: 'Numéro requis' }, { status: 400 })
    const res = await attacheFetch('/actualiser-description', {
      method: 'POST',
      body: { numero },
      timeoutMs: 30_000,
    })
    return jsonResponse(await res.json().catch(() => ({ ok: false, error: 'Réponse illisible du service attaché' })), { status: res.status })
  })
}

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const res = await attacheFetch('/actualiser-description', { timeoutMs: 10_000 })
    return jsonResponse(await res.json().catch(() => ({ etat: null })), { status: res.status })
  })
}
