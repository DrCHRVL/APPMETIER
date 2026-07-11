/**
 * Routines de l'attaché — consignes récurrentes du magistrat (quotidiennes
 * à HH:MM ou toutes les N heures), exécutées par le service. Admin du TJ
 * confié uniquement. `?run=<id>` en POST déclenche une exécution immédiate.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const res = await attacheFetch('/routines')
    return jsonResponse(await res.json().catch(() => ({ routines: [] })), { status: res.status })
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    const session = requireAttacheAdmin(req)
    const runId = new URL(req.url).searchParams.get('run')
    if (runId) {
      const res = await attacheFetch('/routines/run?id=' + encodeURIComponent(runId), { method: 'POST' })
      return jsonResponse(await res.json().catch(() => ({ ok: false })), { status: res.status })
    }
    const body = await req.json().catch(() => null)
    if (!body) return jsonResponse({ error: 'Corps requis' }, { status: 400 })
    const res = await attacheFetch('/routines', { method: 'POST', body: { ...body, par: session.u } })
    return jsonResponse(await res.json().catch(() => ({ ok: false })), { status: res.status })
  })
}

export async function DELETE(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const id = new URL(req.url).searchParams.get('id') || ''
    const res = await attacheFetch('/routines?id=' + encodeURIComponent(id), { method: 'DELETE' })
    return jsonResponse(await res.json().catch(() => ({ ok: false })), { status: res.status })
  })
}
