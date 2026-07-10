/**
 * Fil « pendant votre absence » : entrées chiffrées par l'attaché (clé
 * globale), lues sur disque et déchiffrées PAR LE NAVIGATEUR de l'admin.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, readEncryptedLog } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    return jsonResponse({ entries: readEncryptedLog('feed.jsonl', 200) })
  })
}
