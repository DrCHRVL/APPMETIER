/**
 * Changement de son propre mot de passe (ex. mot de passe provisoire remis par
 * l'administrateur). POST { ancien, nouveau }.
 */
import { requireSession, handle, jsonResponse, findAccount, updateAccount, rateLimit } from '@/lib/server/auth'
import { hashPassword, isAcceptablePassword, verifyPasswordConstantTime } from '@/lib/server/password'
import { appendLog } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handle(async () => {
    const session = requireSession(req)
    rateLimit('pwchange:' + session.u, 10, 15 * 60 * 1000)
    const { ancien, nouveau } = await req.json().catch(() => ({}))
    const account = findAccount(session.u)
    if (!account || account.suspendu) return jsonResponse({ error: 'Compte indisponible' }, { status: 403 })
    if (!verifyPasswordConstantTime(String(ancien || ''), account.passwordHash)) {
      return jsonResponse({ error: 'Mot de passe actuel incorrect' }, { status: 400 })
    }
    if (!isAcceptablePassword(String(nouveau || ''))) {
      return jsonResponse({ error: 'Nouveau mot de passe trop court (10 caractères minimum)' }, { status: 400 })
    }
    await updateAccount(account.username, (a) => { a.passwordHash = hashPassword(String(nouveau)) })
    await appendLog('audit.jsonl', { timestamp: new Date().toISOString(), user: account.username, action: 'auth.password.change', details: {} })
    return jsonResponse({ ok: true })
  })
}
