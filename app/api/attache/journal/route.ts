/**
 * État du journal « pendant votre absence » — partagé entre appareils.
 * Le contenu des cartes vit dans le feed chiffré ; ici ne transitent que des
 * EMPREINTES opaques (hash de `ts|titre` calculé par le navigateur) : cartes
 * rangées, et repère « vu » par utilisateur. Ranger ou consulter sur un
 * appareil (ordinateur) vaut ainsi sur tous les autres (téléphone…).
 * GET  : { dismissed: [ids…], seenTs }
 * POST : { dismiss?: [ids…], seenTs? } — le repère « vu » n'avance que vers l'avant.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, readJournalStatuses, setJournalStatus, journalSeenId } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

const ID_RE = /^[a-f0-9]{6,32}$/
// Le feed n'expose que ses 200 dernières entrées : une rafale (migration du
// localStorage) ne peut pas légitimement dépasser cet ordre de grandeur.
const MAX_BATCH = 300

export async function GET(req: Request) {
  return handle(async () => {
    const session = requireAttacheAdmin(req)
    const all = readJournalStatuses()
    const dismissed = Object.keys(all).filter((id) => all[id]?.status === 'range')
    const seenTs = Number(all[journalSeenId(session.u)]?.status) || 0
    return jsonResponse({ dismissed, seenTs })
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    const session = requireAttacheAdmin(req)
    const body = await req.json().catch(() => null) as { dismiss?: unknown, seenTs?: unknown } | null
    if (!body) return jsonResponse({ error: 'Corps JSON requis' }, { status: 400 })
    const dismiss = Array.isArray(body.dismiss) ? body.dismiss.map(String) : []
    if (dismiss.length > MAX_BATCH || dismiss.some((id) => !ID_RE.test(id))) {
      return jsonResponse({ error: 'Empreintes invalides' }, { status: 400 })
    }
    try {
      for (const id of dismiss) await setJournalStatus(id, 'range', session.u)
      if (body.seenTs !== undefined) {
        const ts = Math.floor(Number(body.seenTs))
        // borne haute laxiste (horloges de téléphone) : +24 h, pas plus
        if (!Number.isFinite(ts) || ts <= 0 || ts > Date.now() + 24 * 3600_000) {
          return jsonResponse({ error: 'seenTs invalide' }, { status: 400 })
        }
        const seenId = journalSeenId(session.u)
        const current = Number(readJournalStatuses()[seenId]?.status) || 0
        if (ts > current) await setJournalStatus(seenId, String(ts), session.u)
      }
    } catch (e) {
      return jsonResponse({ error: e instanceof Error ? e.message : 'Écriture refusée' }, { status: 400 })
    }
    return jsonResponse({ ok: true })
  })
}
