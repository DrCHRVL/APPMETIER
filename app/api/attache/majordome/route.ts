/**
 * Brief du majordome — items chiffrés (déchiffrés par le navigateur admin)
 * + statuts (traité / ignoré) posés depuis le widget du tableau de bord.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, readEncryptedLog, readMajordomeStatuses, setMajordomeStatus } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    return jsonResponse({
      entries: readEncryptedLog('majordome.jsonl', 400),
      statuses: readMajordomeStatuses(),
    })
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    const session = requireAttacheAdmin(req)
    const body = await req.json().catch(() => null) as { id?: string, status?: string } | null
    if (!body?.id || (body.status !== 'traite' && body.status !== 'ignore')) {
      return jsonResponse({ error: 'id et status (traite|ignore) requis' }, { status: 400 })
    }
    await setMajordomeStatus(body.id, body.status, session.u)
    return jsonResponse({ ok: true })
  })
}
