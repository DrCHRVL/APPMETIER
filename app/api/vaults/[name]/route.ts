/**
 * Coffres chiffrés. GET : version courante (enveloppe opaque). PUT : nouvelle
 * version (l'ancienne est archivée automatiquement, historique immuable).
 * Tous les accès sont cloisonnés dans l'espace du TJ actif de la session.
 */
import { requireTjSession, handle, jsonResponse } from '@/lib/server/auth'
import { readVault, writeVault, deleteVault, isSafeName, appendLog } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: { name: string } }) {
  return handle(async () => {
    const session = requireTjSession(req)
    if (!isSafeName(params.name)) return jsonResponse({ error: 'Nom invalide' }, { status: 400 })
    // Un trousseau `keyring-<user>` est chiffré par la phrase PERSONNELLE de son
    // titulaire (PBKDF2) : n'importe quel membre pourrait sinon le récupérer et
    // brute-forcer la phrase hors-ligne. Lecture réservée au titulaire.
    // (Les coffres de données restent lisibles par tous : le partage repose sur
    // des clés de scope distribuées via les trousseaux/invitations.)
    const keyring = /^keyring-(.+)$/.exec(params.name)
    if (keyring && keyring[1] !== session.u) {
      return jsonResponse({ error: 'Lecture non autorisée sur ce trousseau' }, { status: 403 })
    }
    const envelope = readVault(session.tj, params.name)
    if (!envelope) return jsonResponse({ exists: false }, { status: 404 })
    return jsonResponse({ exists: true, envelope })
  })
}

export async function PUT(req: Request, { params }: { params: { name: string } }) {
  return handle(async () => {
    const session = requireTjSession(req)
    if (!isSafeName(params.name)) return jsonResponse({ error: 'Nom invalide' }, { status: 400 })
    // Coffres d'ACCÈS : un trousseau n'est modifiable que par son titulaire,
    // une invitation n'est déposable que par un admin — sinon tout membre
    // pourrait écraser le trousseau d'autrui ou empoisonner une invitation.
    const access = /^(keyring|grant)-(.+)$/.exec(params.name)
    if (access) {
      const ownKeyring = access[1] === 'keyring' && access[2] === session.u
      const adminGrant = access[1] === 'grant' && session.r === 'admin'
      if (!ownKeyring && !adminGrant) {
        return jsonResponse({ error: 'Écriture non autorisée sur ce coffre d’accès' }, { status: 403 })
      }
    }
    const envelope = await req.json()
    if (!envelope || envelope.encrypted !== true || typeof envelope.ct !== 'string' || typeof envelope.iv !== 'string') {
      return jsonResponse({ error: 'Enveloppe chiffrée requise (E2EE obligatoire)' }, { status: 400 })
    }
    if (envelope.ct.length > 80 * 1024 * 1024) {
      return jsonResponse({ error: 'Coffre trop volumineux' }, { status: 413 })
    }
    const { version } = await writeVault(session.tj, params.name, envelope, session.u)
    await appendLog('audit.jsonl', { timestamp: new Date().toISOString(), user: session.u, action: 'vault.write', details: { tj: session.tj, vault: params.name, version } })
    return jsonResponse({ ok: true, version })
  })
}

/**
 * Suppression restreinte aux coffres d'accès individuels : un admin peut
 * révoquer le trousseau/l'invitation de n'importe qui ; chacun peut supprimer
 * sa propre invitation consommée. Les coffres de données ne sont JAMAIS
 * supprimables par l'API.
 */
export async function DELETE(req: Request, { params }: { params: { name: string } }) {
  return handle(async () => {
    const session = requireTjSession(req)
    const name = params.name
    if (!isSafeName(name)) return jsonResponse({ error: 'Nom invalide' }, { status: 400 })
    const isAccessVault = /^(keyring|grant)-/.test(name)
    const ownGrant = name === `grant-${session.u}` || name === `keyring-${session.u}`
    if (!isAccessVault || (session.r !== 'admin' && !ownGrant)) {
      return jsonResponse({ error: 'Suppression non autorisée' }, { status: 403 })
    }
    const deleted = await deleteVault(session.tj, name)
    await appendLog('audit.jsonl', { timestamp: new Date().toISOString(), user: session.u, action: 'vault.delete', details: { tj: session.tj, vault: name } })
    return jsonResponse({ ok: true, deleted })
  })
}
