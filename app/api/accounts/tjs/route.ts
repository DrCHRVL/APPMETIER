/**
 * Rattachement d'un compte à un ou plusieurs TJ — réservé à l'administrateur.
 * POST { username, tjs: string[] } : remplace la liste des TJ accessibles.
 *
 * C'est ici que l'admin autorise (rarissime) un utilisateur à accéder à un
 * second TJ. L'accès aux DONNÉES du TJ supplémentaire nécessite ensuite une
 * invitation E2EE déposée par l'admin depuis ce TJ (Accès & clés) : le
 * rattachement seul n'ouvre aucun coffre.
 */
import { requireSession, handle, jsonResponse, findAccount, saveAccount, accountTjs } from '@/lib/server/auth'
import { findTj } from '@/lib/server/tj'
import { appendLog } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handle(async () => {
    const session = requireSession(req)
    if (session.r !== 'admin') return jsonResponse({ error: 'Réservé aux administrateurs' }, { status: 403 })
    const { username, tjs } = await req.json()
    if (typeof username !== 'string' || !Array.isArray(tjs) || tjs.length === 0) {
      return jsonResponse({ error: 'username et tjs (liste non vide) requis' }, { status: 400 })
    }
    if (username === session.u) {
      return jsonResponse({ error: 'Votre propre rattachement est géré automatiquement (création de TJ)' }, { status: 400 })
    }
    const account = findAccount(username)
    if (!account) return jsonResponse({ error: 'Compte introuvable' }, { status: 404 })
    const clean: string[] = []
    for (const id of tjs) {
      if (typeof id !== 'string' || !findTj(id)) return jsonResponse({ error: `Tribunal inconnu : ${id}` }, { status: 400 })
      if (!clean.includes(id)) clean.push(id)
    }
    const before = accountTjs(account)
    account.tjs = clean
    if (account.lastTj && !clean.includes(account.lastTj)) delete account.lastTj
    await saveAccount(account)
    await appendLog('audit.jsonl', {
      timestamp: new Date().toISOString(), user: session.u, action: 'account.tjs',
      details: { username, before, after: clean },
    })
    return jsonResponse({ ok: true, username, tjs: clean })
  })
}
