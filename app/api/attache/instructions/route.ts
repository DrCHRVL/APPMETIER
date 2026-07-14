/**
 * Consignes permanentes de l'attaché — le « prompt » rédigé par le magistrat,
 * relu par l'agent au début de chaque intervention (chat, mails, brief,
 * routines). Enveloppe chiffrée (clé globale) : GET pour lecture (déchiffrée
 * dans le navigateur admin), PUT pour réécriture complète (chiffrée dans le
 * navigateur ; version précédente archivée). Même modèle que la mémoire.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, readInstructionsEnvelope, writeInstructionsEnvelope, AttacheEnvelope } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    return jsonResponse({ envelope: readInstructionsEnvelope() })
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
    await writeInstructionsEnvelope({ v: 1, encrypted: true, iv: env.iv, ct: env.ct, savedAt: new Date().toISOString(), savedBy: session.u })
    return jsonResponse({ ok: true })
  })
}
