/**
 * Transfert d'une pièce vers un AUTRE dossier (pièce versée au mauvais
 * endroit, signalée par la veille des recoupements).
 * POST { from, toEnquete, to? } — `toEnquete` : clé serveur du dossier cible ;
 * `to` : chemin dans le dossier cible (défaut : le même). L'original chiffré
 * est déplacé tel quel, le jumeau markdown suit, les deux index sont mis à
 * jour. Refuse d'écraser. Audit doc.transfer.
 */
import { requireTjSession, handle, jsonResponse } from '@/lib/server/auth'
import { transferDoc, appendLog, isSafeName } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { enquete: string } }) {
  return handle(async () => {
    const session = requireTjSession(req)
    if (!isSafeName(params.enquete)) return jsonResponse({ error: 'Nom invalide' }, { status: 400 })
    const { from, toEnquete, to } = await req.json().catch(() => ({}))
    if (typeof from !== 'string' || !from || typeof toEnquete !== 'string' || !isSafeName(toEnquete)) {
      return jsonResponse({ error: 'from et toEnquete requis' }, { status: 400 })
    }
    const cible = typeof to === 'string' && to ? to : from
    let meta
    try {
      meta = await transferDoc(session.tj, params.enquete, from, toEnquete, cible)
    } catch (e) {
      return jsonResponse({ error: e instanceof Error ? e.message : 'Transfert impossible' }, { status: 400 })
    }
    await appendLog('audit.jsonl', { timestamp: new Date().toISOString(), user: session.u, action: 'doc.transfer', details: { tj: session.tj, de: params.enquete, vers: toEnquete, from, to: cible } })
    return jsonResponse({ ok: true, meta })
  })
}
