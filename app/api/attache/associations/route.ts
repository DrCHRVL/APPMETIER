/**
 * Table « type d'acte → trame(s) + skill(s) » de l'attaché — enveloppe chiffrée
 * (clé globale). GET : lecture (le navigateur admin déchiffre). PUT : réécriture
 * complète (le navigateur chiffre ; version précédente archivée). Éditée depuis
 * Paramètres → Attaché IA ; l'attaché la consulte et l'enrichit lui aussi.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, readAssociationsEnvelope, writeAssociationsEnvelope, AttacheEnvelope } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    return jsonResponse({ envelope: readAssociationsEnvelope() })
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
    if (env.ct.length > 1024 * 1024) return jsonResponse({ error: 'Table trop volumineuse' }, { status: 413 })
    await writeAssociationsEnvelope({ v: 1, encrypted: true, iv: env.iv, ct: env.ct, savedAt: new Date().toISOString(), savedBy: session.u })
    return jsonResponse({ ok: true })
  })
}
