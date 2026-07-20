/**
 * SIRAL — Attaché de justice · apprentissage progressif.
 *
 * L'attaché doit s'AMÉLIORER d'une intervention à l'autre sans que cela
 * coûte des jetons à chaque tour. Le mécanisme tient en deux temps :
 *
 *  1. CAPTURE (coût zéro — aucun appel au modèle) : chaque signal
 *     d'expérience est consigné en une ligne chiffrée dans
 *     `apprentissage.jsonl` — proposition refusée ou validée par le
 *     magistrat, acte révisé après coup, acte corrigé à la main, leçon
 *     notée en cours de conversation (memoire_noter).
 *
 *  2. CONSOLIDATION (périodique, modèle économe) : un run dédié relit les
 *     signaux accumulés et la mémoire courante, DISTILLE l'ensemble en
 *     règles générales et RÉÉCRIT la mémoire sous un BUDGET STRICT de
 *     caractères. La mémoire — relue à chaque intervention — reste donc
 *     courte et dense : l'apprentissage fait BAISSER la consommation
 *     (moins d'erreurs → moins de retouches → moins de runs), au lieu de
 *     la faire enfler.
 *
 * Tout reste sous le contrôle du magistrat : les signaux sont chiffrés
 * (clé globale), la mémoire consolidée demeure lisible, corrigeable et
 * effaçable depuis le panneau, et chaque consolidation laisse une carte
 * « Apprentissage » dans le fil « pendant votre absence ».
 */
import { appendEncryptedLine, readEncryptedLines, readState } from './store.mjs'
import { encryptJson, decryptJson } from './crypto.mjs'
import { memoryStats } from './memory.mjs'

const FILE = 'apprentissage.jsonl'
const MAX_LINES = 4000 // lecture bornée — plusieurs mois de signaux

/** Types de signaux captés (tout autre libellé est refusé). */
export const SIGNAL_TYPES = [
  'proposition_refusee',      // ✗ du magistrat sur une proposition — signal fort
  'proposition_validee',      // ✓ du magistrat — signal faible (confirme un réflexe)
  'acte_revise',              // l'attaché a dû réviser un acte déjà produit
  'acte_edite_main',          // le magistrat a corrigé un acte À LA MAIN — signal fort
  'lecon',                    // leçon explicite notée en cours d'échange
  'garde_qualite',            // une porte de qualité a rejeté une production (inachevé, squelettique…)
  'correction_conversation',  // le magistrat a repris l'attaché en chat (repérage heuristique)
]

/**
 * Un message du magistrat ressemble-t-il à une CORRECTION de l'attaché ?
 * Repérage heuristique, volontairement ÉTROIT (mieux vaut manquer une
 * correction — la consolidation a d'autres signaux — que polluer le journal
 * de faux positifs qui coûteraient des relectures de conversations).
 * Aucun appel au modèle : appelé à chaque sauvegarde de conversation.
 */
const CORRECTION_RE = [
  /^non\b/i,                                        // « Non, ce n'est pas… »
  /\brefais(?:-le|-la|-les)?\b/i,
  /\brecommence\b/i,
  /\bpas comme ça\b/i,
  /\bce n'est pas ce que je\b/i,
  /\bje t'(?:ai|avais) (?:déjà )?(?:dit|demandé|expliqué)\b/i,
  /\bje te l'(?:ai|avais) déjà (?:dit|demandé)\b/i,
  /\btu n'as pas (?:suivi|respecté|appliqué|repris|lu)\b/i,
  /\btu (?:as|avais) oublié\b/i,
  /\bencore (?:une fois|cette erreur)\b/i,
  /^corrige\b/i,
]

export function detecterCorrection(message) {
  const m = String(message || '').trim()
  if (!m || m.length > 4000) return false // un long collage n'est pas une reprise
  return CORRECTION_RE.some((re) => re.test(m))
}

