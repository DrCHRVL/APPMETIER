/**
 * SIRAL — marqueur de DIAGRAMME LIBRE dans un document.
 *
 * Complément du marqueur [GRAPHIQUE : …] (catalogue statistique du service) :
 * ici l'attaché fournit LUI-MÊME les données — issues d'un dossier, d'un
 * tableur reçu, d'un décompte — et le diagramme s'insère dans n'importe quelle
 * production (bilan, note, présentation). Le document reste du TEXTE BRUT
 * éditable ; aux exports (PDF, Word, PowerPoint), chaque marqueur est remplacé
 * par l'image du graphique, rendue dans le navigateur (Chart.js, couleurs de
 * l'app) — aucun aller-retour serveur, les données sont dans le marqueur.
 *
 * Syntaxe, seul sur sa ligne :
 *
 *   [DIAGRAMME : colonnes | titre=Saisies par produit (2026) | Cocaïne: 12 ; Héroïne: 4,5 ; Cannabis: 260]
 *
 *  - type    : colonnes | barres | courbe | secteurs
 *  - titre=… : facultatif (affiché au-dessus du diagramme)
 *  - unite=… : facultatif (ex. unite=kg — suffixe des valeurs)
 *  - données : « Étiquette: valeur » séparés par « ; » — décimales à la
 *    française acceptées (12,5), espaces de milliers tolérés (1 200).
 *
 * SOURCE UNIQUE de la syntaxe, partagée par :
 *  - le service attaché (prompt système) qui ÉCRIT le marqueur ;
 *  - l'app web (lib/web/diagrammeActe.ts, lib/web/acteExport.ts,
 *    lib/web/pptxExport.ts) qui le LIT et le remplace par l'image aux exports.
 */

/** Types de diagramme disponibles (clé = valeur écrite dans le marqueur). */
export const TYPES_DIAGRAMME = ['colonnes', 'barres', 'courbe', 'secteurs']

/** Un marqueur, seul sur sa ligne : [DIAGRAMME : type | segments…] */
export const RE_MARQUEUR_DIAGRAMME =
  /^\s*\[\s*DIAGRAMME\s*:\s*(colonnes|barres|courbe|secteurs)\s*\|([^\]\n]+)\]\s*$/i

/** Nombre à la française : « 1 200,5 » → 1200.5 (null si non numérique). */
function nombreFr(s) {
  const t = String(s || '').replace(/[\s  ]/g, '').replace(',', '.')
  if (!/^-?\d+(?:\.\d+)?$/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * Analyse une LIGNE : { type, titre?, unite?, donnees: [{label, valeur}] }
 * ou null si ce n'est pas un marqueur valide (il faut ≥ 1 point de donnée).
 */
export function parseDiagramme(ligne) {
  const m = RE_MARQUEUR_DIAGRAMME.exec(String(ligne || ''))
  if (!m) return null
  const type = m[1].toLowerCase()
  let titre
  let unite
  const donnees = []
  for (const segment of m[2].split('|')) {
    const seg = segment.trim()
    if (!seg) continue
    const opt = /^(titre|unite)\s*=\s*(.*)$/i.exec(seg)
    if (opt) {
      if (opt[1].toLowerCase() === 'titre') titre = opt[2].trim() || undefined
      else unite = opt[2].trim() || undefined
      continue
    }
    // Segment de données : « Étiquette: valeur » séparés par « ; ». Le DERNIER
    // « : » sépare l'étiquette de la valeur (une étiquette peut en contenir).
    for (const paire of seg.split(';')) {
      const p = paire.trim()
      if (!p) continue
      const idx = p.lastIndexOf(':')
      if (idx <= 0) continue
      const valeur = nombreFr(p.slice(idx + 1))
      const label = p.slice(0, idx).trim()
      if (label && valeur !== null) donnees.push({ label: label.slice(0, 80), valeur })
    }
  }
  if (!donnees.length) return null
  return { type, titre, unite, donnees: donnees.slice(0, 40) }
}

/** Nombre au format marqueur (décimale française, sans espaces de milliers). */
function valeurFr(n) {
  return String(n).replace('.', ',')
}

/** Écrit un marqueur canonique (clé des tables de résolution). */
export function formatDiagramme({ type, titre, unite, donnees }) {
  const parts = [String(type)]
  if (titre) parts.push(`titre=${titre}`)
  if (unite) parts.push(`unite=${unite}`)
  parts.push(donnees.map((d) => `${d.label}: ${valeurFr(d.valeur)}`).join(' ; '))
  return `[DIAGRAMME : ${parts.join(' | ')}]`
}

/** Tous les marqueurs d'un texte (dédoublonnés par forme canonique). */
export function trouverDiagrammes(texte) {
  const vus = new Map()
  for (const ligne of String(texte || '').split(/\r?\n/)) {
    const d = parseDiagramme(ligne)
    if (d) vus.set(formatDiagramme(d), d)
  }
  return [...vus.values()]
}
