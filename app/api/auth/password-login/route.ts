import {
  handle, jsonResponse, createSessionCookie, sessionCookieHeader,
  findAccount, saveAccount, rateLimit, clientIp,
} from '@/lib/server/auth'
import { verifyPasswordConstantTime } from '@/lib/server/password'
import { appendLog } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handle(async () => {
    // anti force brute : par IP et par identifiant ciblé
    rateLimit('pwlogin:ip:' + clientIp(req), 20, 15 * 60 * 1000)
    const body = await req.json()
    const username = String(body.username || '').trim()
    const password = String(body.password || '')
    rateLimit('pwlogin:u:' + username.toLowerCase(), 10, 15 * 60 * 1000)

    const account = findAccount(username)
    // Message ET temps de réponse volontairement identiques que l'utilisateur
    // existe ou non (ne révèle pas l'existence du compte, y compris par timing).
    const ok = verifyPasswordConstantTime(password, account?.passwordHash)
    if (!account || !ok) {
      return jsonResponse({ error: 'Identifiant ou mot de passe incorrect' }, { status: 401 })
    }

    account.lastLoginAt = new Date().toISOString()
    await saveAccount(account)
    await appendLog('audit.jsonl', { timestamp: new Date().toISOString(), user: account.username, action: 'auth.login.password', details: {} })

    const cookie = createSessionCookie(account)
    return jsonResponse(
      { ok: true, username: account.username, displayName: account.displayName, role: account.role },
      { headers: { 'set-cookie': sessionCookieHeader(cookie, 12 * 3600) } },
    )
  })
}
