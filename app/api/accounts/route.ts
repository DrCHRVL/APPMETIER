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
    // L'administrateur général (rattaché à tous les TJ) n'apparaît pas dans
    // les listes locales : son accès ne relève pas des administrateurs locaux.
    const generaux = listAccounts().filter((a) => a.role === 'admin').map((a) => a.username)
    const accounts = listAccounts()
      .filter((a) => a.role !== 'admin' && accountTjs(a).includes(session.tj))
      .map((a) => ({
        username: a.username,
        displayName: a.displayName,
        role: a.role,
        tjAdmin: isTjAdmin(a, session.tj),
        tribunal: a.tribunal || null,
        tjs: accountTjs(a),
        createdAt: a.createdAt,
        lastLoginAt: a.lastLoginAt || null,
        suspendu: a.suspendu === true,
        hasKeyring: vaults.has(`keyring-${a.username}`),
        hasGrant: vaults.has(`grant-${a.username}`),
      }))
    // Les administrateurs locaux savent si l'administrateur général peut accéder
    // à LEUR tribunal (état de l'accès) — sans le détail de ses consultations.
    const general = listAccounts().find((a) => a.role === 'admin')
    const adminGeneral = general ? {
      displayName: general.displayName,
      acces: vaults.has(`keyring-${general.username}`) ? 'ouvert' : vaults.has('escrow-keys') ? 'pret' : 'non-depose',
    } : null
    return jsonResponse({ accounts, generaux, adminGeneral })
  })
}
