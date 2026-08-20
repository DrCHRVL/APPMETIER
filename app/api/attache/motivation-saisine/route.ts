/**
 * Proposition de motivation de criminalité grave pour un soit-transmis de
 * saisine — relais vers le modèle Claude de l'attaché. Administrateur du TJ
 * confié UNIQUEMENT (404, indistinguable d'une route inexistante, sinon).
 *
 * La bibliothèque de circonstances (utils/saisine/motivations.ts) couvre les
 * matières courantes ; elle rend mal les dossiers COMPOSITES, où plusieurs
 * familles doivent tenir dans une seule phrase (corruption, violation du secret
 * et association de malfaiteurs, par exemple). C'est le seul emploi de cette
 * route.
 *
 * Le contrat est volontairement ÉTROIT, et c'est le point important : le
 * dossier ne part pas. Sont transmis les seules qualifications retenues, la
 * peine encourue et, si le magistrat en saisit un, un contexte de quelques
 * lignes qu'il a lui-même écrit — jamais la description de l'enquête, ni les
 * mis en cause, ni les pièces. Il revient un membre de phrase, celui qui
 * s'intercale entre « qu'en considération » et « cette enquête relève de la
 * criminalité grave ». Rien n'est écrit : la proposition arrive dans le champ
 * éditable du modal, sous les yeux du magistrat, qui la reprend ou la jette.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

/** Longueurs bornées : ce qui part doit rester court, ce qui revient aussi. */
const MAX_QUALIFICATIONS = 8
const MAX_CONTEXTE = 600
const MAX_MOTIVATION = 900

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
    const body = await req.json().catch(() => null) as {
      qualifications?: unknown
      quantum?: unknown
      famille?: unknown
      contexte?: unknown
    } | null

    const qualifications = (Array.isArray(body?.qualifications) ? body!.qualifications : [])
      .map((q) => String(q).trim())
      .filter(Boolean)
      .slice(0, MAX_QUALIFICATIONS)
    if (!qualifications.length) {
      return jsonResponse({ ok: false, error: 'Aucune qualification à motiver' }, { status: 400 })
    }

    const res = await attacheFetch('/motivation-saisine', {
      method: 'POST',
      body: {
        qualifications,
        quantum: typeof body?.quantum === 'string' ? body.quantum.trim().slice(0, 40) : '',
        famille: typeof body?.famille === 'string' ? body.famille.trim().slice(0, 60) : '',
        contexte: typeof body?.contexte === 'string' ? body.contexte.trim().slice(0, MAX_CONTEXTE) : '',
        maxCaracteres: MAX_MOTIVATION,
      },
      timeoutMs: 90_000,
    })

    const data = await res.json().catch(() => ({ ok: false, error: 'Réponse du service illisible' }))
    // Second garde-fou sur la longueur : la trame de l'acte ne doit pas se
    // faire déborder par un paragraphe qui partirait dans le fond du dossier.
    if (data && typeof data.motivation === 'string') {
      data.motivation = data.motivation.trim().slice(0, MAX_MOTIVATION)
    }
    return jsonResponse(data, { status: res.status })
  })
}
