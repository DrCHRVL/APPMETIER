/**
 * Questions posées par l'attaché (cartes du fil avec zone de réponse).
 * Le contenu vit dans le feed chiffré ; ici, seulement les STATUTS
 * (répondu / ignoré), indexés par qid opaques — comme le majordome.
 * GET  : statuts courants.
 * POST : { id, status } — marquer répondu ou ignoré.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, readQuestionStatuses, setQuestionStatus, QuestionStatus } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    return jsonResponse({ statuses: readQuestionStatuses() })
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    const session = requireAttacheAdmin(req)
    const body = await req.json().catch(() => null) as { id?: string, status?: QuestionStatus } | null
    if (!body?.id || !['repondu', 'ignore'].includes(String(body.status))) {
      return jsonResponse({ error: 'id et status (repondu|ignore) requis' }, { status: 400 })
    }
    try {
      await setQuestionStatus(body.id, body.status as QuestionStatus, session.u)
    } catch (e) {
      return jsonResponse({ error: e instanceof Error ? e.message : 'Refusé' }, { status: 400 })
    }
    return jsonResponse({ ok: true })
  })
}
