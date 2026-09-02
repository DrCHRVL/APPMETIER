/**
 * SIRAL — Attaché de justice · GRAPHE DE LA CARTOGRAPHIE, CÔTÉ SERVEUR.
 *
 * Jusqu'ici, le vrai calcul de la carte (score d'importance, topologie)
 * vivait dans le navigateur : l'IA ne recevait que des comptages et devait
 * « interpréter la centralité » sur des listes. Ce module construit le même
 * graphe côté service — mêmes identités (nomsCore), même formule de score
 * (lib/carto/scoreCore.mjs), mêmes pondérations (coffre partagé
 * `cartographie-config`) — et y ajoute les mesures que l'écran n'a pas :
 *
 *  - IMPORTANCE par personne, décomposée (dossiers, chefs, gravité,
 *    facteur temporel, entourage, arbitrages manuels) — explicable ;
 *  - INTERMÉDIARITÉ (Brandes) : les courtiers par qui passent les chemins ;
 *  - COMMUNAUTÉS (Louvain) : les cellules, calculées et non plus devinées ;
 *  - PLUS COURTS CHEMINS entre deux personnes, chaque saut sourcé (dossier
 *    partagé ou lien de renseignement) — pour répondre à « qu'est-ce qui
 *    relie X à Y ? » avec des références vérifiables.
 *
 * Écarts assumés avec la carte à l'écran (documentés, pas cachés) :
 *  - les personnes uniquement CONDAMNÉES à l'audience ne sont pas projetées ;
 *  - les anciens poids par « tag d'infraction » (legacy) ne comptent pas —
 *    seuls NATINF et catégories (l'axe recommandé) pèsent ;
 *  - les mises en examen pèsent via le module instruction (dossier
 *    d'instruction membre du graphe), pas via leur enquête d'origine.
 * Un rapprochement reste un SIGNALEMENT : l'IA propose, le magistrat trace.
 */
import { attacheContentieux, attacheTj, readVault } from './store.mjs'
import { decryptJson } from './crypto.mjs'
import { loadContentieux } from './dossier.mjs'
import { instructionCorpus } from './instru.mjs'
import { loadOverlay, mecCanonId } from './carto.mjs'
import { natinfEntry } from './natinf.mjs'
import { categorieNatinf } from './nataff.mjs'
import {
  DEFAULT_CARTO_TEMPORAL,
  DEFAULT_CARTO_WEIGHTS,
  MEC_ROLE_POINTS,
  computeRawScore,
  computeTemporalFactor,
  enqueteActivityYears,
  parseApproxYears,
  propagateLatentScore,
} from '../../lib/carto/scoreCore.mjs'
import {
  centraliteIntermediaire,
  communautesLouvain,
  plusCourtsChemins,
} from '../../lib/carto/grapheCore.mjs'
import { sameMecPerson } from '../../lib/recoupements/nomsCore.mjs'

// ── Configuration partagée du score ──────────────────────────────────────
// La même que l'écran Paramètres > Module Cartographie : le coffre
// `cartographie-config` (clé globale). À défaut (jamais réglée, coffre
// illisible), les défauts de scoreCore — les mêmes que ceux de l'app.

export function chargerConfigCarto(keys) {
  const defauts = {
    weights: { ...DEFAULT_CARTO_WEIGHTS },
    temporal: { ...DEFAULT_CARTO_TEMPORAL },
    natinfWeights: {},
    categoryWeights: {},
  }
  const envelope = readVault(attacheTj(), 'cartographie-config')
  if (!envelope) return { ...defauts, source: 'défauts (aucune configuration partagée)' }
  try {
    const brut = decryptJson(keys.global, envelope) || {}
    const weights = { ...DEFAULT_CARTO_WEIGHTS }
    for (const k of Object.keys(DEFAULT_CARTO_WEIGHTS)) {
      const v = (brut.weights || {})[k]
      if (typeof v === 'number' && Number.isFinite(v)) weights[k] = v
    }
    return {
      weights,
      temporal: { ...DEFAULT_CARTO_TEMPORAL, ...(brut.temporal || {}) },
      natinfWeights: { ...(brut.natinfWeights || {}) },
      categoryWeights: { ...(brut.categoryWeights || {}) },
      source: `configuration partagée de l'app${brut.updatedAt ? ` (modifiée le ${String(brut.updatedAt).slice(0, 10)})` : ''}`,
    }
  } catch {
    return { ...defauts, source: 'défauts (coffre de configuration illisible)' }
  }
}

/** Poids d'un code NATINF : l'affinage NATINF prime, sinon le poids de la
 *  catégorie (Mémento parquet) du code — exactement la règle de l'écran. */
