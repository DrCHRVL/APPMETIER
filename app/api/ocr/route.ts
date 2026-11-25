/**
 * OCR de SIRAL — relais vers le service « ocr » (PaddleOCR, sans clé ni
 * données : voir docs/OCR.md). Indépendant de l'attaché : ouvert à toute
 * session du tribunal ; 404 si le service n'est pas configuré.
 *
 * GET                          : sonde de disponibilité (200 / 404 / 503).
 * POST {b64, pages?, lignes?}  : API v1 du service, telle quelle ; rien n'est conservé.
 */
import crypto from 'crypto'
import { handle, jsonResponse, requireTjSession } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const url = () => (process.env.SIRAL_OCR_URL || '').replace(/\/+$/, '')
function secret(): string | null {
  if (process.env.SIRAL_OCR_SECRET) return process.env.SIRAL_OCR_SECRET
  if (process.env.SIRAL_SECRET) return crypto.createHash('sha256').update('ocr-bridge:' + process.env.SIRAL_SECRET).digest('hex')
  return null
}

function garde(req: Request) {
  requireTjSession(req)
  if (!url() || !secret()) throw jsonResponse({ error: 'Introuvable' }, { status: 404 })
}

async function relais(chemin: string, init: { method: string, body?: string }, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController()
  const minuteur = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url() + chemin, {
      method: init.method,
      headers: { 'x-ocr-secret': secret()!, ...(init.body ? { 'content-type': 'application/json' } : {}) },
      body: init.body,
      signal: ctrl.signal,
      cache: 'no-store',
    })
  } catch {
    return jsonResponse({ ok: false, error: 'Service OCR injoignable' }, { status: 503 })
  } finally {
    clearTimeout(minuteur)
  }
}

export async function GET(req: Request) {
  return handle(async () => {
    garde(req)
    const res = await relais('/status', { method: 'GET' }, 5_000)
    const data = await res.json().catch(() => ({})) as { ok?: boolean, occupe?: boolean, en_attente?: number }
    // charge du service (tous postes confondus) : affichée dans la colonne des tâches OCR
    return res.ok && data.ok
      ? jsonResponse({ available: true, occupe: Boolean(data.occupe), en_attente: Number(data.en_attente) || 0 })
      : jsonResponse({ available: false }, { status: 503 })
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    garde(req)
    const res = await relais('/v1/ocr', { method: 'POST', body: await req.text() }, 280_000)
    const data = await res.json().catch(() => ({ ok: false, error: 'Réponse du service OCR illisible' }))
    return jsonResponse(data, { status: res.status })
  })
}