// Cadence et seuils de consolidation — ajustables sans toucher au code.
const bounded = (v, min, max, dflt) => {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n >= min && n <= max ? n : dflt
}
/** Nombre de signaux qui déclenche une consolidation sans attendre la cadence. */
export const SEUIL_SIGNAUX = bounded(process.env.SIRAL_ATTACHE_APPRENTISSAGE_SEUIL, 3, 200, 12)
/**
 * Signaux FORTS : une CORRECTION directe du magistrat (acte corrigé à la main,
 * proposition refusée, reprise en chat). Peu nombreux mais décisifs — on
 * consolide dès qu'il y en a quelques-uns, sans attendre le seuil générique ni
 * la cadence, pour ne pas refaire l'erreur au prochain acte.
 */
export const SIGNAUX_FORTS = ['acte_edite_main', 'proposition_refusee', 'correction_conversation']
export const SEUIL_SIGNAUX_FORTS = bounded(process.env.SIRAL_ATTACHE_APPRENTISSAGE_SEUIL_FORTS, 1, 50, 3)
/** Cadence de fond (jours) — ne tourne que s'il y a des signaux à distiller. */
export const CADENCE_JOURS = bounded(process.env.SIRAL_ATTACHE_APPRENTISSAGE_JOURS, 1, 90, 7)
/** Cadence de fond : UN signal suffit — l'apprentissage est entièrement
 * autonome, rien ne doit attendre un geste du magistrat. */
const MIN_SIGNAUX_CADENCE = 1
/** Garde anti-rafale : pas de déclenchement automatique 2 fois en moins de 12 h. */
const ATTEMPT_COOLDOWN_MS = 12 * 3600 * 1000

/**
 * Consigne un signal d'apprentissage — best-effort : ne bloque JAMAIS
 * l'action qui l'émet (une capture ratée ne doit rien casser).
 */
export async function recordLearningSignal(keys, { type, dossier, detail, source }) {
  try {
    if (!keys || !SIGNAL_TYPES.includes(type)) return
    const ts = Date.now()
    const env = encryptJson(keys.global, {
      type,
      dossier: dossier ? String(dossier).slice(0, 80) : undefined,
      detail: String(detail || '').slice(0, 400),
      source: source ? String(source).slice(0, 120) : undefined,
      at: new Date(ts).toISOString(),
    })
    await appendEncryptedLine(FILE, { ts, iv: env.iv, ct: env.ct })
  } catch { /* la capture ne doit jamais gêner l'attaché */ }
}

/** État de consolidation persisté (state.json — non sensible : dates seulement). */
export function learningState() {
  const st = readState().apprentissage
  return st && typeof st === 'object' ? st : {}
}

/**
 * Signaux postérieurs au dernier point de consolidation, déchiffrés.
 * `max` borne la sortie (les plus récents gardés) pour que le bilan reste
 * digeste — et économe — dans le prompt du run de consolidation.
 */
export function pendingSignals(keys, max = 80) {
  const since = Number(learningState().consolidatedTs) || 0
  const lines = readEncryptedLines(FILE, MAX_LINES)
  const out = []
  for (const l of lines) {
    if (!l || typeof l.ts !== 'number' || l.ts <= since) continue
    try {
      const sig = decryptJson(keys.global, { iv: l.iv, ct: l.ct })
      out.push({ ts: l.ts, ...sig })
    } catch { /* ligne d'une ancienne clé : ignorée */ }
  }
  return out.slice(-max)
}

/**
 * Comptage des signaux en attente SANS déchiffrement (horodatages seuls) :
 * appelé à chaque tick du planificateur, il doit rester gratuit.
 * Rend { count, firstTs } — firstTs sert à la règle de cadence.
 */
export function pendingCount() {
  const since = Number(learningState().consolidatedTs) || 0
  const lines = readEncryptedLines(FILE, MAX_LINES)
  let count = 0
  let firstTs = 0
  for (const l of lines) {
    if (!l || typeof l.ts !== 'number' || l.ts <= since) continue
    count++
    if (!firstTs || l.ts < firstTs) firstTs = l.ts
  }
  return { count, firstTs }
}

