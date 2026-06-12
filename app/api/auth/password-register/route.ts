import crypto from 'crypto'
import {
  handle, jsonResponse, createSessionCookie, sessionCookieHeader,
  findAccount, listAccounts, saveAccount, setupCode, isValidUsername,
  getSession, rateLimit, clientIp, safeEqual, Account,
} from '@/lib/server/auth'
import { hashPassword, isAcceptablePassword } from '@/lib/server/password'
import { appendLog } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

/**
 * Crée un compte (ou ajoute un mot de passe à un compte existant) protégé par
 * le code d'enrôlement. Mêmes garde-fous que l'enrôlement passkey :
 *  - SIRAL_SETUP_CODE requis ;
 *  - un compte existant ne reçoit un mot de passe que depuis une session de CE
 *    compte (sinon le code d'enrôlement permettrait de capturer un compte).
 */
export async function POST(req: Request) {
  return handle(async () => {
    rateLimit('pwreg:' + clientIp(req), 10, 15 * 60 * 1000)
    const body = await req.json()
    const username = String(body.username || '').trim()
    const displayName = String(body.displayName || '').trim() || username
    const tribunal = body.tribunal ? String(body.tribunal).trim() : undefined
    const password = String(body.password || '')
    const code = String(body.setupCode || '')

    const expected = setupCode()
    if (!expected) return jsonResponse({ error: "Le code d'enrôlement (SIRAL_SETUP_CODE) n'est pas configuré sur le serveur" }, { status: 400 })
    if (!safeEqual(code, expected)) return jsonResponse({ error: "Code d'enrôlement incorrect" }, { status: 400 })
    if (!isValidUsername(username)) return jsonResponse({ error: "Nom d'utilisateur invalide (lettres, chiffres, . _ -)" }, { status: 400 })
    if (!isAcceptablePassword(password)) return jsonResponse({ error: 'Mot de passe trop court (10 caractères minimum)' }, { status: 400 })

    let account = findAccount(username)
    if (account) {
      const session = getSession(req)
      if (!session || session.u !== account.username) {
        return jsonResponse({ error: 'Ce compte existe déjà — connectez-vous, ou demandez à un admin' }, { status: 403 })
      }
      account.passwordHash = hashPassword(password)
      if (tribunal && !account.tribunal) account.tribunal = tribunal.slice(0, 80)
    } else {
      account = {
        id: crypto.randomUUID(),
        username,
        displayName,
        role: listAccounts().length === 0 ? 'admin' : 'member',
        tribunal: tribunal ? tribunal.slice(0, 80) : undefined,
        credentials: [],
        passwordHash: hashPassword(password),
        createdAt: new Date().toISOString(),
      } as Account
    }
    await saveAccount(account)
    await appendLog('audit.jsonl', { timestamp: new Date().toISOString(), user: account.username, action: 'auth.register.password', details: { role: account.role } })

    const cookie = createSessionCookie(account)
    return jsonResponse(
      { ok: true, username: account.username, displayName: account.displayName, role: account.role },
      { headers: { 'set-cookie': sessionCookieHeader(cookie, 12 * 3600) } },
    )
  })
}
