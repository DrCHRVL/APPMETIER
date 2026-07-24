/**
 * Analyse IA des documents — extraction d'actes + évaluation de la chaîne
 * légale par le modèle Claude de l'attaché. Administrateur du TJ confié
 * UNIQUEMENT (404, indistinguable d'une route inexistante, sinon).
 *
 * L'app ne fait que relayer : le texte des PDF (déjà extrait côté navigateur)
 * et un résumé des actes de l'enquête partent au service attaché, qui
 * interroge le CLI en un tour, sans outil, et renvoie du JSON structuré.
 * Aucune écriture : le résultat repasse par la validation de l'utilisateur
 * (dédoublonnage, chaînage, ✓ avant création) dans le modal SIRAL.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Sonde de disponibilité : 200 pour l'admin du TJ confié, 404 sinon. */
export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    return jsonResponse({ available: true })
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const body = await req.json().catch(() => null) as
      | { docs?: unknown; actesExistants?: unknown; enquete?: unknown }
      | null
    if (!body || !Array.isArray(body.docs) || body.docs.length === 0) {
      return jsonResponse({ ok: false, error: 'Aucun document à analyser' }, { status: 400 })
    }
    // Un run peut durer jusqu'à quelques minutes (lecture de plusieurs actes).
    // `enquete` (numéros + NATINF enregistrés) alimente les contrôles de
    // cohérence : numéro de procédure divergent, NATINF absents, dates.
    const res = await attacheFetch('/analyse-documents', {
      method: 'POST',
      body: { docs: body.docs, actesExistants: body.actesExistants ?? [], enquete: body.enquete ?? null },
      timeoutMs: 280_000,
    })
    const data = await res.json().catch(() => ({ ok: false, error: 'Réponse du service illisible' }))
    return jsonResponse(data, { status: res.status })
  })
}
