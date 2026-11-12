/**
 * Gestion des comptes par l'ADMINISTRATEUR GÉNÉRAL, dans n'importe quel TJ —
 * en parallèle de l'administrateur local, qui reste la voie normale.
 *  POST  { username, displayName, tj, tjAdmin? } : crée le compte avec un mot
 *        de passe provisoire, rendu UNE fois (à remettre à l'intéressé).
 *  PATCH { username, action, ... } :
 *        'admin-local' { valeur: boolean } · 'suspendre' · 'reactiver'
 *        'tribunal' { tj } (déplace : coupe l'accès à l'ancien TJ)
 *        'mot-de-passe' (nouveau mot de passe provisoire, rendu une fois)
 * L'accès aux DONNÉES suit la règle commune : invitation par un administrateur
 * du TJ (ou création des clés si le TJ est vierge et le compte en est l'admin).
 */
import crypto from 'crypto'
import { requireSuperAdmin, handle, jsonResponse, findAccount, isValidUsername, createAccount, updateAccount } from '@/lib/server/auth'
import { hashPassword } from '@/lib/server/password'
import { findTj, generateTjCode } from '@/lib/server/tj'
import { appendLog, deleteVault } from '@/lib/server/store'

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
    const motDePasse = generateTjCode()
    try {
      await createAccount(() => ({
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
      }))
    } catch {
      return jsonResponse({ error: 'Cet identifiant existe déjà' }, { status: 409 })
    }
    await journal(session.u, 'account.create', { username, tj: tj.id, tjAdmin: body.tjAdmin === true })
    return jsonResponse({ ok: true, username, motDePasse })
  })
}

export async function PATCH(req: Request) {
  return handle(async () => {
    const session = requireSuperAdmin(req)
    const body = await req.json().catch(() => ({}))
    const courant = findAccount(String(body.username || ''))
    if (!courant) return jsonResponse({ error: 'Compte introuvable' }, { status: 404 })
    if (courant.role === 'admin') return jsonResponse({ error: 'Le compte de l’administrateur général ne se modifie pas ici' }, { status: 400 })
    const actions = ['admin-local', 'suspendre', 'reactiver', 'tribunal', 'mot-de-passe']
    if (!actions.includes(body.action)) return jsonResponse({ error: 'Action inconnue' }, { status: 400 })
    const destination = body.action === 'tribunal' ? findTj(String(body.tj || '')) : null
    if (body.action === 'tribunal' && !destination) return jsonResponse({ error: 'Tribunal inconnu' }, { status: 400 })
    const motDePasse = body.action === 'mot-de-passe' ? generateTjCode() : null
    let tjAvant = 'default'
    // modification sur la version à jour du compte, dans le verrou
    const account = await updateAccount(courant.username, (a) => {
      tjAvant = (a.tjs && a.tjs[0]) || 'default'
      switch (body.action) {
        case 'admin-local':
          if (body.valeur === true) a.tjAdmins = [tjAvant]
          else delete a.tjAdmins
          break
        case 'suspendre': a.suspendu = true; break
        case 'reactiver': delete a.suspendu; break
        case 'tribunal':
          a.tjs = [destination!.id]
          a.tribunal = destination!.name
          delete a.tjAdmins
          delete a.lastTj
          break
        case 'mot-de-passe': a.passwordHash = hashPassword(motDePasse!); break
      }
    })
    if (!account) return jsonResponse({ error: 'Compte introuvable' }, { status: 404 })
    // Déplacement : l'accès laissé dans l'ancien TJ est retiré (un retour
    // ultérieur passera par une nouvelle invitation, jamais par d'anciennes clés).
    if (destination && destination.id !== tjAvant) {
      await deleteVault(tjAvant, `keyring-${account.username}`).catch(() => false)
      await deleteVault(tjAvant, `grant-${account.username}`).catch(() => false)
    }
    await journal(session.u, `account.${body.action}`, {
      username: account.username, tj: tjAvant, ...(destination ? { vers: destination.id } : {}), valeur: body.valeur,
    })
    return jsonResponse({ ok: true, username: account.username, ...(motDePasse ? { motDePasse } : {}) })
  })
}
