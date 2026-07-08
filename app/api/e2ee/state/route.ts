/**
 * État E2EE pour l'utilisateur connecté, dans l'espace de son TJ actif :
 * guide la porte d'entrée web.
 *  - legacyKdf    : un coffre « phrase de service » historique existe (kdf.json)
 *  - hasKeyring   : MON trousseau individuel existe
 *  - hasGrant     : une invitation m'attend
 *  - anyKeyrings  : au moins un trousseau existe dans ce TJ
 */
import { requireTjSession, handle, jsonResponse } from '@/lib/server/auth'
import { tjDataDir, readJson, listVaults, readVault } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    const session = requireTjSession(req)
    const kdf = readJson<{ salt: string } | null>(tjDataDir(session.tj, 'kdf.json'), null)
    const vaults = listVaults(session.tj)
    const grantName = `grant-${session.u}`
    const grant = vaults.includes(grantName) ? readVault(session.tj, grantName) : null
    return jsonResponse({
      legacyKdf: !!kdf,
      legacyKdfParams: kdf,
      hasKeyring: vaults.includes(`keyring-${session.u}`),
      hasGrant: !!grant,
      grantKdf: grant ? { salt: grant.kdfSalt, iterations: grant.kdfIterations, grantedBy: grant.savedBy } : null,
      anyKeyrings: vaults.some((v) => v.startsWith('keyring-')),
    })
  })
}
