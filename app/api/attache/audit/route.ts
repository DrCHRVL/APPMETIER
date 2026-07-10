/**
 * Journal d'audit de l'attaché — TOUTES ses actions (outils, écritures,
 * envois). Visible du SEUL administrateur ; entrées chiffrées, déchiffrées
 * par son navigateur.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, readEncryptedLog } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    return jsonResponse({ entries: readEncryptedLog('audit.jsonl', 1000) })
  })
}
