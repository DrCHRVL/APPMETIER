/**
 * SIRAL — cœur du calcul des statistiques d'actes (TSE).
 *
 * SOURCE UNIQUE des règles de rattachement des actes et prolongations à leur
 * date réelle (historique explicite d'abord, estimation par durée plafonnée
 * ensuite, prolongation héritée en dernier), partagée par :
 *  - l'écran et l'export PDF (hooks/useActeStats.ts — mode `year`, comptage
 *    par année civile, comportement historique conservé à l'identique) ;
 *  - le service attaché (scripts/attache/statistiques.mjs — mode `du`/`au`,
 *    comptage par période libre pour les bilans).
 *
 * Module JavaScript pur (ni React, ni Node) : mêmes constantes, mêmes règles
 * d'estimation dans les deux modes — seule la fenêtre de rattachement change.
 */

// Estimation par durée : repli pour les actes hérités sans historique
// structuré. Plafonnée pour neutraliser une dateFin aberrante (année mal
// saisie, import de document approximatif…) qui, sans garde-fou, est lue comme
// des milliers de renouvellements et fait exploser les totaux du tableau de
// bord (ex. « 24 400 prolongations », moyenne « 154.56 »).
// Une écoute/géoloc en préliminaire se renouvelle mensuellement, dans la limite
// légale de ~2 ans (≈ 24 prolongations) : au-delà, la durée est aberrante.
export const MAX_DUREE_ESTIMABLE_JOURS = 760 // ~25 mois, marge au-delà des 2 ans légaux

const JOUR_MS = 1000 * 60 * 60 * 24

/** Année d'une date ISO, ou null si absente/invalide. */
function yearOf(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d.getFullYear()
}

/** 'YYYY-MM-DD' d'une date, ou null (comparaison lexicale de période). */
function dayOf(iso) {
  const s = String(iso || '').trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  if (!s) return null
  const d = new Date(s)
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null
}

/**
 * Prolongations d'un acte, DATÉES, en privilégiant les données explicites
 * plutôt que l'estimation par durée :
 *
 *   1. `prolongationsHistory` fait foi. Chaque prolongation validée y est
 *      enregistrée avec sa date : décompte exact, rattaché à sa date réelle.
 *   2. À défaut (actes hérités sans historique), on se rabat sur :
 *      a. l'estimation par durée (si l'acte a une période initiale), plafonnée
 *         contre les dates aberrantes ; chaque renouvellement estimé est daté
 *         (début + période initiale + k×30 j) ;
 *      b. une prolongation unique héritée ou en attente (`prolongationData`/
 *         `prolongationDate`), datée si possible.
 *
 * `initialPeriodDays` = durée initiale légale (écoute 30 j, géoloc 15 j) ;
 * `undefined` pour les « autres actes » qui n'ont pas d'estimation par durée.
 *
 * Retourne la liste des dates ISO (une entrée par prolongation, null = non
 * datable — rattachée au repli `fallback`).
 */
function prolongationDates(acte, initialPeriodDays, fallback) {
  const base = dayOf(acte.dateDebut) ?? fallback

  // 1. Source de vérité : l'historique explicite (daté par entrée).
  const historique = acte.prolongationsHistory
  if (historique && historique.length > 0) {
    return historique.map((h) => dayOf(h.date) ?? base)
  }

  // 2a. Repli : estimation par durée, plafonnée contre les dates aberrantes.
  if (initialPeriodDays !== undefined && acte.dateDebut && acte.dateFin) {
    const debut = new Date(acte.dateDebut)
    const fin = new Date(acte.dateFin)
    if (!isNaN(debut.getTime()) && !isNaN(fin.getTime())) {
      const dureeJours = Math.floor((fin.getTime() - debut.getTime()) / JOUR_MS)
      if (dureeJours > initialPeriodDays && dureeJours <= MAX_DUREE_ESTIMABLE_JOURS) {
        const count = Math.floor((dureeJours - initialPeriodDays) / 30)
        if (count > 0) {
          // Chaque renouvellement estimé est daté : début + initiale + k×30 j.
          return Array.from({ length: count }, (_, k) =>
            new Date(debut.getTime() + (initialPeriodDays + k * 30) * JOUR_MS).toISOString().slice(0, 10))
        }
      }
    }
  }

  // 2b. Repli : prolongation unique héritée ou en attente de validation.
  if (acte.prolongationData || acte.prolongationDate) {
    return [dayOf(acte.prolongationDate) ?? dayOf(acte.prolongationData?.dateDebut) ?? base]
  }

  return []
}

/**
 * Statistiques d'actes, TOUTES enquêtes confondues, chaque acte/prolongation
 * étant rattaché à SA date (date de début de l'acte, date de chaque
 * prolongation) — et non à l'année d'ouverture de l'enquête.
 *
 * Fenêtre de rattachement, au choix :
 *   - `{ year }`  : année civile (comportement historique de l'écran ; `year`
 *     absent = aucun filtre, total historique) ;
 *   - `{ du, au }`: période libre AAAA-MM-JJ, bornes incluses (bilans).
 */
export function computeActeStatsCore(enquetes, fenetre = {}) {
  const { year, du, au } = fenetre
  const parPeriode = Boolean(du && au)
  // Un même prédicat pour l'acte initial et ses prolongations.
  const inWindow = parPeriode
    ? (dateIso) => { const d = dayOf(dateIso); return Boolean(d && d >= du && d <= au) }
    : (dateIso) => year === undefined || yearOf(dateIso) === year

  const stats = {
    ecoutes: 0,
    geolocalisations: 0,
    autresActes: 0,
    prolongationsEcoutes: 0,
    prolongationsGeo: 0,
    prolongationsAutres: 0,
    enquetesAvecActes: 0,
  }

  for (const e of enquetes) {
    const fallback = dayOf(e.dateCreation)
    let countedForEnquete = 0

    // Période initiale légale : écoute 30 j, géoloc 15 j.
    for (const ecoute of e.ecoutes || []) {
      if (inWindow(dayOf(ecoute.dateDebut) ?? fallback)) { stats.ecoutes++; countedForEnquete++ }
      const prol = prolongationDates(ecoute, 30, fallback).filter(inWindow).length
      stats.prolongationsEcoutes += prol
      countedForEnquete += prol
    }
    for (const geoloc of e.geolocalisations || []) {
      if (inWindow(dayOf(geoloc.dateDebut) ?? fallback)) { stats.geolocalisations++; countedForEnquete++ }
      const prol = prolongationDates(geoloc, 15, fallback).filter(inWindow).length
      stats.prolongationsGeo += prol
      countedForEnquete += prol
    }
    // Autres actes : pas d'estimation par durée, uniquement l'historique / la
    // prolongation héritée.
    for (const acte of e.actes || []) {
      if (inWindow(dayOf(acte.dateDebut) ?? fallback)) { stats.autresActes++; countedForEnquete++ }
      const prol = prolongationDates(acte, undefined, fallback).filter(inWindow).length
      stats.prolongationsAutres += prol
      countedForEnquete += prol
    }

    if (countedForEnquete > 0) stats.enquetesAvecActes++
  }

  const totalActes = stats.ecoutes + stats.geolocalisations + stats.autresActes
  const totalProlongations = stats.prolongationsEcoutes + stats.prolongationsGeo + stats.prolongationsAutres

  return {
    ...stats,
    totalActes,
    totalProlongations,
    totalAvecProlongations: totalActes + totalProlongations,
  }
}
