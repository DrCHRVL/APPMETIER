/**
 * SIRAL — Attaché de justice · INSTRUCTIONS DU PROJET CLAUDE WEB.
 *
 * Le magistrat rédige ses actes dans un projet Claude web, qui porte ses
 * instructions permanentes. C'est LÀ que les leçons de rédaction doivent
 * atterrir — pas seulement dans les trames de SIRAL. Ce document en est la
 * version de référence, tenue dans SIRAL : chiffrée (clé globale),
 * versionnée à chaque écriture (même modèle que la mémoire).
 *
 * Qui l'écrit :
 *  - le magistrat, depuis Paramètres → Attaché IA (éditeur + bouton Copier,
 *    pour coller le texte dans les instructions de son projet claude.ai) ;
 *  - l'attaché, SUR INSTRUCTION EXPLICITE en conversation
 *    (instructions_projet_enregistrer) ;
 *  - la consolidation d'apprentissage, par PROPOSITION ✓/✗ uniquement
 *    (proposer_instructions_projet) : elle relit les actes corrigés à la main
 *    ou refusés — tous rédigés par Claude web — et en tire des règles de
 *    rédaction générales, insérées dans le texte complet révisé.
 * Qui le lit : Claude web, par le connecteur (instructions_projet_lire), au
 * début d'une tâche de rédaction — même quand le magistrat n'a pas encore
 * collé la dernière version dans son projet.
 */
import { readEnvelopeFile, writeEnvelopeFile } from './store.mjs'
import { encryptJson, decryptJson } from './crypto.mjs'

const FILE = 'instructions-projet.json'
export const INSTRUCTIONS_PROJET_MAX = 60_000

export const DEFAULT_INSTRUCTIONS_PROJET = `# Instructions du projet Claude web — rédaction des actes (SIRAL)

## Rôle et contexte
Tu rédiges, pour un magistrat du parquet (criminalité organisée), les actes de
procédure dont il a besoin : requêtes, autorisations, prolongations,
réquisitions, soit-transmis, réponses DML, réquisitoires. SIRAL, par son
connecteur, te donne le dossier (NATINF enregistrés, mis en cause, échéancier,
chronologie, pièces, fichier global), ses trames (trames_lister / trame_lire),
ses skills (skills_lister / skill_lire) et sa base de connaissances
(kb_chercher / kb_lire). Les instructions de ce projet priment.

## Exigences de rédaction
(à compléter : ce que le magistrat exige de chaque acte — registre, plan,
visas, motivation, formules consacrées)

## Pièges à éviter
(les corrections répétées du magistrat sur les actes rédigés, en règles
générales — jamais l'anecdote)

## Remise dans SIRAL
Un acte rédigé se range avec produire_document (numero, type, titre daté,
source = nom exact de la trame suivie, acteMeta pour une écoute ou une
géolocalisation) ; une synthèse avec remettre_livrable.
`

export function readInstructionsProjet(keys) {
  const env = readEnvelopeFile(FILE)
  if (!env) return DEFAULT_INSTRUCTIONS_PROJET
  try {
    const { content } = decryptJson(keys.global, env)
    return typeof content === 'string' && content.trim() ? content : DEFAULT_INSTRUCTIONS_PROJET
  } catch {
    return DEFAULT_INSTRUCTIONS_PROJET
  }
}

/** Le document a-t-il déjà été écrit (par opposition au squelette par défaut) ? */
export function instructionsProjetExistent() {
  return Boolean(readEnvelopeFile(FILE))
}

/**
 * Réécriture COMPLÈTE (magistrat en chat, ou ✓ d'une proposition). Garde-fous :
 * jamais de quasi-effacement (le magistrat efface depuis le panneau), taille
 * bornée (ce texte se colle dans les instructions d'un projet claude.ai).
 */
export async function writeInstructionsProjet(keys, content, savedBy) {
  const texte = String(content || '').trim()
  if (texte.length < 200) {
    throw new Error('Instructions quasi vides refusées : le texte COMPLET est attendu (≥ 200 caractères) — l\'effacement appartient au magistrat (panneau).')
  }
  if (texte.length > INSTRUCTIONS_PROJET_MAX) {
    throw new Error(`Trop long (${texte.length} caractères, maximum ${INSTRUCTIONS_PROJET_MAX}) : des instructions de projet se lisent à chaque conversation — distille (règles générales, pas d'anecdotes).`)
  }
  const env = encryptJson(keys.global, { content: texte + '\n' }, { savedAt: new Date().toISOString(), savedBy })
  await writeEnvelopeFile(FILE, env)
  return { ok: true, chars: texte.length }
}
