/**
 * Moniteur d'activité — santé du serveur SIRAL + travaux de fond de l'attaché.
 *
 * Retourne uniquement des mesures techniques (durées, compteurs, mémoire) :
 * jamais un contenu d'enquête, jamais une clé. Le volet attaché n'est fourni
 * qu'à l'administrateur du TJ confié — les autres reçoivent le volet serveur
 * seul.
 */
import { monitorEventLoopDelay } from 'perf_hooks'
import { handle, jsonResponse, requireTjSession } from '@/lib/server/auth'
import { attacheEnabled, attacheTjId, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

// Histogramme du retard de l'event loop — LA mesure de charge du serveur :
// un retard élevé signifie qu'une lecture synchrone (coffre volumineux…)
// bloque toutes les requêtes en cours.
const boucle = monitorEventLoopDelay({ resolution: 20 })
boucle.enable()
const demarreA = new Date().toISOString()

export async function GET(req: Request) {
  return handle(async () => {
    const session = requireTjSession(req)

    const mem = process.memoryUsage()
    const eventLoop = {
      moyenMs: Math.round(boucle.mean / 1e6),
      maxMs: Math.round(boucle.max / 1e6),
      p99Ms: Math.round(boucle.percentile(99) / 1e6),
    }
    boucle.reset() // fenêtre glissante entre deux lectures du moniteur

    let attache: unknown = null
    if (session.r === 'admin' && attacheEnabled() && session.tj === attacheTjId()) {
      try {
        const res = await attacheFetch('/activite', { timeoutMs: 4000 })
        if (res.ok) attache = await res.json()
      } catch { /* service occupé ou éteint : le volet reste vide */ }
    }

    return jsonResponse({
      serveur: {
        demarreA,
        eventLoop,
        memoire: { rssMB: Math.round(mem.rss / (1024 * 1024)), heapMB: Math.round(mem.heapUsed / (1024 * 1024)) },
      },
      attache,
    })
  })
}
