/**
 * Graphique statistique du contentieux confié, régénéré par le service
 * attaché (PNG + données, mêmes règles et couleurs que la page Statistiques).
 * Sert à remplacer les marqueurs [GRAPHIQUE : …] des bilans rédigés par
 * l'attaché au moment des exports PDF/Word. Admin du TJ confié uniquement
 * (404 sinon, comme toutes les routes attaché).
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const q = new URL(req.url).searchParams
    const params = new URLSearchParams()
    params.set('graphique', q.get('graphique') || '')
    for (const k of ['du', 'au'] as const) {
      const v = q.get(k)
      if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) params.set(k, v)
    }
    const res = await attacheFetch('/stats-graphique?' + params.toString(), { timeoutMs: 60_000 })
    return jsonResponse(await res.json().catch(() => ({ error: 'Réponse illisible' })), { status: res.status })
  })
}
