/**
 * Actes rédigés d'un dossier (« Atelier ») — enveloppes chiffrées déchiffrées
 * par le navigateur de l'administrateur. Admin du TJ confié uniquement.
 * GET  ?numero=      → liste des productions (enveloppes)
 * PUT  {numero,id,envelope} → édition manuelle (navigateur chiffre, service stocke)
 * DELETE ?numero=&id= → suppression (réversible côté service)
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const numero = new URL(req.url).searchParams.get('numero') || ''
    const res = await attacheFetch('/productions?numero=' + encodeURIComponent(numero))
    return jsonResponse(await res.json().catch(() => ({ productions: [] })), { status: res.status })
  })
}

export async function PUT(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const body = await req.json().catch(() => null) as { numero?: string, id?: string, envelope?: unknown } | null
    if (!body?.numero || !body?.id || !body?.envelope) return jsonResponse({ error: 'numero, id, envelope requis' }, { status: 400 })
    const res = await attacheFetch('/production', { method: 'PUT', body })
    return jsonResponse(await res.json().catch(() => ({ ok: false })), { status: res.status })
  })
}

export async function DELETE(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const u = new URL(req.url)
    const res = await attacheFetch('/production?numero=' + encodeURIComponent(u.searchParams.get('numero') || '') + '&id=' + encodeURIComponent(u.searchParams.get('id') || ''), { method: 'DELETE' })
    return jsonResponse(await res.json().catch(() => ({ ok: false })), { status: res.status })
  })
}
