/**
 * Skills du magistrat (comme Claude web) — gérées depuis Paramètres → Attaché IA.
 * GET : liste des enveloppes (le navigateur admin déchiffre nom/description/contenu).
 * PUT : dépôt d'une skill (enveloppe chiffrée par le navigateur ; version archivée).
 * DELETE : retrait réversible (?id=…, version archivée avant suppression).
 * Le service attaché lit les mêmes fichiers : la skill vaut dès le run suivant.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, listSkillEnvelopes, writeSkillEnvelope, deleteSkillEnvelope, AttacheEnvelope } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    return jsonResponse({ skills: listSkillEnvelopes() })
  })
}

export async function PUT(req: Request) {
  return handle(async () => {
    const session = requireAttacheAdmin(req)
    const body = await req.json().catch(() => null) as { id?: string, envelope?: AttacheEnvelope } | null
    const env = body?.envelope
    if (!body?.id || typeof body.id !== 'string') return jsonResponse({ error: 'Identifiant requis' }, { status: 400 })
    if (!env || env.encrypted !== true || typeof env.iv !== 'string' || typeof env.ct !== 'string') {
      return jsonResponse({ error: 'Enveloppe chiffrée requise' }, { status: 400 })
    }
    if (env.ct.length > 1024 * 1024) return jsonResponse({ error: 'Skill trop volumineuse' }, { status: 413 })
    try {
      await writeSkillEnvelope(body.id, { v: 1, encrypted: true, iv: env.iv, ct: env.ct, savedAt: new Date().toISOString(), savedBy: session.u })
    } catch (e) {
      return jsonResponse({ error: e instanceof Error ? e.message : 'Écriture refusée' }, { status: 400 })
    }
    return jsonResponse({ ok: true })
  })
}

export async function DELETE(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const id = new URL(req.url).searchParams.get('id') || ''
    try {
      const removed = await deleteSkillEnvelope(id)
      return jsonResponse({ ok: removed })
    } catch (e) {
      return jsonResponse({ error: e instanceof Error ? e.message : 'Suppression refusée' }, { status: 400 })
    }
  })
}
