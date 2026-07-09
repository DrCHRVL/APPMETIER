/**
 * Gestion des tribunaux (TJ) — réservée à l'administrateur unique.
 *  GET   : registre des TJ + comptes rattachés (pour le panneau « Tribunaux »)
 *  POST  : { name } crée un TJ ; retourne le code d'accès EN CLAIR une seule
 *          fois (seul le hachage est conservé). L'admin est rattaché d'office.
 *  PATCH : { id, name? } renomme ; { id, regenerateCode: true } régénère le
 *          code d'accès (l'ancien cesse immédiatement de fonctionner).
 */
import { requireSession, handle, jsonResponse, listAccounts, findAccount, saveAccount, accountTjs } from '@/lib/server/auth'
import { listTjs, createTj, renameTj, regenerateTjCode, findTj } from '@/lib/server/tj'
import { appendLog } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

function requireAdmin(req: Request) {
  const session = requireSession(req)
  if (session.r !== 'admin') {
    throw new Response(JSON.stringify({ error: 'Réservé aux administrateurs' }), {
      status: 403, headers: { 'content-type': 'application/json' },
    })
  }
  return session
}

export async function GET(req: Request) {
  return handle(async () => {
    const session = requireAdmin(req)
    const accounts = listAccounts()
    const tjs = listTjs().map((t) => ({
      id: t.id,
      name: t.name,
      hasCode: !!t.codeHash,
      codeUpdatedAt: t.codeUpdatedAt || null,
      createdAt: t.createdAt,
      members: accounts.filter((a) => accountTjs(a).includes(t.id)).length,
    }))
    return jsonResponse({
      tjs,
      activeTj: session.tj,
      accounts: accounts.map((a) => ({
        username: a.username,
        displayName: a.displayName,
        role: a.role,
        tjs: accountTjs(a),
      })),
    })
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    const session = requireAdmin(req)
    const { name } = await req.json()
    if (typeof name !== 'string' || name.trim().length < 2) {
      return jsonResponse({ error: 'Nom de tribunal requis' }, { status: 400 })
    }
    const { entry, code } = await createTj(name, session.u)
    // L'admin unique pilote tous les TJ : rattachement d'office au nouveau TJ.
    const admin = findAccount(session.u)
    if (admin && !accountTjs(admin).includes(entry.id)) {
      admin.tjs = [...accountTjs(admin), entry.id]
      await saveAccount(admin)
    }
    await appendLog('audit.jsonl', { timestamp: new Date().toISOString(), user: session.u, action: 'tj.create', details: { tj: entry.id, name: entry.name } })
    return jsonResponse({ ok: true, tj: { id: entry.id, name: entry.name }, code })
  })
}

export async function PATCH(req: Request) {
  return handle(async () => {
    const session = requireAdmin(req)
    const { id, name, regenerateCode } = await req.json()
    if (typeof id !== 'string' || !findTj(id)) return jsonResponse({ error: 'Tribunal introuvable' }, { status: 404 })
    if (regenerateCode === true) {
      const { entry, code } = await regenerateTjCode(id)
      await appendLog('audit.jsonl', { timestamp: new Date().toISOString(), user: session.u, action: 'tj.code.regenerate', details: { tj: id } })
      return jsonResponse({ ok: true, tj: { id: entry.id, name: entry.name }, code })
    }
    if (typeof name === 'string' && name.trim()) {
      const entry = await renameTj(id, name)
      await appendLog('audit.jsonl', { timestamp: new Date().toISOString(), user: session.u, action: 'tj.rename', details: { tj: id, name: entry.name } })
      return jsonResponse({ ok: true, tj: { id: entry.id, name: entry.name } })
    }
    return jsonResponse({ error: 'Aucune modification demandée' }, { status: 400 })
  })
}
