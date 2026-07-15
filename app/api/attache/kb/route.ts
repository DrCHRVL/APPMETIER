/**
 * Base de connaissances du magistrat — gérée depuis Paramètres → Attaché IA.
 * Le fond documentaire durable (jurisprudences, circulaires, modes opératoires,
 * fiches, contacts), converti en markdown PAR LE NAVIGATEUR au téléversement
 * puis chiffré (clé globale) : l'app ne voit jamais un document en clair.
 * GET : liste des enveloppes (le navigateur admin déchiffre).
 * PUT : dépôt d'une entrée (enveloppe chiffrée ; version archivée).
 * DELETE : retrait réversible (?id=…, version archivée avant suppression).
 * Le service attaché lit les mêmes fichiers : l'entrée vaut dès le run suivant.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, listCollectionEnvelopes, writeCollectionEnvelope, deleteCollectionEnvelope, AttacheEnvelope } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    return jsonResponse({ entries: listCollectionEnvelopes('kb') })
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
    if (env.ct.length > 2 * 1024 * 1024) return jsonResponse({ error: 'Entrée trop volumineuse (2 Mo max une fois convertie)' }, { status: 413 })
    try {
      await writeCollectionEnvelope('kb', body.id, { v: 1, encrypted: true, iv: env.iv, ct: env.ct, savedAt: new Date().toISOString(), savedBy: session.u })
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
      const removed = await deleteCollectionEnvelope('kb', id)
      return jsonResponse({ ok: removed })
    } catch (e) {
      return jsonResponse({ error: e instanceof Error ? e.message : 'Suppression refusée' }, { status: 400 })
    }
  })
}
