/**
 * FICHIER GLOBAL d'un dossier — toutes les pièces versées, en texte, dans un
 * seul fichier (sommaire puis un bloc par pièce), compilé par le service
 * attaché à partir des caches d'extraction. Le magistrat le télécharge depuis
 * la page Assistant de justice pour le verser dans un projet Claude web.
 * Administrateur du TJ confié UNIQUEMENT (404 sinon).
 *
 *   GET ?numero=…[&pochette=…]            → JSON { dossier, stats, sommaire, texte }
 *   GET ?numero=…&format=txt              → le fichier .txt (téléchargement)
 *
 * L'app relaie : le texte en clair transite du service au navigateur, comme
 * une réponse du chat de l'attaché — jamais stocké ici.
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
    const pochette = url.searchParams.get('pochette') || ''
    const qs = '?numero=' + encodeURIComponent(numero) + (pochette ? '&pochette=' + encodeURIComponent(pochette) : '')
    const res = await attacheFetch('/dossier-global' + qs, { timeoutMs: 290_000 })
    const data = await res.json().catch(() => ({ error: 'Réponse du service illisible' })) as
      { dossier?: string, texte?: string, error?: string, injoignable?: boolean }
    if (!res.ok) return jsonResponse(data, { status: res.status })
    if (url.searchParams.get('format') === 'txt') {
      const base = String(data.dossier || numero).replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 80)
      const nom = `GLOBAL_${base}${pochette ? '_' + pochette.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 40) : ''}.txt`
      return new Response(String(data.texte || ''), {
        status: 200,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(nom)}`,
          'cache-control': 'no-store',
        },
      })
    }
    return jsonResponse(data)
  })
}
