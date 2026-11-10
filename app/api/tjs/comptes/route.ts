/**
 * Gestion des comptes par l'ADMINISTRATEUR GÉNÉRAL, dans n'importe quel TJ —
 * en parallèle de l'administrateur local, qui reste la voie normale.
 *  POST  { username, displayName, tj, tjAdmin? } : crée le compte avec un mot
 *        de passe provisoire, rendu UNE fois (à remettre de vive voix).
 *  PATCH { username, action, ... } :
 *        'admin-local' { valeur: boolean } · 'suspendre' · 'reactiver'
 *        'tribunal' { tj } (déplace : coupe l'accès à l'ancien TJ)
 *        'mot-de-passe' (nouveau mot de passe provisoire, rendu une fois)
 * L'accès aux DONNÉES suit la règle commune : invitation par un administrateur
 * du TJ (ou création des clés si le TJ est vierge et le compte en est l'admin).
 */
import crypto from 'crypto'
import { requireSuperAdmin, handle, jsonResponse, findAccount, saveAccount, isValidUsername, Account } from '@/lib/server/auth'
import { hashPassword } from '@/lib/server/password'
import { findTj, generateTjCode } from '@/lib/server/tj'
import { appendLog } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

const journal = (u: string, action: string, details: Record<string, unknown>) =>
  appendLog('audit.jsonl', { timestamp: new Date().toISOString(), user: u, action, details })

export async function POST(req: Request) {
  return handle(async () => {
    const session = requireSuperAdmin(req)
    const body = await req.json().catch(() => ({}))
    const username = String(body.username || '').trim()
    const displayName = String(body.displayName || '').trim() || username
    const tj = findTj(String(body.tj || ''))
    if (!isValidUsername(username)) return jsonResponse({ error: "Identifiant invalide (lettres, chiffres, . _ -)" }, { status: 400 })
    if (!tj) return jsonResponse({ error: 'Tribunal inconnu' }, { status: 400 })
    if (findAccount(username)) return jsonResponse({ error: 'Cet identifiant existe déjà' }, { status: 409 })
    const motDePasse = generateTjCode()
    const account: Account = {
      id: crypto.randomUUID(),
      username,
      displayName,
      role: 'member',
      tribunal: tj.name,
      tjs: [tj.id],
      ...(body.tjAdmin === true ? { tjAdmins: [tj.id] } : {}),
      credentials: [],
      passwordHash: hashPassword(motDePasse),
      createdAt: new Date().toISOString(),
    }
    await saveAccount(account)
    await journal(session.u, 'account.create', { username, tj: tj.id, tjAdmin: body.tjAdmin === true })
    return jsonResponse({ ok: true, username, motDePasse })
  })
}

export async function PATCH(req: Request) {
  return handle(async () => {
    const session = requireSuperAdmin(req)
    const body = await req.json().catch(() => ({}))
    const account = findAccount(String(body.username || ''))
    if (!account) return jsonResponse({ error: 'Compte introuvable' }, { status: 404 })
    if (account.role === 'admin') return jsonResponse({ error: 'Le compte de l’administrateur général ne se modifie pas ici' }, { status: 400 })
    const tjActuel = (account.tjs && account.tjs[0]) || 'default'
    let retour: Record<string, unknown> = {}
    switch (body.action) {
      case 'admin-local':
        if (body.valeur === true) account.tjAdmins = [tjActuel]
        else delete account.tjAdmins
        break
      case 'suspendre':
        account.suspendu = true
        break
      case 'reactiver':
        delete account.suspendu
        break
      case 'tribunal': {
        const tj = findTj(String(body.tj || ''))
        if (!tj) return jsonResponse({ error: 'Tribunal inconnu' }, { status: 400 })
        account.tjs = [tj.id]
        account.tribunal = tj.name
        delete account.tjAdmins
        delete account.lastTj
        break
      }
      case 'mot-de-passe': {
        const motDePasse = generateTjCode()
        account.passwordHash = hashPassword(motDePasse)
        retour = { motDePasse }
        break
      }
      default:
        return jsonResponse({ error: 'Action inconnue' }, { status: 400 })
    }
    await saveAccount(account)
    await journal(session.u, `account.${body.action}`, { username: account.username, tj: body.tj ?? tjActuel, valeur: body.valeur })
    return jsonResponse({ ok: true, username: account.username, ...retour })
  })
}
