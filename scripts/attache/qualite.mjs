/**
 * SIRAL — Attaché de justice · portes de qualité auto-appliquées.
 *
 * Des CONTRÔLES DÉTERMINISTES (zéro appel au modèle, zéro jeton) exécutés au
 * moment où l'attaché remet une production (produire_document,
 * remettre_livrable). Une violation REJETTE l'écriture avec une erreur
 * actionnable : l'agent corrige dans le même run, AVANT que le magistrat ne
 * voie un travail non conforme — la norme s'applique d'elle-même, elle ne
 * dépend plus de la seule discipline du prompt.
 *
 * Chaque déclenchement est aussi capté comme signal d'apprentissage
 * (type garde_qualite) : une porte qui claque souvent révèle un pli à
 * corriger durablement — la consolidation le distillera en réflexe.
 *
 * Les règles sont volontairement PEU NOMBREUSES et SÛRES (pas de faux
 * positifs sur un acte légitime) : on bloque l'inachevé et l'interdit,
 * jamais le style.
 */

// Types d'actes « à signer » : un texte squelettique y est un défaut grave
// (la motivation fait la validité de l'acte) — plancher de substance.
const TYPES_ACTE_SIGNE = new Set(['requisition', 'reponse_dml', 'prolongation_jld', 'saisine_jld', 'soit_transmis'])
const MIN_CHARS_ACTE = 600

// Marqueurs d'inachèvement. [À CONFIRMER] reste AUTORISÉ : c'est le mécanisme
// officiel des points suspendus à une réponse du magistrat.
const PLACEHOLDERS = [
  /\[À COMPL[EÉ]TER\]/i,
  /\bTODO\b/,
  /<ins[ée]rer/i,
  /XXXX+/,
]

// Auto-désignation (règle de DISSIMULATION) : l'attaché n'existe pas dans les
// documents. Motifs étroits pour ne jamais bloquer une mention légitime.
const AUTO_DESIGNATION = [
  /attach[ée]\s+ia\b/i,
  /en\s+tant\s+qu[''](?:ia|assistant|intelligence artificielle)/i,
  /je\s+suis\s+un(?:e)?\s+(?:ia|assistant|intelligence artificielle)/i,
  /r[ée]dig[ée]e?\s+par\s+(?:une\s+)?(?:ia|intelligence artificielle)/i,
]

// Les actes sont remis en TEXTE BRUT (l'export officiel fait la mise en page).
const HTML = /<\s*(?:br|div|p|span|table|html|body)\b/i

/**
 * Contrôle une production. `mode` : 'acte' (produire_document) ou 'livrable'
 * (remettre_livrable — règles allégées : un livrable peut être long, formaté
 * markdown, et n'est pas un acte à signer).
 * Rend la liste des violations [{ code, message }] (vide = conforme).
 */
export function controlerProduction({ type, contenu, mode = 'acte' }) {
  const texte = String(contenu || '')
  const violations = []

  if (AUTO_DESIGNATION.some((re) => re.test(texte))) {
    violations.push({
      code: 'auto-designation',
      message: 'AUTO-DÉSIGNATION : le document te mentionne (« Attaché IA », « en tant qu\'IA »…). Tes productions sont signées du magistrat — réécris sans jamais te désigner.',
    })
  }

  if (PLACEHOLDERS.some((re) => re.test(texte))) {
    violations.push({
      code: 'inacheve',
      message: 'INACHEVÉ : il reste un marqueur à compléter (« [À COMPLÉTER] », « TODO », « <insérer », « XXXX »). Complète-le avec les éléments du dossier, ou marque le point [À CONFIRMER] si une réponse du magistrat est attendue.',
    })
  }

  if (mode === 'acte') {
    if (HTML.test(texte)) {
      violations.push({
        code: 'html',
        message: 'HTML détecté : un acte se remet en texte brut (paragraphes séparés par des lignes vides) — jamais de balises.',
      })
    }
    if (TYPES_ACTE_SIGNE.has(String(type)) && texte.trim().length < MIN_CHARS_ACTE) {
      violations.push({
        code: 'squelettique',
        message: `ACTE SQUELETTIQUE (${texte.trim().length} caractères) : un ${type} doit être complet et densément motivé (rappel des faits circonstancié, fondements article par article, conditions de fond). Reprends la MÉTHODE DE RÉDACTION D'UN ACTE : association → skill → trame → acte précédent → motivation.`,
      })
    }
  }

  return violations
}