function poidsNatinf(code, cfg, cacheCategorie) {
  if (!code) return 0
  const exact = cfg.natinfWeights[code]
  if (exact !== undefined) return exact
  if (Object.keys(cfg.categoryWeights).length === 0) return 0
  let cat = cacheCategorie.get(code)
  if (cat === undefined) {
    try { cat = categorieNatinf(natinfEntry(code))?.code || null } catch { cat = null }
    cacheCategorie.set(code, cat)
  }
  return (cat && cfg.categoryWeights[cat]) || 0
}

// ── Construction du graphe ───────────────────────────────────────────────

function nouveauNoeud(id, nom) {
  return {
    id,
    displayName: nom,
    variantes: new Map(), // nom → fréquence, pour choisir l'affichage
    dossierIds: [],
    contentieuxIds: [],
    nbChefs: 0,
    nbChefsViaLien: 0,
    nbLiensRenseignement: 0,
    infractionWeight: 0,
    years: new Set(),
    temporalFactor: 1,
    propagatedWeight: 0,
    nbMecVoisins: 0,
    manualBonus: 0,
    role: undefined,
    rawScore: 0,
  }
}

/**
 * Le graphe complet : enquêtes du contentieux (+ archivées sur demande),
 * dossiers d'instruction, personnes et dossiers ex nihilo de la carte,
 * liens de renseignement — avec le score de chaque personne.
 */
