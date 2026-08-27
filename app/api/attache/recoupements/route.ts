/**
 * Chantier de recoupements — déclenchement et état, administrateur seulement.
 *
 * Le RÉSULTAT, lui, ne passe pas par ici : l'attaché l'écrit dans le coffre
 * chiffré `recoupements` (clé globale), que tout utilisateur lit par le chemin
 * ordinaire des coffres. C'est ce qui permet aux signaux d'être visibles de
 * tous sans que l'existence de l'attaché ne soit visible de personne — seul
 * l'administrateur du TJ confié voit cette route ; les autres reçoivent le
 * même 404 qu'une route inexistante.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const res = await attacheFetch('/recoupements')
    const data = await res.json().catch(() => ({ error: 'Réponse illisible' }))
    return jsonResponse(data, { status: res.status })
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    // Un tour complet peut durer : le fonds entier, pièces comprises. On laisse
    // au service tout le temps qu'il lui faut plutôt que de rendre une erreur
    // de délai sur un calcul qui, lui, ira jusqu'au bout.
    const res = await attacheFetch('/recoupements', { method: 'POST', body: {}, timeoutMs: 6 * 3600_000 })
    const data = await res.json().catch(() => ({ error: 'Réponse illisible' }))
    return jsonResponse(data, { status: res.status })
  })
}
