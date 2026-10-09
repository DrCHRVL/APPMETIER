/**
 * DOSSIER DE RÉDACTION (.zip) — assemblé par le service attaché : fichier
 * global du dossier, trames et skills applicables à l'acte visé, documents ★
 * de la base de connaissances, actes précédents du même type, instructions
 * du projet Claude web, LISEZMOI. Le magistrat le verse dans son projet
 * Claude web. Administrateur du TJ confié UNIQUEMENT (404 sinon).
 *
 *   GET ?numero=…[&acte=…]  → application/zip (téléchargement)
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const url = new URL(req.url)
    const numero = url.searchParams.get('numero') || ''
    if (!numero) return jsonResponse({ error: 'numero requis' }, { status: 400 })
    const acte = (url.searchParams.get('acte') || '').slice(0, 120)
    const qs = '?numero=' + encodeURIComponent(numero) + (acte ? '&acte=' + encodeURIComponent(acte) : '')
    const res = await attacheFetch('/dossier-redaction' + qs, { timeoutMs: 290_000 })
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Réponse du service illisible' }))
      return jsonResponse(data, { status: res.status })
    }
    const zip = await res.arrayBuffer()
    const nom = decodeURIComponent(res.headers.get('x-siral-nom') || '') || `REDACTION_${numero.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 80)}.zip`
    return new Response(zip, {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(nom)}`,
        'x-siral-fichiers': res.headers.get('x-siral-fichiers') || '',
        'cache-control': 'no-store',
      },
    })
  })
}
