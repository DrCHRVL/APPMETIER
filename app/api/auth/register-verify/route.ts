import { handle, jsonResponse, createSessionCookie, sessionCookieHeader } from '@/lib/server/auth'
import { registrationVerify } from '@/lib/server/webauthn'
import { appendLog } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handle(async () => {
    const { username, displayName, response, label, tribunal } = await req.json()
    try {
      const account = await registrationVerify(req, String(username || ''), String(displayName || ''), response, label, tribunal ? String(tribunal) : undefined)
      await appendLog('audit.jsonl', { timestamp: new Date().toISOString(), user: account.username, action: 'auth.register', details: { role: account.role } })
      const cookie = createSessionCookie(account)
      return jsonResponse(
        { ok: true, username: account.username, displayName: account.displayName, role: account.role },
        { headers: { 'set-cookie': sessionCookieHeader(cookie, 12 * 3600) } },
      )
    } catch (e) {
      return jsonResponse({ error: e instanceof Error ? e.message : 'Erreur' }, { status: 400 })
    }
  })
}