export function construireGraphe(keys, { includeArchived = false } = {}) {
  const cfg = chargerConfigCarto(keys)
  const cacheCategorie = new Map()
  const nowYear = new Date().getFullYear()

  const personnes = new Map() // canon → nœud
  const dossiers = new Map() // dossierId → { ref, type, membres:Set, years, chefs, bonus }
  const voisins = new Map() // canon → Set(canon) — liens personne ↔ personne
  const liensPP = [] // { a, b, label } pour habiller les chemins

  const toucher = (nomBrut) => {
    const nom = String(nomBrut || '').trim()
    const canon = mecCanonId(nom)
    if (!canon) return null
    let p = personnes.get(canon)
    if (!p) { p = nouveauNoeud(canon, nom); personnes.set(canon, p) }
    p.variantes.set(nom, (p.variantes.get(nom) || 0) + 1)
    return p
  }
  const rattacher = (p, dossierId, contentieuxId) => {
    if (!p.dossierIds.includes(dossierId)) p.dossierIds.push(dossierId)
    if (contentieuxId && !p.contentieuxIds.includes(contentieuxId)) p.contentieuxIds.push(contentieuxId)
    dossiers.get(dossierId).membres.add(p.id)
  }

  // 1. Enquêtes réelles du contentieux confié.
  const { data } = loadContentieux(keys)
  const contentieuxId = attacheContentieux()
  for (const e of data.enquetes || []) {
    if (!includeArchived && e.statut === 'archive') continue
    const dossierId = `enquete:${e.numero}`
    const years = enqueteActivityYears(e, nowYear)
    let chefs = 0
    let bonus = 0
    const codes = [...new Set((e.infractionNatinfCodes || []).filter(Boolean))]
    for (const code of codes) { chefs += 1; bonus += poidsNatinf(code, cfg, cacheCategorie) }
    dossiers.set(dossierId, {
      ref: { numero: String(e.numero), type: 'enquete', statut: e.statut },
      membres: new Set(), years, chefs, bonus,
    })
    for (const m of e.misEnCause || []) {
      const p = toucher(m.nom)
      if (!p) continue
      rattacher(p, dossierId, contentieuxId)
      p.nbChefs += chefs
      p.infractionWeight += bonus
      for (const y of years) p.years.add(y)
    }
  }

  // 2. Dossiers d'instruction (mis en examen déclarés).
  try {
    for (const d of instructionCorpus(keys)) {
      const dossierId = `instruction:${d.numero}`
      dossiers.set(dossierId, {
        ref: { numero: String(d.numero), type: 'instruction' },
        membres: new Set(), years: [], chefs: 0, bonus: 0,
      })
      for (const nom of d.misEnCause || []) {
        const p = toucher(nom)
        if (p) rattacher(p, dossierId, contentieuxId)
      }
    }
  } catch { /* module instruction absent */ }

  // 3. Carte : personnes ex nihilo, dossiers ex nihilo, liens, arbitrages.
  const ov = loadOverlay(keys)
  const nomExNihilo = new Map() // id brut → nom affiché
  for (const m of ov?.mecsExNihilo || []) {
    const nom = m.displayName || m.id
    nomExNihilo.set(m.id, nom)
    toucher(nom)
  }
  const dossierExNihiloParCle = new Map() // canon(label) → dossierId
  for (const d of ov?.dossiersExNihilo || []) {
    if (!d.label) continue
    const dossierId = `exnihilo:${d.id || d.label}`
    const years = parseApproxYears(d.dateApprox, nowYear)
    let chefs = 0
    let bonus = 0
    for (const code of [...new Set((d.natinfCodes || []).filter(Boolean))]) {
      chefs += 1; bonus += poidsNatinf(code, cfg, cacheCategorie)
    }
    dossiers.set(dossierId, {
      ref: { numero: d.label, type: 'exnihilo' },
      membres: new Set(), years, chefs, bonus,
    })
    dossierExNihiloParCle.set(mecCanonId(d.label), dossierId)
    for (const id of d.mecIds || []) {
      const p = toucher(nomExNihilo.get(id) || id)
      if (!p) continue
      rattacher(p, dossierId, contentieuxId)
      p.nbChefs += chefs
      p.infractionWeight += bonus
      for (const y of years) p.years.add(y)
    }
  }

  // Liens de renseignement : personne ↔ personne (voisinage) ou
  // personne ↔ dossier ex nihilo (implication au sens large).
  const coefInfraction = cfg.weights.lienRenseignementInfractionCoef
    ?? DEFAULT_CARTO_WEIGHTS.lienRenseignementInfractionCoef
  for (const l of ov?.liensRenseignement || []) {
    const bouts = [l.source, l.target].map((x) => String(x || ''))
    const commeDossier = bouts.map((x) => dossierExNihiloParCle.get(mecCanonId(x)))
    if (commeDossier[0] || commeDossier[1]) {
      // personne ↔ dossier : la personne rejoint le dossier (entourage,
      // années, chefs pondérés par le coefficient de lien).
      const iDossier = commeDossier[0] ? 0 : 1
      const dossierId = commeDossier[iDossier]
      const d = dossiers.get(dossierId)
      const p = toucher(nomExNihilo.get(bouts[1 - iDossier]) || bouts[1 - iDossier])
      if (!p || !d) continue
      p.nbLiensRenseignement += 1
      p.nbChefs += d.chefs
      p.nbChefsViaLien += d.chefs
      p.infractionWeight += d.bonus * coefInfraction
      d.membres.add(p.id)
      for (const y of d.years) p.years.add(y)
      continue
    }
    const pa = toucher(nomExNihilo.get(bouts[0]) || bouts[0])
    const pb = toucher(nomExNihilo.get(bouts[1]) || bouts[1])
    if (!pa || !pb || pa.id === pb.id) continue
    pa.nbLiensRenseignement += 1
    pb.nbLiensRenseignement += 1
    if (!voisins.has(pa.id)) voisins.set(pa.id, new Set())
    if (!voisins.has(pb.id)) voisins.set(pb.id, new Set())
    voisins.get(pa.id).add(pb.id)
    voisins.get(pb.id).add(pa.id)
    liensPP.push({ a: pa.id, b: pb.id, label: l.label || 'lien de renseignement' })
  }

  // Arbitrages du magistrat : bonus manuels et rôles (le plus récent gagne).
  const boostParPersonne = new Map()
  for (const b of ov?.mecScoreBoosts || []) {
    const canon = mecCanonId(b.mecId)
    if (!canon || !personnes.has(canon)) continue
    const connu = boostParPersonne.get(canon)
    if (connu && (connu.updatedAt || 0) > (b.updatedAt || 0)) continue
    boostParPersonne.set(canon, b)
  }

  // 4. Assemblage du score — même ordre que l'app : facteur temporel, puis
  // contamination latente, puis bonus manuels et points de rôle.
  const membresParDossier = new Map()
  for (const [dossierId, d] of dossiers) membresParDossier.set(dossierId, d.membres)
  for (const p of personnes.values()) {
    p.activityYears = [...p.years].sort((a, b) => a - b)
    p.temporalFactor = computeTemporalFactor(p.activityYears, cfg.temporal, nowYear)
    let meilleur = p.displayName
    let compte = 0
    for (const [nom, n] of p.variantes) if (n > compte) { compte = n; meilleur = nom }
    p.displayName = meilleur
  }
  propagateLatentScore(personnes, voisins, membresParDossier, cfg.weights)
  for (const p of personnes.values()) {
    const boost = boostParPersonne.get(p.id)
    p.manualBonus = boost?.bonus ?? 0
    p.role = boost?.role === 'lieutenant' || boost?.role === 'chef_reseau' ? boost.role : undefined
    const rolePoints = p.role ? MEC_ROLE_POINTS[p.role] : 0
    p.rawScore = Math.max(0, computeRawScore(p, cfg.weights) + p.manualBonus + rolePoints)
  }

  // Arêtes personne ↔ personne pour les algorithmes : co-présence en dossier
  // (poids = nombre de dossiers partagés) + liens de renseignement.
  const coDossier = new Map() // 'a|b' trié → { poids, refs:[] }
  for (const [, d] of dossiers) {
    const membres = [...d.membres].sort()
    for (let i = 0; i < membres.length; i++) {
      for (let j = i + 1; j < membres.length; j++) {
        const cle = `${membres[i]}|${membres[j]}`
        let entree = coDossier.get(cle)
        if (!entree) { entree = { poids: 0, refs: [] }; coDossier.set(cle, entree) }
        entree.poids += 1
        if (entree.refs.length < 8) entree.refs.push(d.ref)
      }
    }
  }
  const aretes = []
  for (const [cle, { poids }] of coDossier) {
    const [a, b] = cle.split('|')
    aretes.push({ a, b, poids })
  }
  for (const { a, b } of liensPP) aretes.push({ a, b, poids: 1 })

  return { personnes, dossiers, aretes, coDossier, liensPP, cfg }
}

