/**
 * Entraide — lecture d'une pièce téléversée par le service attaché
 * (synthèse des faits, demande, lieux, personnes, mesures). Administrateur du
 * TJ confié UNIQUEMENT (404, indistinguable d'une route inexistante, sinon).
 *
 * GET           : sonde de disponibilité (200 / 404).
 * GET  ?id=…    : lectures conservées pour une demande.
 * POST {nom, b64, demandeId?}           : lit la pièce (non conservée).
 * POST {action:'sauver', demandeId, analyse} : rattache une lecture faite à
 *      la création, une fois la demande enregistrée.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return jsonResponse({ available: true })
    const res = await attacheFetch(`/entraide-analyse?id=${encodeURIComponent(id)}`, { method: 'GET', timeoutMs: 15_000 })
    const data = await res.json().catch(() => ({ lectures: [] }))
    return jsonResponse(data, { status: res.status })
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    if (!body) return jsonResponse({ ok: false, error: 'Requête illisible' }, { status: 400 })
    const res = await attacheFetch('/entraide-analyse', { method: 'POST', body, timeoutMs: 280_000 })
    const data = await res.json().catch(() => ({ ok: false, error: 'Réponse du service illisible' }))
    return jsonResponse(data, { status: res.status })
  })
}
