/**
 * SIRAL — Attaché de justice · étude du corpus d'actes validés.
 *
 * Les documents téléversés dans les zones « Actes » et « DML » des dossiers
 * sont des versions VALIDÉES : actes signés par le magistrat, et ordonnances
 * rendues par les JLD — des juges qui reprennent ou reformulent ses requêtes.
 * C'est la meilleure matière première d'apprentissage qui existe : mieux
 * qu'une correction (qui dit ce qui n'allait pas), un acte validé montre ce
 * qui EST attendu.
 *
 * L'étude est un run périodique qui dépouille ce corpus (délégation aux
 * sous-agents, lecture des copies markdown — économe) et en EXTRAIT DES
 * MODÈLES : des trames préfixées « modele- », gabarits anonymisés par type
 * d'acte, que l'attaché est seul autorisé à créer et à réécrire — les trames
 * du magistrat restent intouchables. Les paires requête ↔ ordonnance JLD
 * livrent en prime les exigences de motivation des juges (mémoire).
 *
 * Déclenchement AUTOMATIQUE : accumulation de nouveaux actes validés depuis
 * la dernière étude, ou cadence de fond — le comptage est déterministe
 * (index de documents en clair, aucun déchiffrement, aucun jeton).
 */
import fs from 'node:fs'
import { attacheTj, tjDataDir, listDocsMeta, readState } from './store.mjs'

/** Zones dont les pièces valent « acte validé » (préfixes des chemins). */
const ZONES_MODELES = ['Actes/', 'DML/']

const bounded = (v, min, max, dflt) => {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n >= min && n <= max ? n : dflt
}
/** Nouveaux actes validés qui déclenchent une étude sans attendre la cadence. */
export const ETUDE_SEUIL = bounded(process.env.SIRAL_ATTACHE_ETUDE_SEUIL, 1, 100, 5)
/** Cadence de fond (jours) — ne tourne que s'il y a AU MOINS un acte nouveau. */
export const ETUDE_JOURS = bounded(process.env.SIRAL_ATTACHE_ETUDE_JOURS, 7, 365, 30)
/** Garde anti-rafale : pas deux tentatives à moins de 24 h. */
const ATTEMPT_COOLDOWN_MS = 24 * 3600 * 1000

/**
 * Compte les actes validés du corpus (zones Actes/DML de tous les dossiers).
 * Déterministe et gratuit : les index `.index.json` sont des métadonnées en
 * clair — ni déchiffrement, ni appel au modèle. Les copies MD/ (miroirs des
 * originaux) ne comptent pas.
 */
export function corpusActesValides() {
  const docsRoot = tjDataDir(attacheTj(), 'docs')
  if (!fs.existsSync(docsRoot)) return { count: 0, dossiers: 0 }
  let count = 0
  let dossiers = 0
  for (const key of fs.readdirSync(docsRoot)) {
    if (key.startsWith('.')) continue
    let n = 0
    try {
      n = listDocsMeta(attacheTj(), key)
        .filter((d) => ZONES_MODELES.some((z) => String(d.rel).startsWith(z))).length
    } catch { continue }
    if (n > 0) { count += n; dossiers++ }
  }
  return { count, dossiers }
}

/** État persisté de l'étude (state.json — dates et compteurs, rien de sensible). */
export function etudeState() {
  const st = readState().etude
  return st && typeof st === 'object' ? st : {}
}

/**
 * Une étude est-elle justifiée MAINTENANT ? Raison ou null. Comme la
 * consolidation : accumulation, ou cadence — jamais sans matière nouvelle,
 * jamais moins de 24 h après la dernière tentative. Au premier passage
 * (jamais étudié), tout le stock existant compte comme nouveau : l'attaché
 * s'instruit du corpus dès la mise en service, sans un geste du magistrat.
 */
export function etudeDue() {
  const st = etudeState()
  const lastAttempt = Date.parse(st.lastAttemptAt || '') || 0
  if (Date.now() - lastAttempt < ATTEMPT_COOLDOWN_MS) return null
  const { count } = corpusActesValides()
  const nouveaux = Math.max(0, count - (Number.isFinite(Number(st.corpusAtRun)) ? Number(st.corpusAtRun) : 0))
  if (!nouveaux) return null
  if (nouveaux >= ETUDE_SEUIL) return `${nouveaux} nouveaux actes validés au corpus`
  const lastRun = Date.parse(st.lastRunAt || '') || 0
  if (lastRun && Date.now() - lastRun >= ETUDE_JOURS * 24 * 3600 * 1000) {
    return `cadence (${ETUDE_JOURS} j) avec ${nouveaux} nouveaux actes`
  }
  if (!lastRun) return `premier dépouillement du corpus (${count} actes)`
  return null
}