/** Horodatage du signal le plus récent (borne haute d'une consolidation). */
export function latestSignalTs() {
  const lines = readEncryptedLines(FILE, MAX_LINES)
  let max = 0
  for (const l of lines) if (l && typeof l.ts === 'number' && l.ts > max) max = l.ts
  return max
}

/**
 * Progression mesurée — AUCUN appel au modèle : agrégats des signaux sur les
 * 30 derniers jours face aux 30 jours précédents. C'est le tableau de bord de
 * l'amélioration : un taux d'acceptation des propositions qui monte et des
 * retouches d'actes qui baissent = l'attaché répond mieux aux exigences.
 * Fourni à l'interface ET au run de consolidation (qui cible ses régressions).
 */
export function learningMetrics(keys, now = Date.now()) {
  const J30 = 30 * 24 * 3600 * 1000
  const fenetre = () => ({ validees: 0, refusees: 0, revisions: 0, editionsMain: 0, portes: 0, lecons: 0, corrections: 0 })
  const j30 = fenetre()
  const j30prec = fenetre()
  const lines = readEncryptedLines(FILE, MAX_LINES)
  for (const l of lines) {
    if (!l || typeof l.ts !== 'number' || l.ts < now - 2 * J30) continue
    let sig
    try { sig = decryptJson(keys.global, { iv: l.iv, ct: l.ct }) } catch { continue }
    const b = l.ts >= now - J30 ? j30 : j30prec
    if (sig.type === 'proposition_validee') b.validees++
    else if (sig.type === 'proposition_refusee') b.refusees++
    else if (sig.type === 'acte_revise') b.revisions++
    else if (sig.type === 'acte_edite_main') b.editionsMain++
    else if (sig.type === 'garde_qualite') b.portes++
    else if (sig.type === 'lecon') b.lecons++
    else if (sig.type === 'correction_conversation') b.corrections++
  }
  const taux = (b) => (b.validees + b.refusees > 0 ? Math.round((b.validees / (b.validees + b.refusees)) * 100) : null)
  return {
    j30: { ...j30, tauxAcceptation: taux(j30) },
    j30prec: { ...j30prec, tauxAcceptation: taux(j30prec) },
  }
}

/** La progression en UNE phrase compacte — pour le bilan du run de consolidation. */
export function metricsSummary(m) {
  const t = (v) => (v == null ? 'n/a' : `${v} %`)
  return `propositions acceptées : ${t(m.j30.tauxAcceptation)} sur 30 j (${t(m.j30prec.tauxAcceptation)} les 30 j précédents) · `
    + `actes retouchés (révisions + éditions à la main) : ${m.j30.revisions + m.j30.editionsMain} (vs ${m.j30prec.revisions + m.j30prec.editionsMain}) · `
    + `portes de qualité déclenchées : ${m.j30.portes} (vs ${m.j30prec.portes}) · `
    + `corrections en conversation : ${m.j30.corrections} (vs ${m.j30prec.corrections})`
}

/**
 * Statut complet pour l'interface (Paramètres → Attaché IA → Apprentissage).
 * Sans trousseau, on rend ce qui reste lisible (dates, budget) — jamais d'erreur.
 */
export function learningStatus(keys) {
  const st = learningState()
  const base = {
    seuilSignaux: SEUIL_SIGNAUX,
    cadenceJours: CADENCE_JOURS,
    lastRunAt: st.lastRunAt || null,
    lastRunOk: typeof st.lastRunOk === 'boolean' ? st.lastRunOk : null,
    lastTrigger: st.lastTrigger || null,
  }
  if (!keys) return { ...base, keyring: false, pending: null, memoire: null }
  const pending = pendingSignals(keys, 500)
  const parType = {}
  for (const s of pending) parType[s.type] = (parType[s.type] || 0) + 1
  return {
    ...base,
    keyring: true,
    pending: pendingCount().count,
    parType,
    memoire: memoryStats(keys),
    progression: learningMetrics(keys),
    due: consolidationDue(keys),
  }
}

