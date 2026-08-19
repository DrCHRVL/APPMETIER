/**
 * Chantiers d'analyse profonde de l'attaché : liste, création (devis),
 * actions (lancer / pause / supprimer). Admin du TJ confié uniquement —
 * simple relais vers le service attaché, seul détenteur des clés.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const res = await attacheFetch('/chantiers')
    return jsonResponse(await res.json().catch(() => ({ chantiers: [] })), { status: res.status })
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const body = await req.json().catch(() => ({}))
    // la création bâtit le plan depuis l'index des pièces : peut prendre un moment
    const res = await attacheFetch('/chantiers', { method: 'POST', body, timeoutMs: 60_000 })
    return jsonResponse(await res.json().catch(() => ({ error: 'Service injoignable' })), { status: res.status })
  })
}