// ── Restitutions pour l'IA ───────────────────────────────────────────────

const arrondi = (v) => Math.round(v * 10) / 10

function dossiersDe(p, graphe, max = 8) {
  return p.dossierIds.slice(0, max).map((id) => {
    const d = graphe.dossiers.get(id)
    return d ? `${d.ref.numero}${d.ref.type !== 'enquete' ? ` (${d.ref.type})` : ''}` : id
  })
}

/**
 * L'analyse avancée servie à `carto_analyser` : importance décomposée,
 * intermédiaires (Brandes), communautés (Louvain), paramètres appliqués.
 */
export function analyseAvancee(keys, { includeArchived = false } = {}) {
  const graphe = construireGraphe(keys, { includeArchived })
  const ids = [...graphe.personnes.keys()].sort()

  const importance = [...graphe.personnes.values()]
    .filter((p) => p.rawScore > 0)
    .sort((a, b) => b.rawScore - a.rawScore)
    .slice(0, 20)
    .map((p) => ({
      nom: p.displayName,
      score: arrondi(p.rawScore),
      composantes: {
        dossiers: p.dossierIds.length,
        chefs: p.nbChefs,
        poidsInfractions: arrondi(p.infractionWeight),
        liensRenseignement: p.nbLiensRenseignement,
        facteurTemporel: arrondi(p.temporalFactor * 100) / 100,
        recuDeLEntourage: arrondi(p.propagatedWeight),
        bonusManuel: p.manualBonus || undefined,
        role: p.role,
      },
      dossiers: dossiersDe(p, graphe),
    }))

  // Brandes est en O(V·E) : au-delà de quelques milliers de personnes, on
  // préfère répondre vite et le dire, plutôt que bloquer l'outil.
  const PLAFOND_INTERMEDIARITE = 3000
  const centralite = ids.length <= PLAFOND_INTERMEDIARITE
    ? centraliteIntermediaire(ids, graphe.aretes)
    : new Map()
  const intermediaires = ids
    .map((id) => ({ id, valeur: centralite.get(id) || 0 }))
    .filter((x) => x.valeur > 0)
    .sort((a, b) => b.valeur - a.valeur)
    .slice(0, 15)
    .map(({ id, valeur }) => {
      const p = graphe.personnes.get(id)
      return {
        nom: p.displayName,
        intermediarite: arrondi(valeur),
        nbDossiers: p.dossierIds.length,
        nbLiens: p.nbLiensRenseignement,
      }
    })

  const commuParId = communautesLouvain(ids, graphe.aretes)
  const groupes = new Map()
  for (const [id, c] of commuParId) {
    if (!groupes.has(c)) groupes.set(c, [])
    groupes.get(c).push(id)
  }
  const communautes = [...groupes.values()]
    .filter((membres) => membres.length >= 3)
    .sort((a, b) => b.length - a.length)
    .slice(0, 12)
    .map((membres) => {
      const noeuds = membres.map((id) => graphe.personnes.get(id))
      noeuds.sort((a, b) => b.rawScore - a.rawScore)
      const refs = new Set()
      for (const p of noeuds) for (const d of dossiersDe(p, graphe, 4)) refs.add(d)
      return {
        figure: noeuds[0].displayName,
        nbMembres: membres.length,
        membres: noeuds.slice(0, 25).map((p) => p.displayName),
        dossiers: [...refs].slice(0, 10),
      }
    })

  return {
    calculs: {
      parametres: `Score : formule de la carte (lib/carto/scoreCore), ${graphe.cfg.source}.`,
      importance:
        'Top 20 par score BRUT (le même que la taille des nœuds sur la carte, avant normalisation), décomposé — vérifiable composant par composant.',
      intermediaires: ids.length <= PLAFOND_INTERMEDIARITE
        ? 'Centralité d\'intermédiarité (Brandes) : par qui passent les chemins du réseau. Une intermédiarité forte avec PEU de dossiers signale un courtier discret — souvent plus intéressant que les figures visibles.'
        : `Graphe de ${ids.length} personnes : intermédiarité omise (plafond ${PLAFOND_INTERMEDIARITE}) pour répondre vite.`,
      communautes:
        'Communautés (Louvain) sur la co-présence en dossier + liens tracés : les cellules telles que la structure les dessine. À confronter aux camps cochés à la main — un écart est une information.',
    },
    nbPersonnes: graphe.personnes.size,
    nbDossiersGraphe: graphe.dossiers.size,
    importance,
    intermediaires,
    communautes,
  }
}

