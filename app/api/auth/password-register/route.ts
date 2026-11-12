import crypto from 'crypto'
import {
  handle, jsonResponse, createSessionCookie, sessionCookieHeader,
  findAccount, listAccounts, isValidUsername,
  getSession, rateLimit, clientIp, Account, updateAccount, createAccount,
} from '@/lib/server/auth'
import { hashPassword, isAcceptablePassword } from '@/lib/server/password'
import { resolveRegistrationTj } from '@/lib/server/tj'
import { appendLog } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

/**
 * Crée un compte (ou ajoute un mot de passe à un compte existant) protégé par
 * le code d'accès du TJ (ou le code d'enrôlement historique — voir
 * resolveRegistrationTj). Garde-fous :
 *  - le code détermine le TJ de rattachement du nouveau compte ;
 *  - un compte existant ne reçoit un mot de passe que depuis une session de CE
 *    compte (sinon le code d'accès permettrait de capturer un compte).
 */
export async function POST(req: Request) {
  return handle(async () => {
    rateLimit('pwreg:' + clientIp(req), 10, 15 * 60 * 1000)
    const body = await req.json().catch(() => ({}))
    const username = String(body.username || '').trim()
    const displayName = String(body.displayName || '').trim() || username
    const password = String(body.password || '')
    const code = String(body.setupCode || '')

    let tj: ReturnType<typeof resolveRegistrationTj>
    try {
      tj = resolveRegistrationTj(code, listAccounts().length === 0)
    } catch (e) {
      return jsonResponse({ error: e instanceof Error ? e.message : "Code d'accès incorrect" }, { status: 400 })
    }
    if (!isValidUsername(username)) return jsonResponse({ error: "Nom d'utilisateur invalide (lettres, chiffres, . _ -)" }, { status: 400 })
    if (!isAcceptablePassword(password)) return jsonResponse({ error: 'Mot de passe trop court (10 caractères minimum)' }, { status: 400 })

    const existant = findAccount(username)
    let account: Account | null
    if (existant) {
      const session = getSession(req)
      if (!session || session.u !== existant.username) {
        return jsonResponse({ error: 'Ce compte existe déjà — connectez-vous, ou demandez à un admin' }, { status: 403 })
      }
      if (existant.suspendu) return jsonResponse({ error: 'Compte suspendu — voyez l’administrateur' }, { status: 403 })
      account = await updateAccount(existant.username, (a) => { a.passwordHash = hashPassword(password) })
      if (!account) return jsonResponse({ error: 'Compte introuvable' }, { status: 404 })
    } else {
      try {
        account = await createAccount(({ premierDuServeur, adminLocal }) => ({
          id: crypto.randomUUID(),
          username,
          displayName,
          role: premierDuServeur ? 'admin' : 'member',
          tribunal: tj.name,
          tjs: [tj.id],
          tjAdmins: adminLocal(tj.id),
          credentials: [],
          passwordHash: hashPassword(password),
          createdAt: new Date().toISOString(),
        }))
      } catch (e) {
        return jsonResponse({ error: e instanceof Error ? e.message : 'Création impossible' }, { status: 409 })
      }
    }
    await appendLog('audit.jsonl', { timestamp: new Date().toISOString(), user: account.username, action: 'auth.register.password', details: { role: account.role, tj: tj.id } })

    const cookie = createSessionCookie(account)
    return jsonResponse(
      { ok: true, username: account.username, displayName: account.displayName, role: account.role },
      { headers: { 'set-cookie': sessionCookieHeader(cookie, 12 * 3600) } },
    )
  })
}