/** Statut pour l'interface — lisible même trousseau non remis (rien de chiffré ici). */
export function etudeStatus() {
  const st = etudeState()
  const corpus = corpusActesValides()
  return {
    corpus: corpus.count,
    dossiers: corpus.dossiers,
    nouveaux: Math.max(0, corpus.count - (Number.isFinite(Number(st.corpusAtRun)) ? Number(st.corpusAtRun) : 0)),
    seuil: ETUDE_SEUIL,
    cadenceJours: ETUDE_JOURS,
    lastRunAt: st.lastRunAt || null,
    lastRunOk: typeof st.lastRunOk === 'boolean' ? st.lastRunOk : null,
  }
}

/**
 * Consigne du run d'étude. Dépouillement délégué aux sous-agents (lecture
 * seule, copies markdown servies d'office — économe) ; seule la synthèse et
 * les écritures (trames modele-*, mémoire, livrable) reviennent à l'agent
 * principal.
 */
export function etudePrompt(trigger) {
  return [
    `ÉTUDE DU CORPUS D'ACTES VALIDÉS (déclenchement : ${trigger}) — tu apprends de ce que le magistrat a réellement signé.`,
    'Les pièces des zones « Actes » et « DML » des dossiers sont des versions VALIDÉES : actes du magistrat, et',
    'ordonnances rendues par les JLD — des juges qui savent rédiger, et qui reprennent ou reformulent ses requêtes.',
    'C\'est ta meilleure source de MODÈLES : mieux qu\'une correction, un acte validé montre ce qui est attendu.',
    '',
    'MÉTHODE :',
    '1. lister_dossiers (archives comprises) et instru_lister, puis DÉLÈGUE le dépouillement (sous_agents, un lot',
    '   par dossier ayant des pièces en zone Actes ou DML) : chaque sous-agent liste les documents du dossier',
    '   (lire_dossier section:"documents"), lit les actes de ces zones (lire_document — la copie markdown est',
    '   servie d\'office, ne relis pas les PDF) et REMONTE, par pièce : type d\'acte précis, structure (plan,',
    '   visas, formules consacrées), manière de motiver (comment les faits sont mobilisés, quelles conditions de',
    '   fond sont argumentées) — et pour chaque PAIRE requête ↔ ordonnance JLD du même objet : ce que le juge a',
    '   REPRIS tel quel, ce qu\'il a REFORMULÉ, ce qu\'il a AJOUTÉ ou EXIGÉ. Réponse télégraphique, pièce citée.',
    '2. SYNTHÉTISE par TYPE d\'acte (trames_lister d\'abord, pour savoir ce qui existe) :',
    '   - type SANS trame → CRÉE le modèle : trame_enregistrer, nom « modele-<type> » (ex. modele-requete-',
    '     interception), description « Modèle extrait des actes validés du magistrat (dossiers …) ». Le contenu',
    '     est un GABARIT réutilisable : structure, visas et formules CONSERVÉS, éléments d\'espèce remplacés par',
    '     des champs génériques [EN CAPITALES] — ne recopie JAMAIS un nom, une adresse, un numéro de ligne ou',
    '     une immatriculation réels dans un modèle.',
    '   - un « modele-<type> » existe déjà → tu peux l\'AMÉLIORER (trame_enregistrer, même nom — versionné) :',
    '     les trames préfixées modele- sont les tiennes.',
    '   - TOUTE AUTRE trame (déposée par le magistrat) reste interdite d\'écriture directe. Mais si le corpus',
    '     validé révèle une amélioration SUBSTANTIELLE (une formule que les JLD exigent systématiquement et qui',
    '     manque, un visa périmé, un plan que ses propres actes signés n\'appliquent plus) → proposer_trame :',
    '     texte INTÉGRAL révisé + motif citant les pièces — le magistrat applique d\'un ✓, ou refuse. Un simple',
    '     écart de goût ne se propose pas : il se note au livrable.',
    '   - leçons transversales de rédaction (ce que les JLD reprennent, reformulent ou exigent systématiquement,',
    '     les motivations qui passent sans retouche) → memoire_noter (« Réflexes appris »), en règles générales.',
    '3. Termine par remettre_livrable (sujet « Étude du corpus — modèles extraits ») : les modèles créés ou',
    '   améliorés (liste, avec les dossiers sources), tes observations sur les trames existantes, les leçons',
    '   retenues. Le magistrat supprime d\'un geste ce qu\'il ne veut pas garder (tout est versionné).',
    '',
    'SOIS SÉLECTIF : UN modèle par TYPE d\'acte (le meilleur exemplaire, ou la synthèse de plusieurs), jamais un',
    'modèle par pièce. Si le corpus n\'apporte rien de neuf depuis la dernière étude, ne crée rien et remets un',
    'livrable d\'une ligne le disant. Ce run étudie : il ne traite aucun dossier. Écritures autorisées : trames',
    'modele-* (trame_enregistrer), proposer_trame (améliorations des trames du magistrat), memoire_noter,',
    'remettre_livrable — rien d\'autre.',
  ].join('\n')
}
