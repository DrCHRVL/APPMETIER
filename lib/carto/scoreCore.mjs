/**
 * SIRAL — cartographie : SCORE D'IMPORTANCE des personnes.
 *
 * SOURCE UNIQUE de la formule qui pèse une personne sur la carte :
 *   score = (dossiers, transversalité, chefs, gravité des infractions)
 *         × facteur temporel (malus d'ancienneté × bonus de continuité)
 *         + contamination latente (poids reçu de l'entourage)
 * Les bonus manuels et les points de rôle (chef/lieutenant) s'ajoutent APRÈS,
 * chez l'appelant — un arbitrage humain ne se fait pas rogner par l'ancienneté.
 *
 * Partagée par :
 *  - la cartographie de l'application (utils/mindmapGraph.ts, qui importe ces
 *    fonctions et ne fait qu'y ajouter le typage) ;
 *  - le service attaché (scripts/attache/cartoGraphe.mjs), pour que l'IA
 *    raisonne sur LES MÊMES poids que l'écran — pas sur une copie qui dérive.
 *
 * Module PUR : aucune dépendance, aucun accès au navigateur. Même motif que
 * lib/stats/*.mjs et lib/recoupements/*.mjs.
 */

/** Bonus de points FIXE apporté par chaque rôle coché (panneau latéral),
 *  ajouté après la formule et le facteur temporel — comme le bonus manuel. */
export const MEC_ROLE_POINTS = {
  lieutenant: 15,
  chef_reseau: 30,
}

/** Valeurs par défaut des pondérations, alignées sur la formule MVP
 *  historique. Ré-exportées avec leur typage par types/cartographieTypes.ts. */
export const DEFAULT_CARTO_WEIGHTS = {
  dossier: 2,
  contentieux: 3,
  chefDefault: 0.3,
  lienRenseignement: 0,
  lienRenseignementInfractionCoef: 0.8,
  lienMecPropagationCoef: 0.3,
  lienMecPropagationHops: 2,
  dossierPropagationCoef: 0.2,
}

/** Valeurs par défaut de la pondération temporelle. Activée d'office : sans
 *  elle, un réseau démantelé il y a dix ans continue de dominer le Top. */
export const DEFAULT_CARTO_TEMPORAL = {
  enabled: true,
  freshYears: 2,
  staleYears: 10,
  dormantMultiplier: 0.5,
  continuityBonus: 0.3,
  continuityYears: 4,
}

// Amplitude maximale (en années) retenue pour un seul dossier. Garde-fou
// contre une date aberrante ("1998" saisi pour 2018) qui gonflerait
// artificiellement le bonus de continuité.
const MAX_DOSSIER_SPAN_YEARS = 25
// Bornes de plausibilité d'une année judiciaire.
const MIN_PLAUSIBLE_YEAR = 1950

/** Année d'une date ISO (ou d'un texte contenant une année). undefined si
 *  rien d'exploitable ou si l'année sort des bornes de plausibilité. */
export function yearOfDate(value) {
  if (!value) return undefined
  const parsed = Date.parse(value)
  let year
  if (!Number.isNaN(parsed)) {
    year = new Date(parsed).getFullYear()
  } else {
    // Formats non ISO ("31/12/2019", "décembre 2019") : on récupère la
    // première année à 4 chiffres.
    const m = /(19|20|21)\d{2}/.exec(value)
    if (!m) return undefined
    year = parseInt(m[0], 10)
  }
  if (!Number.isFinite(year) || year < MIN_PLAUSIBLE_YEAR || year > 2200) return undefined
  return year
}

/** Intervalle d'années [start..end] borné, sous forme de liste. */
function yearRange(start, end) {
  const from = Math.min(start, end)
  const to = Math.max(start, end)
  const clampedFrom = Math.max(from, to - MAX_DOSSIER_SPAN_YEARS)
  const out = []
  for (let y = clampedFrom; y <= to; y++) out.push(y)
  return out
}

