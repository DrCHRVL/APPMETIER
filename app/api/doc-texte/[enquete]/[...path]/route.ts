/**
 * Texte DÉJÀ EXTRAIT d'une pièce — lecture seule, tout utilisateur authentifié.
 *
 * Rend l'enveloppe chiffrée du texte, que le navigateur ouvre avec sa clé
 * « global ». Le serveur ne déchiffre rien : il retrouve un fichier, vérifie
 * qu'il correspond bien à la pièce en place, et le transmet.
 *
 * 404 = aucun texte disponible pour cette pièce. Le navigateur extrait alors
 * lui-même, comme il l'a toujours fait : la recherche documentaire ne dépend
 * jamais de ce chemin, elle est seulement bien plus rapide et bien plus
 * complète quand il répond (les pièces scannées ne sont océrisées que côté
 * serveur).
 */
import { requireTjSession, handle, jsonResponse } from '@/lib/server/auth'
import { isSafeName, isSafeRelPath } from '@/lib/server/store'
import { lireTexteEnCache } from '@/lib/server/docTexte'

export const dynamic = 'force-dynamic'

function safeDecode(s: string): string {
  // Un pourcentage isolé fait lever URIError : on rend le segment brut, qu'
  // isSafeRelPath rejettera en 400 plutôt que de laisser remonter un 500.
  try { return decodeURIComponent(s) } catch { return s }
}

export async function GET(req: Request, { params }: { params: { enquete: string, path: string[] } }) {
  return handle(async () => {
    const session = requireTjSession(req)
    const rel = params.path.map(safeDecode).join('/')
    if (!isSafeName(params.enquete) || !isSafeRelPath(rel)) {
      return jsonResponse({ error: 'Chemin invalide' }, { status: 400 })
    }
    const trouve = lireTexteEnCache(session.tj, params.enquete, rel)
    if (!trouve) return jsonResponse({ error: 'Aucun texte en cache' }, { status: 404 })
    return jsonResponse(trouve, { headers: { 'cache-control': 'no-store' } })
  })
}
