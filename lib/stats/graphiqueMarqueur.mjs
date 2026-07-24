/**
 * SIRAL — marqueur de graphique statistique dans un document.
 *
 * Quand l'attaché rédige un bilan d'activité, il place les graphiques par un
 * marqueur TEXTE, seul sur sa ligne :
 *
 *   [GRAPHIQUE : procedures_terminees_par_mois | du=2026-01-01 | au=2026-06-30]
 *
 * Le document reste du texte brut (éditable dans « Actes rédigés ») ; à
 * l'EXPORT PDF/Word, chaque marqueur est remplacé par l'image PNG
 * correspondante, régénérée par le service attaché avec les couleurs et les
 * règles de la page Statistiques (route /stats-graphique).
 *
 * SOURCE UNIQUE de la syntaxe, partagée par :
 *  - le service attaché (prompt système + skill bilan) qui ÉCRIT le marqueur ;
 *  - l'app web (lib/web/graphiquesActe.ts, lib/web/acteExport.ts) qui le LIT
 *    et le remplace par l'image aux exports.
 */

/** Un marqueur, seul sur sa ligne. Période optionnelle (défaut côté service :
 *  année en cours) — le bilan la précise TOUJOURS pour figer le document. */
export const RE_MARQUEUR_GRAPHIQUE =
  /^\s*\[\s*GRAPHIQUE\s*:\s*([a-z0-9_]+)\s*(?:\|\s*du\s*=\s*(\d{4}-\d{2}-\d{2})\s*)?(?:\|\s*au\s*=\s*(\d{4}-\d{2}-\d{2})\s*)?\]\s*$/i

/** Écrit un marqueur canonique. */
export function formatMarqueur({ graphique, du, au }) {
  const parts = [String(graphique)]
  if (du) parts.push(`du=${du}`)
  if (au) parts.push(`au=${au}`)
  return `[GRAPHIQUE : ${parts.join(' | ')}]`
}

/** Analyse une LIGNE : { graphique, du, au } ou null si ce n'en est pas un. */
export function parseMarqueur(ligne) {
  const m = RE_MARQUEUR_GRAPHIQUE.exec(String(ligne || ''))
  if (!m) return null
  return { graphique: m[1].toLowerCase(), du: m[2] || undefined, au: m[3] || undefined }
}

/** Tous les marqueurs d'un texte (dédoublonnés par forme canonique). */
export function trouverMarqueurs(texte) {
  const vus = new Map()
  for (const ligne of String(texte || '').split(/\r?\n/)) {
    const m = parseMarqueur(ligne)
    if (m) vus.set(formatMarqueur(m), m)
  }
  return [...vus.values()]
}
