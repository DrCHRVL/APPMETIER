/**
 * Actualise « à la demande » la description (l'« objet ») d'un dossier : l'icône
 * « Actualiser » à côté du titre Description déclenche l'attaché, qui reprend la
 * synthèse et la fait progresser (deux parties, prise de notes) à partir des CR
 * et des actes/documents téléversés. Le run est court et économe ; il tourne
 * aussi TOUT SEUL en arrière-plan à chaque ajout (service attaché). Admin du TJ
 * confié uniquement — 404 pour tout autre compte.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'
// Le run est awaité côté service (modèle économe, ≤ 8 min) pour que le
// navigateur enchaîne sur syncAndRefresh et affiche la nouvelle description.
export const maxDuration = 600

export async function POST(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const body = await req.json().catch(() => null)
    const numero = body && typeof body.numero === 'string' ? body.numero.trim() : ''
    if (!numero) return jsonResponse({ error: 'Numéro requis' }, { status: 400 })
    const res = await attacheFetch('/actualiser-description', {
      method: 'POST',
      body: { numero },
      timeoutMs: 9 * 60 * 1000,
    })
    return jsonResponse(await res.json().catch(() => ({ ok: false, error: 'Réponse illisible du service attaché' })), { status: res.status })
  })
}