/**
 * Une consolidation est-elle justifiée MAINTENANT ? Rend la raison (texte
 * court) ou null. Trois déclencheurs : accumulation de signaux, mémoire
 * au-dessus du budget, cadence de fond — jamais moins de 12 h après la
 * dernière tentative (échec compris : on ne mitraille pas le forfait).
 * Aucun déchiffrement : appelable à chaque tick du planificateur.
 */
export function consolidationDue(keys) {
  const st = learningState()
  const lastAttempt = Date.parse(st.lastAttemptAt || '') || 0
  if (Date.now() - lastAttempt < ATTEMPT_COOLDOWN_MS) return null
  const { count, firstTs } = pendingCount()
  if (count >= SEUIL_SIGNAUX) return `${count} signaux accumulés`
  // Corrections directes du magistrat : on consolide sans attendre la cadence.
  // Déchiffrement borné, et seulement dans la fenêtre utile (assez de signaux,
  // seuil générique pas encore atteint) — le tick reste économe.
  if (count >= SEUIL_SIGNAUX_FORTS) {
    const forts = pendingSignals(keys, 120).filter((s) => SIGNAUX_FORTS.includes(s.type)).length
    if (forts >= SEUIL_SIGNAUX_FORTS) return `${forts} corrections du magistrat à intégrer`
  }
  const mem = memoryStats(keys)
  if (mem.over) return `mémoire au-dessus du budget (${mem.chars} > ${mem.budget} caractères)`
  if (count >= MIN_SIGNAUX_CADENCE) {
    const ref = Date.parse(st.lastRunAt || '') || firstTs
    if (Date.now() - ref >= CADENCE_JOURS * 24 * 3600 * 1000) {
      return `cadence (${CADENCE_JOURS} j) avec ${count} signaux`
    }
  }
  return null
}

/**
 * Consigne du run de consolidation. Le run dispose des outils MCP habituels
 * (lecture seule utile : apprentissage_bilan, lire_dossier…) et de
 * memoire_reecrire ; il tourne sur le modèle économe des sous-agents.
 */