/** Résout un nom vers un nœud du graphe (canon exact, puis tolérance nomsCore). */
function resoudre(graphe, nom) {
  const canon = mecCanonId(nom)
  if (canon && graphe.personnes.has(canon)) return { p: graphe.personnes.get(canon) }
  const candidats = []
  for (const p of graphe.personnes.values()) {
    if (sameMecPerson(p.displayName, nom, { allowSubset: true })) candidats.push(p)
    if (candidats.length > 6) break
  }
  if (candidats.length === 1) return { p: candidats[0] }
  return { candidats: candidats.map((p) => p.displayName) }
}

/**
 * « Qu'est-ce qui relie X à Y ? » — plus courts chemins entre deux personnes,
 * chaque saut habillé de sa provenance : dossiers partagés, lien tracé.
 */
export function cheminEntre(keys, { de, vers, includeArchived = true } = {}) {
  if (!de || !vers) throw new Error('Deux noms sont requis (de, vers)')
  const graphe = construireGraphe(keys, { includeArchived })
  const rDe = resoudre(graphe, de)
  const rVers = resoudre(graphe, vers)
  const introuvable = []
  if (!rDe.p) introuvable.push({ nom: de, candidats: rDe.candidats })
  if (!rVers.p) introuvable.push({ nom: vers, candidats: rVers.candidats })
  if (introuvable.length > 0) {
    return {
      erreur: 'Personne introuvable ou ambiguë sur le graphe',
      details: introuvable.map((x) =>
        x.candidats?.length
          ? `« ${x.nom} » : plusieurs candidats — ${x.candidats.join(' · ')}`
          : `« ${x.nom} » : aucun mis en cause ni personne de la carte ne correspond`),
    }
  }

  const ids = [...graphe.personnes.keys()]
  const chemins = plusCourtsChemins(ids, graphe.aretes, rDe.p.id, rVers.p.id, { max: 3 })
  if (chemins.length === 0) {
    return {
      relies: false,
      de: rDe.p.displayName,
      vers: rVers.p.displayName,
      explication:
        'Aucun chemin : ces deux personnes n\'appartiennent pas à la même composante du graphe (aucune suite de dossiers partagés ou de liens tracés ne les relie). registre_recouper et la veille des recoupements peuvent révéler un pont par entité (téléphone, adresse, plaque) que le graphe ne porte pas.',
    }
  }

  const lienEntre = (a, b) => graphe.liensPP.find(
    (l) => (l.a === a && l.b === b) || (l.a === b && l.b === a),
  )
  const habiller = (chemin) => chemin.slice(1).map((id, i) => {
    const a = chemin[i]
    const cle = a < id ? `${a}|${id}` : `${id}|${a}`
    const co = graphe.coDossier.get(cle)
    const lien = lienEntre(a, id)
    const via = []
    if (co) via.push(...co.refs.slice(0, 4).map((r) => `dossier ${r.numero}${r.type !== 'enquete' ? ` (${r.type})` : ''}`))
    if (lien) via.push(`lien tracé : ${lien.label}`)
    return {
      de: graphe.personnes.get(a).displayName,
      vers: graphe.personnes.get(id).displayName,
      via,
    }
  })

  return {
    relies: true,
    de: rDe.p.displayName,
    vers: rVers.p.displayName,
    distance: chemins[0].length - 1,
    chemins: chemins.map(habiller),
    note: 'Chaque saut cite sa provenance : vérifier dans les dossiers/pièces avant d\'en tirer une conclusion — un dossier partagé peut être une simple co-citation.',
  }
}
