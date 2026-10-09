/**
 * Ligne de chat « améliorer ce prompt » (Paramètres → Attaché IA) : le
 * magistrat décrit l'amélioration voulue, le service attaché rend le prompt
 * RÉÉCRIT. Rien n'est enregistré ici — le navigateur montre la proposition,
 * le magistrat l'adopte puis l'enregistre (chiffrée) via PUT /consignes.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const body = await req.json().catch(() => null) as { id?: unknown, texte?: unknown, demande?: unknown } | null
    const id = typeof body?.id === 'string' ? body.id : ''
    const demande = typeof body?.demande === 'string' ? body.demande.trim() : ''
    const texte = typeof body?.texte === 'string' ? body.texte : ''
    if (!id || !demande) return jsonResponse({ error: 'Prompt et demande requis' }, { status: 400 })
    const res = await attacheFetch('/consignes-ameliorer', {
      method: 'POST',
      body: { id, texte, demande },
      timeoutMs: 4 * 60 * 1000,
    })
    return jsonResponse(await res.json().catch(() => ({ ok: false, error: 'Réponse illisible du service attaché' })), { status: res.status })
  })
}
