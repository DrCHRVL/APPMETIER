/**
 * Changement de TJ actif pour la session courante.
 * POST { tj } : vérifie que le compte est rattaché à ce TJ, puis ré-émet le
 * cookie de session avec le nouveau TJ actif. Le client recharge ensuite
 * l'application : trousseau, coffres et cache local sont ceux du nouveau TJ.
 */
import {
  requireSession, handle, jsonResponse, findAccount, saveAccount, accountTjs,
  createSessionCookie, sessionCookieHeader,
} from '@/lib/server/auth'
import { findTj } from '@/lib/server/tj'
import { appendLog } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handle(async () => {
    const session = requireSession(req)
    const { tj } = await req.json()
    if (typeof tj !== 'string' || !findTj(tj)) return jsonResponse({ error: 'Tribunal inconnu' }, { status: 400 })
    const account = findAccount(session.u)
    if (!account || !accountTjs(account).includes(tj)) {
      return jsonResponse({ error: 'Votre compte n’est pas rattaché à ce tribunal' }, { status: 403 })
    }
    account.lastTj = tj
    await saveAccount(account)
    await appendLog('audit.jsonl', { timestamp: new Date().toISOString(), user: session.u, action: 'auth.switch-tj', details: { from: session.tj, to: tj } })
    const cookie = createSessionCookie(account, tj)
    return jsonResponse(
      { ok: true, tj: { id: tj, name: findTj(tj)?.name || tj } },
      { headers: { 'set-cookie': sessionCookieHeader(cookie, 12 * 3600) } },
    )
  })
}
