/**
 * Liste des comptes serveur (administrateur du TJ actif) : alimente le panneau « Accès & clés ».
 * Ne renvoie jamais les credentials — uniquement l'état d'accès, restreint
 * aux comptes membres du TJ actif (l'état trousseau/invitation est par TJ).
 */
import { requireTjAdmin, handle, jsonResponse, listAccounts, accountTjs, isTjAdmin } from '@/lib/server/auth'
import { listVaults } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    const session = requireTjAdmin(req)
    const vaults = new Set(listVaults(session.tj))
    const accounts = listAccounts()
      .filter((a) => accountTjs(a).includes(session.tj))
      .map((a) => ({
        username: a.username,
        displayName: a.displayName,
        role: a.role,
        tjAdmin: isTjAdmin(a, session.tj),
        tribunal: a.tribunal || null,
        tjs: accountTjs(a),
        createdAt: a.createdAt,
        lastLoginAt: a.lastLoginAt || null,
        hasKeyring: vaults.has(`keyring-${a.username}`),
        hasGrant: vaults.has(`grant-${a.username}`),
      }))
    return jsonResponse({ accounts })
  })
}
