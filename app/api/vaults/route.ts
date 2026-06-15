/**
 * Liste des NOMS de coffres par préfixe (sans leur contenu chiffré). Accessible
 * à tout utilisateur authentifié : sert à la découverte des invitations de
 * partage (modules AIR et instruction), où le client doit énumérer les coffres
 * `air-<user>` / `instructions-<user>` puis vérifier, après déchiffrement local,
 * lesquels le citent dans leur `shareWith`.
 *
 * Ne renvoie JAMAIS de contenu : uniquement des noms. Le préfixe est restreint à
 * une allowlist pour éviter d'exposer d'autres familles de coffres (trousseaux,
 * invitations, données partagées…).
 */
import { requireSession, handle, jsonResponse } from '@/lib/server/auth'
import { listVaults } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

// Préfixes dont l'énumération est autorisée (découverte de partage par module).
const ALLOWED_PREFIXES = ['air-', 'instructions-']

export async function GET(req: Request) {
  return handle(async () => {
    requireSession(req)
    const prefix = new URL(req.url).searchParams.get('prefix') || ''
    if (!ALLOWED_PREFIXES.includes(prefix)) {
      return jsonResponse({ error: 'Préfixe non autorisé' }, { status: 400 })
    }
    const names = listVaults().filter((n) => n.startsWith(prefix))
    return jsonResponse({ names })
  })
}
