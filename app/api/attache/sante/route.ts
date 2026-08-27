/**
 * L'ENDROIT UNIQUE — l'attaché est-il vivant, et que fournit-il ?
 *
 * Rassemble en un seul appel ce qui était éparpillé entre trois panneaux :
 * l'état du service, ce qu'il a le droit de voir, et ce qu'il a réellement
 * produit. Trois des cinq façons dont il peut tomber en panne le laissent
 * parfaitement vivant en apparence : cette route les nomme.
 *
 * Administrateur du TJ confié uniquement — comme toutes les routes attaché,
 * son existence même ne doit rien laisser paraître aux autres utilisateurs.
 */
import fs from 'fs'
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch, attacheEnabled, attacheTjId } from '@/lib/server/attache'
import { tjDataDir } from '@/lib/server/store'
import { verdictAttache } from '@/lib/server/attacheSante'

export const dynamic = 'force-dynamic'

/** Pièces dont le texte est déjà extrait — comptées sans rien déchiffrer. */
function piecesEnCache(): number {
  try {
    return fs.readdirSync(tjDataDir(attacheTjId(), 'attache', 'doccache'))
      .filter((f) => f.endsWith('.json')).length
  } catch {
    return 0
  }
}

async function lireJson(pathname: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await attacheFetch(pathname, { timeoutMs: 8000 })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)

    const configure = attacheEnabled()
    const status = configure ? await lireJson('/status') : null
    const recoupements = status ? await lireJson('/recoupements') : null

    const keyring = (status?.keyring || {}) as { granted?: boolean, scopes?: string[] }
    const sante = verdictAttache({
      configure,
      joignable: Boolean(status),
      cleMaitre: Boolean(status?.masterKey),
      scopesAttendus: (status?.scopesAttendus as string[]) || [],
      scopesRemis: keyring.granted ? (keyring.scopes || []) : [],
      claudeOk: Boolean((status?.claude as { ok?: boolean } | undefined)?.ok),
    })

    // CE QU'IL CALCULE — sans intelligence artificielle, sans jeton, sans que
    // rien ne quitte la machine. Ne dépend que des clés.
    const dernier = (recoupements?.dernier || null) as
      { calculeAt?: string, perimetre?: Record<string, number | string[]>, signaux?: number } | null

    return jsonResponse({
      sante,
      calcule: {
        recoupements: dernier
          ? {
            dernierAt: dernier.calculeAt,
            signaux: dernier.signaux,
            perimetre: dernier.perimetre,
            enCours: Boolean(recoupements?.enCours),
          }
          : { dernierAt: null, enCours: Boolean(recoupements?.enCours) },
        piecesEnCache: piecesEnCache(),
      },
      // CE QU'IL RÉDIGE — les travaux confiés à Claude. Une authentification
      // périmée les arrête, elle n'arrête AUCUN des calculs ci-dessus.
      redige: {
        disponible: sante.iaDisponible,
        detail: (status?.claude as { version?: string } | undefined)?.version || null,
      },
    })
  })
}
