/**
 * SIRAL — indicateurs d'activité d'un TJ pour l'administrateur général.
 *
 * Le serveur ne lit pas les données (chiffrement de bout en bout) : ce sont
 * les postes des membres qui comptent, puis SCELLENT les compteurs pour la clé
 * d'administration générale (coffres `indicateurs-*`). Le serveur ne voit pas
 * même les nombres ; l'administrateur général seul les ouvre (Gestion des TJ).
 * Rien que des compteurs : aucun nom, aucun numéro de dossier.
 *  - par contentieux (tout membre qui y a accès) : `indicateurs-ctx-<id>` ;
 *  - par utilisateur (instructions et AIR, stockés par compte) :
 *    `indicateurs-user-<identifiant>`.
 */
import type { Enquete } from '@/types/interfaces'
import { sealPourAdmin, type EscrowHttp } from './escrow'

export interface IndicateursContentieux {
  type: 'contentieux'
  contentieux: string
  enCours: number
  archives: number
  enInstruction: number
  /** mis en cause des dossiers en cours (victimes exclues) */
  misEnCause: number
  maj: string
}

export interface IndicateursUtilisateur {
  type: 'utilisateur'
  instructionsEnCours: number
  misEnExamen: number
  mesuresAirActives: number
  maj: string
}

export type Indicateurs = IndicateursContentieux | IndicateursUtilisateur

export function calculerIndicateursContentieux(contentieux: string, enquetes: Enquete[]): IndicateursContentieux {
  const enCours = enquetes.filter((e) => e.statut === 'en_cours')
  return {
    type: 'contentieux',
    contentieux,
    enCours: enCours.length,
    archives: enquetes.filter((e) => e.statut === 'archive').length,
    enInstruction: enquetes.filter((e) => e.statut === 'instruction').length,
    misEnCause: enCours.reduce((n, e) => n + (e.misEnCause || []).filter((m) => !m.isVictime).length, 0),
    maj: new Date().toISOString(),
  }
}

export function calculerIndicateursUtilisateur(
  instructions: Array<{ archived?: boolean, misEnExamen?: unknown[] }>,
  mesuresAir: Array<{ dateCloture?: string, dateFinPriseEnCharge?: string }>,
): IndicateursUtilisateur {
  const actives = instructions.filter((d) => !d.archived)
  return {
    type: 'utilisateur',
    instructionsEnCours: actives.length,
    misEnExamen: actives.reduce((n, d) => n + (d.misEnExamen || []).length, 0),
    mesuresAirActives: mesuresAir.filter((m) => !m.dateCloture && !m.dateFinPriseEnCharge).length,
    maj: new Date().toISOString(),
  }
}

/** Somme des indicateurs d'un TJ (vue de l'administrateur général). */
export function totaliser(liste: Indicateurs[]) {
  const t = { enCours: 0, archives: 0, enInstruction: 0, misEnCause: 0, instructionsEnCours: 0, misEnExamen: 0, mesuresAirActives: 0, maj: '' }
  for (const i of liste) {
    if (i.type === 'contentieux') {
      t.enCours += i.enCours; t.archives += i.archives; t.enInstruction += i.enInstruction; t.misEnCause += i.misEnCause
    } else {
      t.instructionsEnCours += i.instructionsEnCours; t.misEnExamen += i.misEnExamen; t.mesuresAirActives += i.mesuresAirActives
    }
    if (i.maj > t.maj) t.maj = i.maj
  }
  return t
}

// dernière valeur publiée par coffre (hors date) : on ne réécrit pas l'identique
const publies = new Map<string, string>()

/** Scelle et dépose les indicateurs qui ont changé. Rend le nombre de dépôts. */
export async function publierIndicateurs(
  entrees: Array<{ coffre: string, valeur: Indicateurs }>,
  username: string,
  http: EscrowHttp,
): Promise<number> {
  const pub = await http.getJson('/api/escrow')
  if (pub.status !== 200) return 0 // pas encore de clé d'administration générale
  let n = 0
  for (const { coffre, valeur } of entrees) {
    const { maj: _maj, ...sansDate } = valeur
    const empreinte = JSON.stringify(sansDate)
    if (publies.get(coffre) === empreinte) continue
    const env = await sealPourAdmin(String(pub.json.publicSpki), valeur, username)
    if (await http.putJson(`/api/vaults/${coffre}`, env) === 200) {
      publies.set(coffre, empreinte)
      n++
    }
  }
  return n
}
