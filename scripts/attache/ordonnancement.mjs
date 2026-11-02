/**
 * SIRAL — Attaché de justice · ORDONNANCEMENT des travaux de nuit.
 *
 * Quand un travail de fond a-t-il le droit de tourner ? Module à part, sans
 * état ni effet de bord : la règle se lit, se raconte à l'écran et se teste.
 *
 * LA NUIT EST CELLE DU MAGISTRAT, pas celle du conteneur. Docker tourne en
 * UTC par défaut : « 22 h → 7 h » y valait 0 h → 9 h à Amiens en été — la
 * fenêtre mordait sur la matinée de travail et s'ouvrait deux heures trop
 * tard. On lit donc l'heure dans un fuseau DÉCLARÉ.
 */

const clampHeure = (v, dflt) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n <= 23 ? Math.floor(n) : dflt
}

export const NIGHT_START = clampHeure(process.env.SIRAL_ATTACHE_NIGHT_START, 22)
export const NIGHT_END = clampHeure(process.env.SIRAL_ATTACHE_NIGHT_END, 7)
export const NIGHT_TZ = String(process.env.SIRAL_ATTACHE_TZ || 'Europe/Paris')

/** L'heure qu'il est POUR LE MAGISTRAT (fuseau déclaré), pas pour le conteneur. */
export function heureLocale(now = new Date(), tz = NIGHT_TZ) {
  try {
    // formatToParts, et non format() : en français le rendu est « 23 h », que
    // Number() ne sait pas lire — l'heure serait revenue NaN et la fenêtre se
    // serait refermée sur un fuseau correct.
    const part = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', hour12: false, timeZone: tz })
      .formatToParts(now).find((p) => p.type === 'hour')
    const h = Number(part?.value)
    if (Number.isFinite(h)) return h % 24
  } catch { /* fuseau inconnu : repli ci-dessous */ }
  return now.getHours() // on ne bloque jamais un travail sur une question de fuseau
}

/** Sommes-nous dans la fenêtre de nuit ? (début = fin : fenêtre neutralisée) */
export function inNightWindow(now = new Date(), { debut = NIGHT_START, fin = NIGHT_END, tz = NIGHT_TZ } = {}) {
  if (debut === fin) return true
  const h = heureLocale(now, tz)
  return debut < fin ? (h >= debut && h < fin) : (h >= debut || h < fin)
}

/** Prochaine ouverture de la fenêtre — pour le dire à l'écran, pas pour décider. */
export function prochaineNuit(now = new Date(), opts = {}) {
  const { debut = NIGHT_START, fin = NIGHT_END, tz = NIGHT_TZ } = opts
  if (debut === fin || inNightWindow(now, opts)) return null
  return { heure: debut, dansHeures: (debut - heureLocale(now, tz) + 24) % 24, fuseau: tz }
}

// ──────────────────────────────────────────────
// LE CHANTIER HEBDOMADAIRE DE RECOUPEMENTS
// ──────────────────────────────────────────────
//
// Rapprocher tous les dossiers les uns des autres est un calcul long. Il ne
// doit tomber ni pendant que le magistrat travaille, ni plus souvent qu'il
// n'apporte quelque chose : le fonds ne bouge pas assez en une nuit pour que
// les signaux changent. D'où UNE FOIS PAR SEMAINE, dans la nuit du samedi au
// dimanche — le moment où l'on ne travaille pas.
//
// Comme la fenêtre de nuit, la règle est pure : elle se lit, se raconte à
// l'écran et se teste. Le magistrat garde le dernier mot (« Lancer maintenant »
// passe outre, à toute heure).

/** Jour de la semaine du magistrat (0 = dimanche), fuseau déclaré. */
export function jourLocal(now = new Date(), tz = NIGHT_TZ) {
  try {
    const nom = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(now)
    const idx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(nom)
    if (idx >= 0) return idx
  } catch { /* fuseau inconnu : repli ci-dessous */ }
  return now.getDay()
}

/**
 * Sommes-nous dans la nuit qui PRÉCÈDE le jour dit (0 = dimanche) ?
 *
 * Une nuit chevauche deux jours : « la nuit du samedi au dimanche » commence le
 * samedi à 22 h et finit le dimanche à 7 h. On accepte donc les deux versants.
 */
export function estNuitDe(jourCible, now = new Date(), { debut = NIGHT_START, fin = NIGHT_END, tz = NIGHT_TZ } = {}) {
  if (!inNightWindow(now, { debut, fin, tz })) return false
  const h = heureLocale(now, tz)
  const j = jourLocal(now, tz)
  if (debut === fin) return j === jourCible // fenêtre neutralisée : le jour suffit
  if (debut < fin) return j === jourCible // fenêtre dans la journée, pas de chevauchement
  // Fenêtre à cheval sur minuit : versant du soir (veille) ou du matin (jour dit).
  return h >= debut ? j === (jourCible + 6) % 7 : j === jourCible
}

const clampJour = (v, dflt) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n <= 6 ? Math.floor(n) : dflt
}

/** Jour visé par le chantier hebdomadaire — 0 = dimanche (nuit du samedi). */
export const RECOUP_JOUR = clampJour(process.env.SIRAL_ATTACHE_RECOUP_JOUR, 0)
/** Automatisme du chantier — « 0 » le coupe (déclenchement manuel seulement). */
export const RECOUP_AUTO = String(process.env.SIRAL_ATTACHE_RECOUP_AUTO ?? '1') !== '0'

/** Intervalle minimal entre deux passages automatiques (5 jours). Empêche un
 *  second départ dans la même nuit, ou le lendemain d'un redémarrage. */
export const RECOUP_INTERVALLE_MIN_MS = 5 * 24 * 3600 * 1000

/**
 * Le chantier de recoupements doit-il partir tout seul ?
 * @param {object} o
 * @param {Date}   [o.now]        instant de référence
 * @param {string} [o.dernierAt]  ISO du dernier passage réussi
 * @param {number} [o.jour]       jour visé (0 = dimanche)
 * @param {boolean} [o.auto]      automatisme activé
 * @returns {{ok:boolean, raison:string}}
 */
export function feuRecoupements({ now = new Date(), dernierAt = null, jour = RECOUP_JOUR, auto = RECOUP_AUTO, tz = NIGHT_TZ } = {}) {
  if (!auto) return { ok: false, raison: 'automatisme désactivé' }
  if (!estNuitDe(jour, now, { tz })) return { ok: false, raison: 'hors de la nuit hebdomadaire' }
  if (dernierAt) {
    const ecoule = now.getTime() - Date.parse(dernierAt)
    if (Number.isFinite(ecoule) && ecoule < RECOUP_INTERVALLE_MIN_MS) {
      return { ok: false, raison: 'déjà passé cette semaine' }
    }
  }
  return { ok: true, raison: 'nuit hebdomadaire' }
}
