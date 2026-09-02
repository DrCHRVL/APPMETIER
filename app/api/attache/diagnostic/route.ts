/**
 * Pourquoi l'assistant de justice n'apparaît-il pas ?
 *
 * /api/attache/status répond 404 dès qu'une des trois conditions manque
 * (session admin, fonctionnalité activée, TJ actif = TJ confié) — muet par
 * construction : l'attaché ne doit se deviner d'aucun autre compte. Muet,
 * l'administrateur lui-même n'avait aucun moyen de savoir LAQUELLE manquait.
 *
 * Cette route nomme la condition en défaut, et seulement à une session
 * administrateur : tout autre appelant reçoit le 404 d'une route inexistante.
 */
import { handle, jsonResponse, requireTjSession } from '@/lib/server/auth'
import { attacheDiagnostic } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    const session = requireTjSession(req)
    if (session.r !== 'admin') {
      return jsonResponse({ error: 'Introuvable' }, { status: 404 })
    }
    return jsonResponse(await attacheDiagnostic(session))
  })
}
