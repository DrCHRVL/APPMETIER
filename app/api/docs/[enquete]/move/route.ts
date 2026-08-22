/**
 * Déplacement / renommage d'une pièce d'enquête (explorateur de pièces).
 * POST { from, to } — l'original chiffré est renommé sur place (jamais
 * réécrit), le jumeau markdown suit, l'index est mis à jour. Audit doc.move.
 */
import { requireTjSession, handle, jsonResponse } from '@/lib/server/auth'
import { moveDoc, appendLog, isSafeName } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { enquete: string } }) {
  return handle(async () => {
    const session = requireTjSession(req)
    if (!isSafeName(params.enquete)) return jsonResponse({ error: 'Nom invalide' }, { status: 400 })
    const { from, to } = await req.json().catch(() => ({}))
    if (typeof from !== 'string' || typeof to !== 'string' || !from || !to) {
      return jsonResponse({ error: 'from et to requis' }, { status: 400 })
    }
    let meta
    try {
      meta = await moveDoc(session.tj, params.enquete, from, to)
    } catch (e) {
      return jsonResponse({ error: e instanceof Error ? e.message : 'Déplacement impossible' }, { status: 400 })
    }
    await appendLog('audit.jsonl', { timestamp: new Date().toISOString(), user: session.u, action: 'doc.move', details: { tj: session.tj, enquete: params.enquete, from, to } })
    return jsonResponse({ ok: true, meta })
  })
}
