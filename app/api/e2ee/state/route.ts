/**
 * État E2EE pour l'utilisateur connecté, dans l'espace de son TJ actif :
 * guide la porte d'entrée web.
 *  - legacyKdf    : un coffre « phrase de service » historique existe (kdf.json)
 *  - hasKeyring   : MON trousseau individuel existe
 *  - hasGrant     : une invitation m'attend
 *  - anyKeyrings  : au moins un trousseau existe dans ce TJ
 *  - canInitialize: je suis l'administrateur de ce TJ (création des clés)
 */
import { requireTjSession, handle, jsonResponse, findAccount, isTjAdmin, canInitializeTj } from '@/lib/server/auth'
import { tjDataDir, readJson, listVaults, readVault } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    const session = requireTjSession(req)
    const kdf = readJson<{ salt: string } | null>(tjDataDir(session.tj, 'kdf.json'), null)
    const vaults = listVaults(session.tj)
    const grantName = `grant-${session.u}`
    const grant = vaults.includes(grantName) ? readVault(session.tj, grantName) : null
    const escrow = vaults.includes('escrow-keys')
      ? readVault(session.tj, 'escrow-keys') as unknown as { publicId?: string, fp?: string, scopes?: string[], savedAt?: string }
      : null
    return jsonResponse({
      legacyKdf: !!kdf,
      legacyKdfParams: kdf,
      hasKeyring: vaults.includes(`keyring-${session.u}`),
      hasGrant: !!grant,
      grantKdf: grant ? { salt: grant.kdfSalt, iterations: grant.kdfIterations, grantedBy: grant.savedBy } : null,
      anyKeyrings: vaults.some((v) => v.startsWith('keyring-')),
      // TJ vierge : seul son administrateur local peut en créer les clés
      canInitialize: canInitializeTj(findAccount(session.u), session.tj),
      // administrateur du TJ : dépose le séquestre pour l'administrateur général
      isTjAdmin: isTjAdmin(findAccount(session.u), session.tj),
      // séquestre (métadonnées non secrètes : quelle paire, quelles clés)
      // (réservé aux administrateurs : un membre n'en a pas l'usage)
      escrow: escrow && (session.r === 'admin' || isTjAdmin(findAccount(session.u), session.tj))
        ? { publicId: escrow.publicId, fp: escrow.fp, scopes: escrow.scopes || [], savedAt: escrow.savedAt || null }
        : null,
    })
  })
}
