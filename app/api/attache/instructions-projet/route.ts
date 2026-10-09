/**
 * Instructions du projet Claude web — la version de référence tenue dans SIRAL
 * (enveloppe chiffrée, clé globale). GET : lecture (le navigateur admin
 * déchiffre, puis « Copier » pour coller dans les instructions du projet
 * claude.ai). PUT : réécriture complète (le navigateur chiffre ; version
 * précédente archivée). L'attaché en propose des révisions (✓/✗) à partir des
 * actes corrigés ou refusés ; Claude web la lit par le connecteur.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, readInstructionsProjetEnvelope, writeInstructionsProjetEnvelope, AttacheEnvelope } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    return jsonResponse({ envelope: readInstructionsProjetEnvelope() })
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
    if (env.ct.length > 512 * 1024) return jsonResponse({ error: 'Instructions trop volumineuses' }, { status: 413 })
    await writeInstructionsProjetEnvelope({ v: 1, encrypted: true, iv: env.iv, ct: env.ct, savedAt: new Date().toISOString(), savedBy: session.u })
    return jsonResponse({ ok: true })
  })
}
