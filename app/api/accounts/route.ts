/**
 * Liste des comptes serveur (admin) : alimente le panneau « Accès & clés ».
 * Ne renvoie jamais les credentials — uniquement l'état d'accès.
 */
import { requireSession, handle, jsonResponse, listAccounts } from '@/lib/server/auth'
import { listVaults } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    const session = requireSession(req)
    if (session.r !== 'admin') return jsonResponse({ error: 'Réservé aux administrateurs' }, { status: 403 })
    const vaults = new Set(listVaults())
    const accounts = listAccounts().map((a) => ({
      username: a.username,
      displayName: a.displayName,
      role: a.role,
      tribunal: a.tribunal || null,
      createdAt: a.createdAt,
      lastLoginAt: a.lastLoginAt || null,
      hasKeyring: vaults.has(`keyring-${a.username}`),
      hasGrant: vaults.has(`grant-${a.username}`),
    }))
    return jsonResponse({ accounts })
  })
}
