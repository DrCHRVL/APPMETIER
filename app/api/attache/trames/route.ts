/**
 * Bibliothèque de trames du magistrat — gérée depuis Paramètres → Attaché IA.
 * Jusqu'ici les trames se dictaient en chat (« enregistre cette trame ») ;
 * cette route ajoute le téléversement en masse (converti en markdown par le
 * navigateur, chiffré clé globale) et la gestion directe dans le panneau.
 * GET : liste des enveloppes (le navigateur admin déchiffre).
 * PUT : dépôt d'une trame (enveloppe chiffrée ; version archivée).
 * DELETE : retrait réversible (?id=…).
 * POST : déclenche l'analyse IA des trames téléversées (classement +
 *        propositions d'amélioration) — relayée au service attaché, exécutée
 *        en arrière-plan, résultat dans le fil « pendant votre absence ».
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch, listCollectionEnvelopes, writeCollectionEnvelope, deleteCollectionEnvelope, AttacheEnvelope } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    return jsonResponse({ trames: listCollectionEnvelopes('trames') })
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
    if (env.ct.length > 1024 * 1024) return jsonResponse({ error: 'Trame trop volumineuse' }, { status: 413 })
    try {
      await writeCollectionEnvelope('trames', body.id, { v: 1, encrypted: true, iv: env.iv, ct: env.ct, savedAt: new Date().toISOString(), savedBy: session.u })
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
      const removed = await deleteCollectionEnvelope('trames', id)
      return jsonResponse({ ok: removed })
    } catch (e) {
      return jsonResponse({ error: e instanceof Error ? e.message : 'Suppression refusée' }, { status: 400 })
    }
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const body = await req.json().catch(() => null) as { analyse?: string[] } | null
    const noms = (Array.isArray(body?.analyse) ? body!.analyse : []).map(String).filter(Boolean).slice(0, 100)
    if (!noms.length) return jsonResponse({ error: 'Aucune trame à analyser' }, { status: 400 })
    const res = await attacheFetch('/trames/analyse', { method: 'POST', body: { noms } })
    return new Response(await res.text(), { status: res.status, headers: { 'content-type': 'application/json' } })
  })
}
