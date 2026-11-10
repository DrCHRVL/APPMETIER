/**
 * Liste des comptes serveur (administrateur du TJ actif) : alimente le panneau « Accès & clés ».
 * Ne renvoie jamais les credentials — uniquement l'état d'accès, restreint
 * aux comptes membres du TJ actif (l'état trousseau/invitation est par TJ).
 */
import { requireTjAdmin, handle, jsonResponse, listAccounts, accountTjs, isTjAdmin } from '@/lib/server/auth'
import { listVaults, readLog } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

/** Actions de l'administrateur général portées à la connaissance des administrateurs locaux. */
const ACTIONS_GENERAL: Record<string, string> = {
  'auth.switch-tj': 'a ouvert le tribunal',
  'escrow.read': 'a ouvert le séquestre des clés',
  'tj.donnees.lecture': 'a lu à distance',
  'tj.donnees.invitation': 'a déposé une invitation',
  'tj.donnees.reinitialisation': 'a réinitialisé un accès',
  'account.create': 'a créé un compte',
  'account.suspendre': 'a suspendu un compte',
  'account.reactiver': 'a réactivé un compte',
  'account.admin-local': 'a changé un administrateur local',
  'account.tribunal': 'a déplacé un compte',
  'account.mot-de-passe': 'a donné un mot de passe provisoire',
  'tj.code.regenerate': 'a régénéré le code d’accès',
}

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
    // Les administrateurs locaux sont informés de l'accès de l'administrateur
    // général à LEUR tribunal : état de cet accès et ses actions récentes.
    const general = listAccounts().find((a) => a.role === 'admin')
    const journal = general ? readLog<{ timestamp: string, user: string, action: string, details?: Record<string, unknown> }>('audit.jsonl', { max: 5000 })
      .filter((e) => e.user === general.username && ACTIONS_GENERAL[e.action] && (
        e.details?.tj === session.tj || e.details?.to === session.tj || e.details?.vers === session.tj))
      .slice(-15).reverse()
      .map((e) => ({ date: e.timestamp, action: ACTIONS_GENERAL[e.action], details: e.details?.coffre || e.details?.username || null }))
      : []
    const adminGeneral = general ? {
      displayName: general.displayName,
      acces: vaults.has(`keyring-${general.username}`) ? 'ouvert' : vaults.has('escrow-keys') ? 'pret' : 'non-depose',
      journal,
    } : null
    return jsonResponse({ accounts, generaux, adminGeneral })
  })
}