export function consolidationPrompt({ budget, trigger }) {
  return [
    `CONSOLIDATION DE TON APPRENTISSAGE (déclenchement : ${trigger}) — run périodique, court et économe.`,
    'Ta mémoire est relue à CHAQUE intervention : chaque caractère superflu se paie en jetons à chaque run.',
    'Elle doit rester un document DISTILLÉ — des règles qui changent tes réponses — jamais un journal.',
    '',
    'MÉTHODE, dans cet ordre :',
    '1. apprentissage_bilan — les signaux depuis la dernière consolidation : corrections du magistrat',
    '   (propositions refusées ✗, actes retouchés après ta rédaction, actes corrigés à la main), validations ✓,',
    '   leçons notées — et ta PROGRESSION mesurée (taux d\'acceptation, retouches, portes de qualité, 30 j vs',
    '   30 j précédents) : si un indicateur RÉGRESSE, cherche la cause dans les signaux et traite-la en priorité.',
    '   Pour un signal acte_edite_main (le magistrat a corrigé un acte À LA MAIN), appelle production_diff avec',
    '   son numero, son id et le versionAt porté par le signal : tu vois EXACTEMENT ce qu\'il a retiré (−) et',
    '   ajouté (+) à ton jet — la matière la plus directe qui soit. Distingue la correction de FOND (motivation',
    '   à étoffer, visa manquant, structure, formule attendue, qualification) de la simple coquille : ne mémorise',
    '   que ce qui changera tes PROCHAINS actes. Pour un signal correction_conversation, LIS la conversation citée',
    '   (conversation_lire, id dans source) : la reprise du magistrat y est en clair — matière tout aussi précieuse.',
    '   Si un autre signal manque de contexte, tu PEUX consulter le dossier cité — mais reste bref.',
    '2. RELIS ta mémoire actuelle (en fin de ton prompt système) et DISTILLE l\'ensemble mémoire + signaux :',
    '   - transforme les épisodes en RÈGLES GÉNÉRALES actionnables (ex. trois propositions de CR refusées sur des',
    '     pièces déjà exploitées → « Ne proposer un CR que s\'il apporte des éléments nouveaux non déjà consignés ») ;',
    '   - fusionne les doublons, tranche les contradictions (la consigne la plus récente du magistrat prime),',
    '     supprime l\'anecdotique, le périmé, et ce que tes règles de gouvernance ou les consignes permanentes',
    '     couvrent déjà (ne duplique jamais le prompt système) ;',
    '   - hiérarchise : d\'abord ce qui évite les erreurs que le magistrat a dû corriger.',
    '   Structure attendue : # Mémoire de l\'attaché de justice, puis sections ## Exigences du magistrat ·',
    '   ## Réflexes appris · ## Pièges à éviter (+ ## Dossiers — particularités durables si nécessaire).',
    `3. memoire_reecrire avec le document COMPLET, ≤ ${budget} caractères. S'il faut arbitrer, garde ce qui`,
    '   évite les erreurs les plus coûteuses en travail du magistrat.',
    '4. FAIS ÉVOLUER LES MÉTHODES (les processus se bonifient, pas seulement la mémoire). Règle de PROPRIÉTÉ,',
    '   imposée aussi dans le code : les skills « auto-* » et les trames « modele-* » sont les TIENNES — tu les',
    '   écris directement (versionnées) ; TOUTE méthode du magistrat s\'améliore par PROPOSITION ✓/✗, jamais',
    '   d\'office. Concrètement :',
    '   - CIBLE d\'abord ce qui corrèle avec les corrections : les signaux d\'actes retouchés portent la trame',
    '     suivie (champ source « trame … ») — une trame/skill dont l\'usage produit des retouches répétées est',
    '     TA priorité. Si c\'est une modele-*/auto-* → corrige-la directement (trame_enregistrer /',
    '     skill_enregistrer, même nom). Si c\'est une méthode du magistrat → proposer_trame / proposer_skill',
    '     (texte INTÉGRAL révisé + motif citant les signaux) — il applique d\'un ✓.',
    '   - processus multi-étapes RÉCURRENT qu\'aucune skill ne couvre → rédige la skill « auto-<nom> »',
    '     (description soignée : c\'est elle qui la déclenchera) avec skill_enregistrer ;',
    '   - choix trame/skill stabilisé pour un type d\'acte → association_definir ;',
    '   - HYGIÈNE DU CATALOGUE : la liste des skills se paie dans CHAQUE prompt (plafond de skills auto-*',
    '     imposé). Si deux auto-* se recouvrent, FUSIONNE-les (skill_enregistrer l\'une enrichie,',
    '     skill_supprimer l\'autre) ; supprime une auto-* devenue inutile.',
    '5. Termine par signaler (type note, titre « Apprentissage — consolidation ») : en 2-5 phrases, ce que tu',
    '   as retenu de NEUF, ce que tu feras différemment, et CHAQUE évolution de méthode — écrite (auto-*/modele-*,',
    '   associations) ou proposée (proposer_trame/proposer_skill en attente de ✓) : le magistrat doit pouvoir',
    '   vérifier — et annuler — chacune.',
    '',
    'CAS PARTICULIERS : si les signaux n\'apportent RIEN de neuf et que la mémoire est déjà sous le budget et',
    'bien structurée, ne réécris rien — signale simplement (même titre) qu\'il n\'y avait rien à retenir.',
    'Si la mémoire dépasse le budget, la réécriture distillée est OBLIGATOIRE. Outils d\'écriture AUTORISÉS dans',
    'ce run : memoire_reecrire, skill_enregistrer (auto-*), skill_supprimer (auto-*), trame_enregistrer',
    '(modele-*), proposer_trame, proposer_skill, association_definir, signaler — rien d\'autre : ce run',
    'consolide les méthodes, il ne traite pas les dossiers.',
  ].join('\n')
}
