/**
 * Aiguillage des papeteries — relais vers le service Attaché.
 *
 * Trois actions, toutes en POST (le corps porte l'action) :
 *   - défaut / `choisir` : quelle papeterie pour cet acte, et où sont ses
 *     frontières. Le navigateur n'envoie que les lignes NUMÉROTÉES des
 *     extrémités de l'acte ; il ne reçoit que des numéros de ligne, et découpe
 *     lui-même son texte — le contenu de l'acte n'est jamais réécrit ailleurs.
 *   - `decrire` : le « quand l'utiliser » d'une papeterie fraîchement importée,
 *     d'après le texte visible de son modèle Word (aucune donnée d'enquête).
 *   - `signal` : le magistrat a écarté la papeterie proposée — capture au
 *     journal d'apprentissage.
 *
 * Rien n'est persisté ici : les règles d'aiguillage vivent côté navigateur,
 * avec les papeteries elles-mêmes.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

/** Un aiguillage se joue pendant que le magistrat attend son fichier. */
const TIMEOUT_CHOISIR = 60_000
const TIMEOUT_DECRIRE = 60_000
const TIMEOUT_SIGNAL = 10_000

export async function POST(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const action = String(body?.action || 'choisir')

    if (action === 'signal') {
      const res = await attacheFetch('/papeterie/signal', { method: 'POST', body, timeoutMs: TIMEOUT_SIGNAL })
      return new Response(await res.text(), { status: res.status, headers: { 'content-type': 'application/json' } })
    }

    if (action === 'decrire') {
      const res = await attacheFetch('/papeterie/decrire', { method: 'POST', body, timeoutMs: TIMEOUT_DECRIRE })
      return new Response(await res.text(), { status: res.status, headers: { 'content-type': 'application/json' } })
    }

    if (!Array.isArray(body?.papeteries) || !Array.isArray(body?.lignes)) {
      return jsonResponse({ ok: false, error: 'Papeteries et lignes de l\'acte requises' }, { status: 400 })
    }
    const res = await attacheFetch('/papeterie/choisir', { method: 'POST', body, timeoutMs: TIMEOUT_CHOISIR })
    return new Response(await res.text(), { status: res.status, headers: { 'content-type': 'application/json' } })
  })
}
