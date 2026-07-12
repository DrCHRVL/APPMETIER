/**
 * Une conversation de l'attaché : enveloppe chiffrée (déchiffrée par le
 * navigateur admin avec sa clé globale) — lecture et suppression.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const res = await attacheFetch('/conversation?id=' + encodeURIComponent(params.id))
    return jsonResponse(await res.json().catch(() => ({ error: 'Réponse illisible' })), { status: res.status })
  })
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const res = await attacheFetch('/conversation?id=' + encodeURIComponent(params.id), { method: 'DELETE' })
    return jsonResponse(await res.json().catch(() => ({ ok: false })), { status: res.status })
  })
}