/**
 * Années d'ACTIVITÉ d'une enquête, tirées des seules dates judiciaires (début
 * d'enquête, opérations d'interpellation, audience) : `dateMiseAJour` est
 * volontairement exclue, car une simple correction de saisie ferait passer un
 * dossier de 2014 pour une affaire de cette année. À défaut de toute date
 * judiciaire, on retombe sur la date de création.
 */
export function enqueteActivityYears(enquete, nowYear) {
  const marks = []
  const push = (v) => {
    const y = yearOfDate(v)
    if (y !== undefined) marks.push(y)
  }
  push(enquete.dateDebut)
  push(enquete.dateOP)
  for (const phase of enquete.opPhases || []) {
    push(phase.dateDebut)
    push(phase.dateFin)
  }
  push(enquete.dateAudience)
  if (marks.length === 0) push(enquete.dateCreation)
  if (marks.length === 0) return []
  // Une audience programmée l'an prochain ne rend pas le dossier « futur » :
  // on borne au millésime courant.
  const end = Math.min(nowYear, Math.max(...marks))
  const start = Math.min(Math.min(...marks), end)
  return yearRange(start, end)
}

// Séparateurs qui expriment une PÉRIODE entre deux millésimes ("2018-2020",
// "2016 à 2019", "de 2015 au 2017").
const RANGE_SEPARATOR = /^[\s,]*(?:-|–|—|\/|à|a|au|jusqu['’]?\s*à|>)[\s,]*$/i

/**
 * Extrait les années d'un champ « date approximative » saisi librement sur un
 * dossier manuel : "2018-2020", "2019 jugé", "2015 à 2017, appel 2018"…
 * Les millésimes séparés par un tiret (ou « à ») sont développés en période.
 */
export function parseApproxYears(text, nowYear) {
  if (!text) return []
  const re = /(19|20|21)\d{2}/g
  const found = []
  let m
  while ((m = re.exec(text)) !== null) {
    found.push({ year: parseInt(m[0], 10), start: m.index, end: m.index + m[0].length })
  }
  if (found.length === 0) return []
  const years = new Set()
  for (let i = 0; i < found.length; i++) {
    const cur = found[i]
    if (cur.year >= MIN_PLAUSIBLE_YEAR) years.add(Math.min(cur.year, nowYear))
    const next = found[i + 1]
    if (!next) continue
    const between = text.slice(cur.end, next.start)
    if (next.year > cur.year && RANGE_SEPARATOR.test(between)) {
      for (const y of yearRange(cur.year, Math.min(next.year, nowYear))) {
        if (y >= MIN_PLAUSIBLE_YEAR) years.add(y)
      }
    }
  }
  return [...years].sort((a, b) => a - b)
}

/**
 * Facteur temporel appliqué au score brut :
 *
 *   facteur = malus_ancienneté × bonus_continuité
 *
 * `malus_ancienneté` vaut 1 tant que la dernière implication remonte à moins
 * de `freshYears`, descend linéairement jusqu'à `dormantMultiplier` à
 * `staleYears`, et y reste au-delà. `bonus_continuité` monte de 1 à
 * 1 + `continuityBonus` selon le nombre d'années d'activité distinctes.
 *
 * Un MEC sans aucune année connue reste à 1 : on ne pénalise pas une absence
 * d'information (fiche manuelle sans date, dossier sans millésime).
 */
export function computeTemporalFactor(years, temporal, nowYear) {
  if (!temporal.enabled || years.length === 0) return 1

  const fresh = Math.max(0, temporal.freshYears)
  const stale = Math.max(fresh + 1, temporal.staleYears)
  const dormant = Math.max(0, temporal.dormantMultiplier)
  const age = Math.max(0, nowYear - years[years.length - 1])

  let recency
  if (age <= fresh) recency = 1
  else if (age >= stale) recency = dormant
  else recency = 1 + ((age - fresh) / (stale - fresh)) * (dormant - 1)

  const plateau = Math.max(1, temporal.continuityYears)
  const ratio = plateau <= 1 ? 1 : Math.min(1, (years.length - 1) / (plateau - 1))
  const continuity = 1 + Math.max(0, temporal.continuityBonus) * ratio

  return recency * continuity
}

/**
 * Poids DIRECT d'un MEC : ce qu'il tire de ses propres dossiers (dossiers,
 * transversalité, chefs, bonus d'infraction), hors points de liens et hors
 * bonus manuel.
 *
 * C'est la seule quantité qui se propage aux voisins (cf.
 * propagateLatentScore). On en exclut volontairement :
 *  - les points « par lien renseignement » — sinon deux personnes reliées se
 *    renverraient mutuellement des points tirés de leur seul lien ;
 *  - le bonus manuel — un arbitrage humain vaut pour la personne visée, il
 *    n'a pas à déteindre sur son entourage ;
 *  - la contamination déjà reçue — la diffusion part toujours des poids
 *    directs, ce qui la borne et la rend indépendante de l'ordre de calcul.
 */
export function computeDirectWeight(mec, weights) {
  // Le nombre de MISES EN EXAMEN ne pèse plus : on s'en tient à la mise en
  // cause au sens large. Le compteur reste tenu et affiché, à titre indicatif.
  return (
    mec.dossierIds.length * weights.dossier +
    mec.contentieuxIds.length * weights.contentieux +
    mec.nbChefs * weights.chefDefault +
    mec.infractionWeight
  )
}

export function computeRawScore(mec, weights) {
  const raw =
    computeDirectWeight(mec, weights) +
    mec.nbLiensRenseignement * weights.lienRenseignement
  // La contamination latente s'ajoute APRÈS le facteur temporel : elle est
  // déjà pondérée à la source (par l'ancienneté du voisin qui l'émet), la
  // repasser par l'ancienneté du receveur la pénaliserait deux fois — et un
  // individu sans dossier n'a de toute façon aucune date à lui.
  return raw * mec.temporalFactor + mec.propagatedWeight
}

/**
 * CONTAMINATION LATENTE — diffuse le poids des MEC dans leur entourage.
 *
 * Motif : peser quelque chose parce qu'on gravite autour d'une figure lourde,
 * quelle que soit la façon dont ce voisinage est établi. Deux routes, chacune
 * avec son coefficient de transmission :
 *
 *  1. LIEN DE RENSEIGNEMENT personne ↔ personne (`lienMecPropagationCoef`) —
 *     le voisinage tracé à la main, quand la procédure n'a pas permis mieux.
 *
 *  2. CO-PRÉSENCE DANS UN DOSSIER (`dossierPropagationCoef`) — le dossier
 *     relaie vers chacun de ses membres le poids du membre le PLUS LOURD des
 *     autres (le chef reçoit donc celui de son meilleur second). Sont membres
 *     aussi bien les mis en cause que les personnes rattachées au dossier par
 *     un lien de renseignement.
 *
 * Pourquoi le plus lourd, et non la somme des autres membres : sommer ferait
 * du score une mesure de la TAILLE des dossiers (trente comparses valant plus
 * qu'un chef), et exploserait sur les grosses procédures. Ce qui compte est
 * la pointure avec qui on figure, pas le nombre de gens autour.
 *
 * Mécanique commune : on remonte, depuis chaque MEC, les chemins d'entourage
 * jusqu'à `hops` sauts ; un voisin atteint à plusieurs chemins ne compte
 * qu'une fois, au MEILLEUR chemin (produit des coefficients le plus fort).
 * La quantité émise est toujours le poids DIRECT du voisin (jamais ce qu'il a
 * lui-même reçu) : la diffusion ne s'auto-amplifie pas, ne boucle pas, et ne
 * dépend pas de l'ordre de calcul.
 */
export function propagateLatentScore(mecById, voisinsByMec, mecsByDossier, weights) {
  const coefLien = weights.lienMecPropagationCoef ?? DEFAULT_CARTO_WEIGHTS.lienMecPropagationCoef
  const coefDossier = weights.dossierPropagationCoef ?? DEFAULT_CARTO_WEIGHTS.dossierPropagationCoef
  const hops = Math.floor(
    weights.lienMecPropagationHops ?? DEFAULT_CARTO_WEIGHTS.lienMecPropagationHops,
  )
  for (const [id, voisins] of voisinsByMec) {
    const mec = mecById.get(id)
    if (mec) mec.nbMecVoisins = voisins.size
  }
  if (hops < 1 || (!(coefLien > 0) && !(coefDossier > 0))) return

  // Poids émis par chaque MEC, figé AVANT toute diffusion.
  const emis = new Map()
  for (const [id, mec] of mecById) {
    const direct = computeDirectWeight(mec, weights) * mec.temporalFactor
    if (direct > 0) emis.set(id, direct)
  }
  if (emis.size === 0) return

  // Arêtes d'entourage, orientées « qui reçoit ← qui émet ». Un même émetteur
  // peut apparaître par les deux routes (co-dossier ET lien) ou par plusieurs
  // dossiers : la relaxation ne retiendra que son meilleur coefficient, il
  // n'est donc jamais compté deux fois.
  const sourcesByMec = new Map()
  const addSource = (to, source) => {
    const list = sourcesByMec.get(to)
    if (list) list.push(source)
    else sourcesByMec.set(to, [source])
  }

  if (coefLien > 0) {
    for (const [id, voisins] of voisinsByMec) {
      for (const v of voisins) addSource(id, { from: v, coef: coefLien, via: 'lien' })
    }
  }

  if (coefDossier > 0) {
    for (const membres of mecsByDossier.values()) {
      if (membres.size < 2) continue
      // Les deux plus lourds du dossier suffisent : tout le monde reçoit du
      // premier, sauf le premier lui-même qui reçoit du second.
      let premier
      let second
      for (const m of membres) {
        const poids = emis.get(m) ?? 0
        if (poids <= 0) continue
        if (premier === undefined || poids > (emis.get(premier) ?? 0)) {
          second = premier
          premier = m
        } else if (second === undefined || poids > (emis.get(second) ?? 0)) {
          second = m
        }
      }
      if (premier === undefined) continue
      for (const m of membres) {
        const from = m === premier ? second : premier
        if (from === undefined) continue
        addSource(m, { from, coef: coefDossier, via: 'dossier' })
      }
    }
  }
  if (sourcesByMec.size === 0) return

  for (const [id, cible] of mecById) {
    if (!sourcesByMec.has(id)) continue

    // Relaxation par couches : `facteur` retient, pour chaque émetteur atteint,
    // le meilleur produit de coefficients trouvé jusqu'ici (les coefficients
    // valant ≤ 1, un chemin plus long ne peut que faire moins bien).
    const facteur = new Map()
    let frontiere = [[id, 1]]
    for (let d = 0; d < hops && frontiere.length > 0; d++) {
      const suivante = []
      for (const [noeud, acquis] of frontiere) {
        for (const src of sourcesByMec.get(noeud) ?? []) {
          if (src.from === id) continue
          const combine = acquis * src.coef
          const connu = facteur.get(src.from)
          if (connu && connu.coef >= combine) continue
          facteur.set(src.from, { coef: combine, via: src.via })
          suivante.push([src.from, combine])
        }
      }
      frontiere = suivante
    }

    let recu = 0
    const contributeurs = []
    for (const [from, { coef, via }] of facteur) {
      const points = (emis.get(from) ?? 0) * coef
      if (points <= 0) continue
      recu += points
      contributeurs.push({
        mecId: from,
        displayName: mecById.get(from)?.displayName ?? from,
        points,
        via,
      })
    }
    cible.propagatedWeight = recu
    if (contributeurs.length > 0) {
      cible.propagationTop = contributeurs.sort((a, b) => b.points - a.points).slice(0, 3)
    }
  }
}
