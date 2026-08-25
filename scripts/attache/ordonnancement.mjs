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
  if (force) return { ok: true }
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
  return { ok: true, front: g.level && g.level !== 'ok' ? 1 : undefined }
}
