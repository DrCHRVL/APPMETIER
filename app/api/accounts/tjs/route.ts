/**
 * Rattachement d'un compte à un ou plusieurs TJ — réservé à l'administrateur.
 * POST { username, tjs: string[], tjAdmins?: string[] } : remplace la liste
 * des TJ accessibles et, si fourni, celle des TJ dont le compte est
 * l'administrateur local (gestion des accès de ce TJ).
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
    if (session.r !== 'admin') return jsonResponse({ error: 'Réservé à l’administrateur du serveur' }, { status: 403 })
    const { username, tjs, tjAdmins } = await req.json().catch(() => ({}))
    if (typeof username !== 'string' || !Array.isArray(tjs) || tjs.length === 0) {
      return jsonResponse({ error: 'username et tjs (liste non vide) requis' }, { status: 400 })
    }
    const account = findAccount(username)
    if (!account) return jsonResponse({ error: 'Compte introuvable' }, { status: 404 })
    const clean: string[] = []
    for (const id of tjs) {
      if (typeof id !== 'string' || !findTj(id)) return jsonResponse({ error: `Tribunal inconnu : ${id}` }, { status: 400 })
      if (!clean.includes(id)) clean.push(id)
    }
    if (username === session.u && !clean.includes(session.tj)) {
      return jsonResponse({ error: 'Basculez d’abord sur un autre tribunal avant de vous détacher de celui-ci' }, { status: 400 })
    }
    const before = accountTjs(account)
    const adminsBefore = account.tjAdmins || []
    account.tjs = clean
    if (account.lastTj && !clean.includes(account.lastTj)) delete account.lastTj
    // Administration locale : seulement sur des TJ de rattachement.
    const admins = Array.isArray(tjAdmins) ? tjAdmins : adminsBefore
    const cleanAdmins = admins.filter((id: unknown): id is string => typeof id === 'string' && clean.includes(id))
    if (cleanAdmins.length) account.tjAdmins = [...new Set(cleanAdmins)]
    else delete account.tjAdmins
    await saveAccount(account)
    await appendLog('audit.jsonl', {
      timestamp: new Date().toISOString(), user: session.u, action: 'account.tjs',
      details: { username, before, after: clean, tjAdminsBefore: adminsBefore, tjAdmins: account.tjAdmins || [] },
    })
    return jsonResponse({ ok: true, username, tjs: clean, tjAdmins: account.tjAdmins || [] })
  })
}
