/**
 * Mémoire légère d'un dossier (essentiel des échanges du chat) — lecture et
 * édition manuelle par l'administrateur. Petite par construction (plafonnée
 * côté service). Admin du TJ confié uniquement.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const numero = new URL(req.url).searchParams.get('numero') || ''
    const res = await attacheFetch('/dossier-memoire?numero=' + encodeURIComponent(numero))
    return jsonResponse(await res.json().catch(() => ({ memoire: '' })), { status: res.status })
  })
}

export async function PUT(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const body = await req.json().catch(() => null) as { numero?: string, contenu?: string } | null
    if (!body?.numero) return jsonResponse({ error: 'numero requis' }, { status: 400 })
    if ((body.contenu || '').length > 8000) return jsonResponse({ error: 'Mémoire trop volumineuse' }, { status: 413 })
    const res = await attacheFetch('/dossier-memoire', { method: 'PUT', body: { numero: body.numero, contenu: body.contenu || '' } })
    return jsonResponse(await res.json().catch(() => ({ ok: false })), { status: res.status })
  })
}
