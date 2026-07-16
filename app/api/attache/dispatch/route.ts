/**
 * Dispatch de l'attaché — tâches confiées à distance, exécutées en tâche de
 * fond par le service et suivies depuis n'importe quel appareil (reçu →
 * en cours → terminé). Admin du TJ confié uniquement ; sinon 404,
 * indistinguable d'une route inexistante.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const res = await attacheFetch('/dispatch')
    return jsonResponse(await res.json().catch(() => ({ dispatches: [] })), { status: res.status })
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    const session = requireAttacheAdmin(req)
    const body = await req.json().catch(() => null)
    if (!body || typeof body.consigne !== 'string' || !body.consigne.trim()) {
      return jsonResponse({ error: 'Consigne requise' }, { status: 400 })
    }
    const res = await attacheFetch('/dispatch', { method: 'POST', body: { consigne: body.consigne, par: session.u } })
    return jsonResponse(await res.json().catch(() => ({ ok: false })), { status: res.status })
  })
}

export async function DELETE(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const id = new URL(req.url).searchParams.get('id') || ''
    const res = await attacheFetch('/dispatch?id=' + encodeURIComponent(id), { method: 'DELETE' })
    return jsonResponse(await res.json().catch(() => ({ ok: false })), { status: res.status })
  })
}
