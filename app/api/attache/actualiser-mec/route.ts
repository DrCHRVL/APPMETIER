/**
 * Actualise « à la demande » les MIS EN CAUSE d'un dossier : l'icône
 * « Actualiser » à côté du + de la section Mis en cause déclenche l'attaché,
 * qui relit les CR, actes et documents et PROPOSE (✓/✗, bandeau du dossier) les
 * personnes mises en cause qui n'y figurent pas encore. Aucune écriture directe
 * — le magistrat valide. Le run est court et économe ; il tourne aussi tout
 * seul avec l'actualisation de la description (même passe). Admin du TJ confié
 * uniquement — 404 pour tout autre compte.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'
// Le run est awaité côté service (modèle économe, ≤ 8 min) pour que le
// navigateur affiche les propositions déposées dans la foulée.
export const maxDuration = 600

export async function POST(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const body = await req.json().catch(() => null)
    const numero = body && typeof body.numero === 'string' ? body.numero.trim() : ''
    if (!numero) return jsonResponse({ error: 'Numéro requis' }, { status: 400 })
    const res = await attacheFetch('/actualiser-mec', {
      method: 'POST',
      body: { numero },
      timeoutMs: 9 * 60 * 1000,
    })
    return jsonResponse(await res.json().catch(() => ({ ok: false, error: 'Réponse illisible du service attaché' })), { status: res.status })
  })
}
