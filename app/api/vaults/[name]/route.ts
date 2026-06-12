/**
 * Coffres chiffrés. GET : version courante (enveloppe opaque). PUT : nouvelle
 * version (l'ancienne est archivée automatiquement, historique immuable).
 */
import { requireSession, handle, jsonResponse } from '@/lib/server/auth'
import { readVault, writeVault, deleteVault, isSafeName, appendLog } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: { name: string } }) {
  return handle(async () => {
    requireSession(req)
    if (!isSafeName(params.name)) return jsonResponse({ error: 'Nom invalide' }, { status: 400 })
    const envelope = readVault(params.name)
    if (!envelope) return jsonResponse({ exists: false }, { status: 404 })
    return jsonResponse({ exists: true, envelope })
  })
}

export async function PUT(req: Request, { params }: { params: { name: string } }) {
  return handle(async () => {
    const session = requireSession(req)
    if (!isSafeName(params.name)) return jsonResponse({ error: 'Nom invalide' }, { status: 400 })
    const envelope = await req.json()
    if (!envelope || envelope.encrypted !== true || typeof envelope.ct !== 'string' || typeof envelope.iv !== 'string') {
      return jsonResponse({ error: 'Enveloppe chiffrée requise (E2EE obligatoire)' }, { status: 400 })
    }
    if (envelope.ct.length > 80 * 1024 * 1024) {
      return jsonResponse({ error: 'Coffre trop volumineux' }, { status: 413 })
    }
    const { version } = await writeVault(params.name, envelope, session.u)
    await appendLog('audit.jsonl', { timestamp: new Date().toISOString(), user: session.u, action: 'vault.write', details: { vault: params.name, version } })
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
    const session = requireSession(req)
    const name = params.name
    if (!isSafeName(name)) return jsonResponse({ error: 'Nom invalide' }, { status: 400 })
    const isAccessVault = /^(keyring|grant)-/.test(name)
    const ownGrant = name === `grant-${session.u}` || name === `keyring-${session.u}`
    if (!isAccessVault || (session.r !== 'admin' && !ownGrant)) {
      return jsonResponse({ error: 'Suppression non autorisée' }, { status: 403 })
    }
    const deleted = await deleteVault(name)
    await appendLog('audit.jsonl', { timestamp: new Date().toISOString(), user: session.u, action: 'vault.delete', details: { vault: name } })
    return jsonResponse({ ok: true, deleted })
  })
}
