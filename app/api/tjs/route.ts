/**
 * Gestion des tribunaux (TJ) — réservée à l'administrateur unique.
 *  GET   : registre des TJ + comptes rattachés (pour le panneau « Tribunaux »)
 *  POST  : { name } crée un TJ ; retourne le code d'accès EN CLAIR une seule
 *          fois (seul le hachage est conservé). Le premier inscrit avec ce
 *          code devient l'administrateur local du TJ.
 *  PATCH : { id, name? } renomme ; { id, regenerateCode: true } régénère le
 *          code d'accès (l'ancien cesse immédiatement de fonctionner).
 */
import { requireSession, handle, jsonResponse, listAccounts, accountTjs } from '@/lib/server/auth'
import { listTjs, createTj, renameTj, regenerateTjCode, findTj } from '@/lib/server/tj'
import { appendLog, listVaults, readVault } from '@/lib/server/store'

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
    // Supervision : état de chaque TJ, sans aucun contenu (le serveur n'en a pas).
    const membres = listAccounts().filter((a) => a.role !== 'admin')
    const tjs = listTjs().map((t) => {
      const vaults = listVaults(t.id)
      const escrow = vaults.includes('escrow-keys')
        ? readVault(t.id, 'escrow-keys') as unknown as { savedAt?: string, savedBy?: string }
        : null
      const duTj = membres.filter((a) => accountTjs(a).includes(t.id))
      return {
        id: t.id,
        name: t.name,
        hasCode: !!t.codeHash,
        codeUpdatedAt: t.codeUpdatedAt || null,
        createdAt: t.createdAt,
        members: duTj.length,
        suspendus: duTj.filter((a) => a.suspendu).length,
        admins: duTj.filter((a) => (a.tjAdmins || []).includes(t.id)).map((a) => a.displayName),
        /** clés créées (au moins un trousseau) */
        initialized: vaults.some((v) => v.startsWith('keyring-')),
        /** comptes inscrits sans trousseau ni invitation : à traiter par l'admin local */
        pending: duTj.filter((a) => !vaults.includes(`keyring-${a.username}`) && !vaults.includes(`grant-${a.username}`)).length,
        /** séquestre déposé pour l'administrateur général */
        escrow: escrow ? { savedAt: escrow.savedAt || null, savedBy: escrow.savedBy || null } : null,
        /** l'administrateur général a son propre trousseau dans ce TJ */
        myAccess: vaults.includes(`keyring-${session.u}`),
        /** indicateurs scellés pour l'administrateur général (opaques pour le serveur) */
        indicateurs: vaults.filter((v) => v.startsWith('indicateurs-')).map((v) => readVault(t.id, v)),
      }
    })
    return jsonResponse({
      tjs,
      activeTj: session.tj,
      accounts: listAccounts().map((a) => {
        const tj = accountTjs(a)[0]
        const vaults = a.role === 'admin' ? [] : listVaults(tj)
        return {
          username: a.username,
          displayName: a.displayName,
          role: a.role,
          tjs: accountTjs(a),
          tjAdmins: (a.tjAdmins || []).filter((id) => accountTjs(a).includes(id)),
          suspendu: a.suspendu === true,
          /** accès aux données de son TJ : trousseau actif, invitation en attente, ou rien */
          acces: a.role === 'admin' ? 'general'
            : vaults.includes(`keyring-${a.username}`) ? 'actif'
              : vaults.includes(`grant-${a.username}`) ? 'invite' : 'en-attente',
          lastLoginAt: a.lastLoginAt || null,
          createdAt: a.createdAt,
        }
      }),
    })
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    const session = requireAdmin(req)
    const { name } = await req.json().catch(() => ({}))
    if (typeof name !== 'string' || name.trim().length < 2) {
      return jsonResponse({ error: 'Nom de tribunal requis' }, { status: 400 })
    }
    // Le premier inscrit avec le code devient l'administrateur local du TJ et
    // en crée les clés ; l'administrateur général y accède par le séquestre
    // que cet administrateur local dépose.
    const { entry, code } = await createTj(name, session.u)
    await appendLog('audit.jsonl', { timestamp: new Date().toISOString(), user: session.u, action: 'tj.create', details: { tj: entry.id, name: entry.name } })
    return jsonResponse({ ok: true, tj: { id: entry.id, name: entry.name }, code })
  })
}

export async function PATCH(req: Request) {
  return handle(async () => {
    const session = requireAdmin(req)
    const { id, name, regenerateCode } = await req.json().catch(() => ({}))
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
