/**
 * Réveil du FLUX TENDU de l'attaché depuis le navigateur : le store des
 * enquêtes prévient qu'un dossier a bougé (CR rédigé, acte ajouté, document
 * inscrit) — par n'importe quel utilisateur du TJ confié, pas seulement
 * l'administrateur : ce qu'un collègue verse doit réveiller l'attaché aussi.
 *
 * Ne relaie que des numéros de dossier (déjà en clair côté serveur : clés des
 * pochettes de documents), une raison et l'auteur. Silencieux hors TJ confié
 * ou attaché désactivé — le navigateur n'a rien à en faire.
 */
import { handle, jsonResponse, requireTjSession } from '@/lib/server/auth'
import { attacheEnabled, attacheTjId, reveilAttache } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handle(async () => {
    const session = requireTjSession(req)
    if (!attacheEnabled() || session.tj !== attacheTjId()) return jsonResponse({ ok: true, ignore: true })
    const body = await req.json().catch(() => null) as { numeros?: unknown, raison?: unknown } | null
    const numeros = (Array.isArray(body?.numeros) ? body!.numeros : [])
      .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
      .map((n) => n.trim().slice(0, 120))
      .slice(0, 50)
    if (!numeros.length) return jsonResponse({ error: 'numeros requis' }, { status: 400 })
    const raison = typeof body?.raison === 'string' ? body.raison.slice(0, 40) : 'dossier'
    reveilAttache({ numeros, raison, par: session.u })
    return jsonResponse({ ok: true })
  })
}
