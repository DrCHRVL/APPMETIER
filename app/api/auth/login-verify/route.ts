import { handle, jsonResponse, createSessionCookie, sessionCookieHeader } from '@/lib/server/auth'
import { authenticationVerify } from '@/lib/server/webauthn'
import { accountIdentity } from '@/lib/server/tribunalGuard'
import { appendLog } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handle(async () => {
    const { response, username } = await req.json()
    try {
      const account = await authenticationVerify(req, response, username ? String(username) : undefined)
      await appendLog('audit.jsonl', { timestamp: new Date().toISOString(), user: account.username, action: 'auth.login', details: {} })
      const cookie = createSessionCookie(account)
      return jsonResponse(
        { ok: true, ...accountIdentity(account) },
        { headers: { 'set-cookie': sessionCookieHeader(cookie, 12 * 3600) } },
      )
    } catch (e) {
      return jsonResponse({ error: e instanceof Error ? e.message : 'Erreur' }, { status: 401 })
    }
  })
}
