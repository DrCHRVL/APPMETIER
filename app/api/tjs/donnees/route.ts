/**
 * Accès de l'ADMINISTRATEUR GÉNÉRAL aux coffres d'un autre TJ, sans y basculer
 * (cartographie inter-TJ, déblocage d'un compte). Tout reste chiffré : le
 * serveur ne fait que transmettre des enveloppes, que le navigateur de
 * l'administrateur général ouvre avec le séquestre du TJ. Chaque appel est
 * journalisé.
 *  GET    ?tj=…&coffre=…   escrow-keys · users-config · ctx-<contentieux>
 *  PUT    ?tj=…&coffre=grant-<identifiant>   (invitation de déblocage)
 *  DELETE ?tj=…&coffre=keyring-<identifiant> | grant-<identifiant>
 *         (réinitialisation de l'accès d'un compte : phrase perdue…)
 */
import { requireSuperAdmin, handle, jsonResponse, findAccount, accountTjs } from '@/lib/server/auth'
import { findTj } from '@/lib/server/tj'
import { readVault, writeVault, deleteVault, isSafeName, appendLog } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

const LECTURE = /^(escrow-keys|users-config|ctx-[a-z0-9_-]+)$/
const ACCES = /^(keyring|grant)-(.+)$/

function cible(req: Request): { tj: string, coffre: string } | Response {
  const url = new URL(req.url)
  const tj = url.searchParams.get('tj') || ''
  const coffre = url.searchParams.get('coffre') || ''
  if (!findTj(tj)) return jsonResponse({ error: 'Tribunal inconnu' }, { status: 400 })
  if (!isSafeName(coffre)) return jsonResponse({ error: 'Coffre invalide' }, { status: 400 })
  return { tj, coffre }
}

const journal = (u: string, action: string, tj: string, coffre: string) =>
  appendLog('audit.jsonl', { timestamp: new Date().toISOString(), user: u, action, details: { tj, coffre } })

export async function GET(req: Request) {
  return handle(async () => {
    const session = requireSuperAdmin(req)
    const c = cible(req)
    if (c instanceof Response) return c
    if (!LECTURE.test(c.coffre)) return jsonResponse({ error: 'Coffre non accessible par cette voie' }, { status: 403 })
    const envelope = readVault(c.tj, c.coffre)
    await journal(session.u, 'tj.donnees.lecture', c.tj, c.coffre)
    if (!envelope) return jsonResponse({ exists: false }, { status: 404 })
    return jsonResponse({ exists: true, envelope })
  })
}

/** Le compte visé doit relever de ce TJ (on ne dépose rien pour un inconnu). */
function compteDuTj(coffre: string, tj: string): boolean {
  const m = ACCES.exec(coffre)
  const account = m ? findAccount(m[2]) : null
  return !!account && account.role !== 'admin' && accountTjs(account).includes(tj)
}

export async function PUT(req: Request) {
  return handle(async () => {
    const session = requireSuperAdmin(req)
    const c = cible(req)
    if (c instanceof Response) return c
    if (!c.coffre.startsWith('grant-') || !compteDuTj(c.coffre, c.tj)) {
      return jsonResponse({ error: 'Seule une invitation pour un compte de ce tribunal peut être déposée' }, { status: 403 })
    }
    const envelope = await req.json().catch(() => ({}))
    if (!envelope || envelope.encrypted !== true || typeof envelope.ct !== 'string' || typeof envelope.iv !== 'string') {
      return jsonResponse({ error: 'Enveloppe chiffrée requise' }, { status: 400 })
    }
    await writeVault(c.tj, c.coffre, envelope, session.u)
    await journal(session.u, 'tj.donnees.invitation', c.tj, c.coffre)
    return jsonResponse({ ok: true })
  })
}

export async function DELETE(req: Request) {
  return handle(async () => {
    const session = requireSuperAdmin(req)
    const c = cible(req)
    if (c instanceof Response) return c
    if (!ACCES.test(c.coffre) || !compteDuTj(c.coffre, c.tj)) {
      return jsonResponse({ error: 'Seul l’accès d’un compte de ce tribunal peut être réinitialisé' }, { status: 403 })
    }
    const deleted = await deleteVault(c.tj, c.coffre)
    await journal(session.u, 'tj.donnees.reinitialisation', c.tj, c.coffre)
    return jsonResponse({ ok: true, deleted })
  })
}
