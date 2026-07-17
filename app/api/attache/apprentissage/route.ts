/**
 * Apprentissage progressif de l'attaché — relais vers le service sidecar.
 * GET : statut (signaux captés depuis la dernière consolidation, mémoire face
 * à son budget, dernière consolidation). POST : consolidation à la demande
 * (run court sur le modèle économe, lancé en fond côté service).
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
    const res = await attacheFetch('/apprentissage', { method: 'POST' })
    return jsonResponse(await res.json().catch(() => ({ ok: false })), { status: res.status })
  })
}
