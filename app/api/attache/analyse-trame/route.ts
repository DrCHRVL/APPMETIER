/**
 * Analyse IA d'un acte déjà rédigé → proposition de TRAME DE FORME.
 * Administrateur du TJ confié UNIQUEMENT (404, indistinguable d'une route
 * inexistante, sinon).
 *
 * L'app ne fait que relayer. Le fichier de l'utilisateur, lui, ne bouge pas :
 * le navigateur ouvre le .docx/.odt sur place et n'envoie que la CHARPENTE de
 * l'acte — une ligne par paragraphe, tronquée, avec ses indices de mise en
 * page. Le service attaché interroge le CLI en un tour, sans outil, et renvoie
 * le classement ligne à ligne en JSON. Aucune écriture : la proposition
 * repasse par la validation du magistrat (chaque ligne reste réassignable)
 * avant que la trame ne soit enregistrée.
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
      | { nomFichier?: unknown; format?: unknown; lignes?: unknown }
      | null
    if (!body || !Array.isArray(body.lignes) || body.lignes.length === 0) {
      return jsonResponse({ ok: false, error: 'Aucune ligne à analyser' }, { status: 400 })
    }
    const res = await attacheFetch('/analyse-trame', {
      method: 'POST',
      body: {
        nomFichier: typeof body.nomFichier === 'string' ? body.nomFichier : '',
        format: body.format === 'odt' ? 'odt' : 'docx',
        lignes: body.lignes,
      },
      timeoutMs: 200_000,
    })
    const data = await res.json().catch(() => ({ ok: false, error: 'Réponse du service illisible' }))
    return jsonResponse(data, { status: res.status })
  })
}
