/**
 * Apprentissage progressif de l'attaché — relais vers le service sidecar.
 * GET : statut (signaux captés depuis la dernière consolidation, mémoire face
 * à son budget, progression mesurée, étude du corpus). POST : lance en fond,
 * au choix (body.action), la consolidation de la mémoire (défaut) ou l'étude
 * du corpus d'actes validés (extraction de modèles).
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const res = await attacheFetch('/apprentissage')
    return jsonResponse(await res.json().catch(() => ({})), { status: res.status })
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const body = await req.json().catch(() => ({} as { action?: string }))
    const cible = body?.action === 'etude' ? '/etude' : '/apprentissage'
    const res = await attacheFetch(cible, { method: 'POST' })
    return jsonResponse(await res.json().catch(() => ({ ok: false })), { status: res.status })
  })
}
