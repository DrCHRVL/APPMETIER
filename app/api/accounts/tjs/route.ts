/**
 * Rattachement d'un compte à SON tribunal — réservé à l'administrateur général.
 * POST { username, tjs: [tj], tjAdmins?: string[] } : fixe le TJ du compte
 * (un seul : étanchéité entre TJ) et, si fourni, s'il en est l'administrateur
 * local. Changer de TJ n'ouvre aucune donnée : il faut ensuite une invitation
 * de l'administrateur du nouveau TJ.
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
    if (account.role === 'admin') {
      return jsonResponse({ error: 'L’administrateur général accède à tous les tribunaux' }, { status: 400 })
    }
    const clean: string[] = []
    for (const id of tjs) {
      if (typeof id !== 'string' || !findTj(id)) return jsonResponse({ error: `Tribunal inconnu : ${id}` }, { status: 400 })
      if (!clean.includes(id)) clean.push(id)
    }
    // Étanchéité : un membre relève d'un seul tribunal.
    if (clean.length !== 1) {
      return jsonResponse({ error: 'Un compte relève d’un seul tribunal' }, { status: 400 })
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
