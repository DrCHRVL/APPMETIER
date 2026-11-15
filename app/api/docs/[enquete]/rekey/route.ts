/**
 * Le dossier a changé de numéro : ses pièces suivent sous la nouvelle clé.
 * POST { toEnquete } — `toEnquete` : clé serveur du nouveau numéro. Répertoire
 * renommé d'un bloc, ou fusion sans écrasement si la clé cible existe déjà
 * (les homonymes restent sous l'ancienne clé, rendus dans `conflits`).
 * Audit doc.rekey.
 */
import { requireTjSession, handle, jsonResponse } from '@/lib/server/auth'
import { rekeyDocs, appendLog, isSafeName } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { enquete: string } }) {
  return handle(async () => {
    const session = requireTjSession(req)
    if (!isSafeName(params.enquete)) return jsonResponse({ error: 'Nom invalide' }, { status: 400 })
    const { toEnquete } = await req.json().catch(() => ({}))
    if (typeof toEnquete !== 'string' || !isSafeName(toEnquete)) return jsonResponse({ error: 'toEnquete requis' }, { status: 400 })
    const res = await rekeyDocs(session.tj, params.enquete, toEnquete)
    if (res.deplacees || res.conflits.length) {
      await appendLog('audit.jsonl', { timestamp: new Date().toISOString(), user: session.u, action: 'doc.rekey', details: { tj: session.tj, de: params.enquete, vers: toEnquete, ...res } })
    }
    return jsonResponse({ ok: true, ...res })
  })
}
