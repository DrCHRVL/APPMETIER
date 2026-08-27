/**
 * SIRAL — Attaché de justice · ORDONNANCEMENT des chantiers.
 *
 * Quand un chantier d'analyse profonde a-t-il le droit de tourner ? Deux
 * questions seulement — l'heure et le forfait — mais elles ont laissé passer
 * une nuit entière sans qu'une seule pièce soit lue, et sans que le magistrat
 * dispose du moindre moyen de passer outre. D'où ce module à part, sans état
 * ni effet de bord : la règle se lit, se raconte à l'écran et se teste.
 *
 * 1. LA NUIT EST CELLE DU MAGISTRAT, pas celle du conteneur. Docker tourne en
 *    UTC par défaut : « 22 h → 7 h » y valait 0 h → 9 h à Amiens en été — la
 *    fenêtre mordait sur la matinée de travail et s'ouvrait deux heures trop
 *    tard. On lit donc l'heure dans un fuseau DÉCLARÉ.
 *
 * 2. LES DEUX PLAFONDS DU FORFAIT N'ONT PAS LA MÊME VALEUR DE PREUVE.
 *    - La fenêtre glissante de 5 h se recoupe avec ce que l'abonnement
 *      affiche : elle garde son pouvoir d'ARRÊT.
 *    - Le plafond HEBDOMADAIRE est une ESTIMATION EN JETONS d'un forfait qui
 *      n'en publie aucun. Il a dérivé : 167 M jetons comptés contre un repère
 *      deviné à 150 M, soit « 112 % — forfait saturé », quand l'abonnement
 *      lui-même annonçait 9 % de sa limite hebdomadaire. Sur cette fausse
 *      saturation, un dossier de 1074 pièces validé la veille est resté
 *      bloqué toute la nuit. Un chiffre indicatif n'annule pas des nuits de
 *      travail réel : le repère hebdomadaire ne STOPPE plus un chantier, il le
 *      RESSERRE (un lot à la fois au lieu d'une vague). Le forfait reste
 *      protégé, le dépouillement reste possible.
 *
 * 3. LE MAGISTRAT GARDE LE DERNIER MOT. « Forcer maintenant » pose une
 *    dérogation horodatée qui lève la nuit ET les plafonds — le temps d'une
 *    fenêtre courte, après quoi le régime normal reprend seul.
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
  return now.getHours() // on ne bloque jamais un chantier sur une question de fuseau
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

/**
 * Le feu d'un chantier. `gov` est le verdict du gouverneur de consommation
 * (budget.mjs), `force` dit si la dérogation du magistrat court encore.
 * @returns {{ok:boolean, attente?:'nuit'|'forfait', detail?:string|null, front?:number}}
 */
export function feuChantier(ch, { gov, force = false, nuit = inNightWindow() } = {}) {
  // HORS DE LA NUIT, LE MAGISTRAT EST À SON POSTE. Le service partage son hôte
  // avec l'application : une vague de lots en pleine journée fait ramer SIRAL,
  // et un dépouillement plus lent vaut toujours mieux qu'une app inutilisable.
  // Un lot à la fois donc — y compris quand le magistrat force : forcer veut
  // dire « commence maintenant », pas « prends toute la machine ».
  const frontDuMoment = nuit ? undefined : 1
  if (force) return { ok: true, front: frontDuMoment }
  const g = gov || {}
  if (Number(g.cap5h) > 0 && Number(g.pct5h) >= 1) {
    return { ok: false, attente: 'forfait', detail: `fenêtre de 5 h à ${Math.round(g.pct5h * 100)} % du repère` }
  }
  if (ch?.nuitSeulement && !nuit) {
    const p = prochaineNuit()
    return { ok: false, attente: 'nuit', detail: p ? `reprise vers ${p.heure} h (${p.fuseau})` : null }
  }
  // Forfait tendu (fenêtre de 5 h qui monte, ou repère hebdomadaire dépassé) :
  // on avance, mais un lot à la fois.
  return { ok: true, front: g.level && g.level !== 'ok' ? 1 : frontDuMoment }
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
