/**
 * Analyse cartographique « en un clic » (Enrichir une fiche, Détecter les
 * camps) : le service lance un run EN FOND qui ne fait que déposer des
 * propositions ✓/✗ dans le panneau de revue de la carte — aucun chat.
 *
 * POST : démarre (202 si une analyse tourne déjà).
 * GET  : état de l'analyse en cours ou de la dernière terminée.
 * Admin du TJ confié uniquement — 404 pour tout autre compte.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const body = await req.json().catch(() => null)
    const consigne = body && typeof body.consigne === 'string' ? body.consigne : ''
    const libelle = body && typeof body.libelle === 'string' ? body.libelle : ''
    if (!consigne.trim()) return jsonResponse({ error: 'Consigne vide' }, { status: 400 })
    const res = await attacheFetch('/analyse-carto', { method: 'POST', body: { consigne, libelle }, timeoutMs: 30_000 })
    return jsonResponse(await res.json().catch(() => ({ ok: false, error: 'Réponse illisible du service attaché' })), { status: res.status })
  })
}

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const res = await attacheFetch('/analyse-carto', { timeoutMs: 10_000 })
    return jsonResponse(await res.json().catch(() => ({ etat: null })), { status: res.status })
  })
}
