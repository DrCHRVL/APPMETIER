/**
 * Consignes PAR DOMAINE — les prompts métier de l'attaché (description d'un
 * dossier, recherche profonde dans la cartographie, chaque étage d'un chantier
 * d'analyse profonde). Jusqu'ici figés dans le code, ils se complètent ou se
 * remplacent depuis Paramètres → Attaché IA.
 *
 * GET  : le CATALOGUE (libellés, socles intégrés — servi par le service
 *        attaché, seul détenteur du code des prompts) + l'enveloppe chiffrée
 *        des consignes du magistrat (déchiffrée dans le navigateur admin).
 * PUT  : réécriture complète de l'enveloppe (chiffrée dans le navigateur ;
 *        version précédente archivée). Même modèle que les consignes
 *        permanentes et la mémoire.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch, readConsignesEnvelope, writeConsignesEnvelope, AttacheEnvelope } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    let catalogue: unknown[] = []
    try {
      const res = await attacheFetch('/consignes-catalogue')
      const data = await res.json().catch(() => ({})) as { catalogue?: unknown[] }
      catalogue = Array.isArray(data.catalogue) ? data.catalogue : []
    } catch {
      // service injoignable : le panneau affiche l'enveloppe seule et le dit
    }
    return jsonResponse({ catalogue, envelope: readConsignesEnvelope() })
  })
}

export async function PUT(req: Request) {
  return handle(async () => {
    const session = requireAttacheAdmin(req)
    const body = await req.json().catch(() => null) as { envelope?: AttacheEnvelope } | null
    const env = body?.envelope
    if (!env || env.encrypted !== true || typeof env.iv !== 'string' || typeof env.ct !== 'string') {
      return jsonResponse({ error: 'Enveloppe chiffrée requise' }, { status: 400 })
    }
    if (env.ct.length > 1024 * 1024) return jsonResponse({ error: 'Consignes trop volumineuses' }, { status: 413 })
    await writeConsignesEnvelope({ v: 1, encrypted: true, iv: env.iv, ct: env.ct, savedAt: new Date().toISOString(), savedBy: session.u })
    return jsonResponse({ ok: true })
  })
}
