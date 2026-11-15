/**
 * Empreintes des clés de chaque TJ, retenues par l'ADMINISTRATEUR GÉNÉRAL à
 * la première ouverture de leur séquestre (voir lib/web/escrow.ts,
 * controlerClesTj). Enveloppe chiffrée par une clé dérivée de sa phrase
 * personnelle : le serveur ne peut ni la lire ni la contrefaire ; il peut
 * seulement la conserver.
 *  GET : l'enveloppe (ou 404) · PUT { envelope } : la remplace.
 */
import { requireSuperAdmin, handle, jsonResponse } from '@/lib/server/auth'
import { dataDir, readJson, writeJson, withFileLock } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

const fichier = () => dataDir('escrow-epingles.json')

export async function GET(req: Request) {
  return handle(async () => {
    requireSuperAdmin(req)
    const envelope = readJson<Record<string, unknown> | null>(fichier(), null)
    if (!envelope) return jsonResponse({ exists: false }, { status: 404 })
    return jsonResponse({ exists: true, envelope })
  })
}

export async function PUT(req: Request) {
  return handle(async () => {
    requireSuperAdmin(req)
    const env = await req.json().catch(() => ({}))
    if (!env || env.encrypted !== true || typeof env.ct !== 'string' || typeof env.iv !== 'string'
      || typeof env.kdfSalt !== 'string' || typeof env.kdfIterations !== 'number') {
      return jsonResponse({ error: 'Enveloppe chiffrée requise' }, { status: 400 })
    }
    await withFileLock('escrow-epingles', async () => writeJson(fichier(), env))
    return jsonResponse({ ok: true })
  })
}
