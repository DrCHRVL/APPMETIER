import { handle, jsonResponse, createSessionCookie, sessionCookieHeader } from '@/lib/server/auth'
import { authenticationVerify } from '@/lib/server/webauthn'
import { appendLog } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handle(async () => {
    const { response, username } = await req.json().catch(() => ({} as any))
    if (!response) return jsonResponse({ error: 'Requête invalide' }, { status: 400 })
    try {
      const account = await authenticationVerify(req, response, username ? String(username) : undefined)
      await appendLog('audit.jsonl', { timestamp: new Date().toISOString(), user: account.username, action: 'auth.login', details: {} })
      const cookie = createSessionCookie(account)
      return jsonResponse(
        { ok: true, username: account.username, displayName: account.displayName, role: account.role },
        { headers: { 'set-cookie': sessionCookieHeader(cookie, 12 * 3600) } },
      )
    } catch (e) {
      return jsonResponse({ error: e instanceof Error ? e.message : 'Erreur' }, { status: 401 })
    }
  })
}
