/**
 * Chronologie probatoire d'un dossier (construite par le service attaché :
 * actes, prolongations, CR, modifications, DML, cotes NPP datées) et import
 * de l'architecture NPP collée par le magistrat. Admin du TJ confié.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const numero = new URL(req.url).searchParams.get('numero') || ''
    const res = await attacheFetch('/chronologie?numero=' + encodeURIComponent(numero))
    return jsonResponse(await res.json().catch(() => ({ error: 'Réponse illisible' })), { status: res.status })
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    const session = requireAttacheAdmin(req)
    const body = await req.json().catch(() => null) as { numero?: string, texte?: string } | null
    if (!body?.numero || !body?.texte) return jsonResponse({ error: 'numero et texte requis' }, { status: 400 })
    if (body.texte.length > 6 * 1024 * 1024) return jsonResponse({ error: 'Arborescence trop volumineuse' }, { status: 413 })
    const res = await attacheFetch('/cotes', { method: 'POST', body: { numero: body.numero, texte: body.texte, par: session.u }, timeoutMs: 60_000 })
    return jsonResponse(await res.json().catch(() => ({ ok: false })), { status: res.status })
  })
}
