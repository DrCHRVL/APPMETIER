/**
 * État E2EE pour l'utilisateur connecté : guide la porte d'entrée web.
 *  - legacyKdf    : un coffre « phrase de service » historique existe (kdf.json)
 *  - hasKeyring   : MON trousseau individuel existe
 *  - hasGrant     : une invitation m'attend
 *  - anyKeyrings  : MA juridiction est déjà initialisée (coffre-témoin présent).
 *                   Par juridiction et non plus globalement : sur une instance
 *                   partagée, le premier utilisateur d'un nouveau TJ peut ainsi
 *                   créer ses propres clés au lieu d'être renvoyé vers une
 *                   invitation inexistante.
 */
import { requireSession, handle, jsonResponse, findAccount } from '@/lib/server/auth'
import { vaultPrefixForAccount } from '@/lib/server/tribunalGuard'
import { dataDir, readJson, listVaults, readVault } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    const session = requireSession(req)
    const prefix = vaultPrefixForAccount(findAccount(session.u))
    const kdf = readJson<{ salt: string } | null>(dataDir('kdf.json'), null)
    const vaults = listVaults()
    const grantName = `grant-${session.u}`
    const grant = vaults.includes(grantName) ? readVault(grantName) : null
    return jsonResponse({
      legacyKdf: !!kdf,
      legacyKdfParams: kdf,
      hasKeyring: vaults.includes(`keyring-${session.u}`),
      hasGrant: !!grant,
      grantKdf: grant ? { salt: grant.kdfSalt, iterations: grant.kdfIterations, grantedBy: grant.savedBy } : null,
      anyKeyrings: vaults.includes(`${prefix}e2ee-check`),
    })
  })
}
