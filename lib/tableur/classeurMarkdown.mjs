/**
 * SIRAL — conversion d'un classeur (Excel/ODS) en markdown, source UNIQUE.
 *
 * Partagé par le navigateur (lib/web/fileToMarkdown.ts — téléversements vers
 * l'attaché, copies MD des zones documents) et par le service attaché
 * (scripts/attache/officeText.mjs — pièces jointes de mail, dépôt majordome,
 * lire_document) : un fichier Excel confié à l'attaché arrive TOUJOURS sous la
 * même forme — une section par feuille, chaque feuille en tableau markdown —
 * quel que soit le chemin d'entrée. Le module reçoit la bibliothèque SheetJS
 * en paramètre (déjà en dépendance des deux côtés) : il ne l'importe pas
 * lui-même, chaque côté la charge à sa façon (dynamique côté web).
 *
 * Choix de fidélité : `sheet_to_json(raw:false)` sert les valeurs FORMATÉES
 * (dates, pourcentages, monnaies tels qu'affichés dans le tableur) — c'est ce
 * que voit l'utilisateur du fichier, donc ce que l'attaché doit lire. Tout est
 * borné (lignes par feuille, caractères au total) avec une mention EXPLICITE
 * de ce qui a été tronqué : jamais de coupe silencieuse.
 */

/** Bornes par défaut : larges pour l'exploitation, sûres pour les tokens. */
export const TABLEUR_MAX_LIGNES_PAR_FEUILLE = 1500
export const TABLEUR_MAX_COLONNES = 40
export const TABLEUR_MAX_CHARS = 350_000

/** Nettoie une cellule pour un tableau markdown (| et retours à la ligne). */
function celluleMarkdown(v) {
  return String(v == null ? '' : v)
    .replace(/\r\n?|\n/g, ' ')
    .replace(/\|/g, '/')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}

/** Retire les lignes/colonnes vides de queue d'une matrice de cellules. */
function rognerMatrice(rows) {
  let lastRow = rows.length - 1
  while (lastRow >= 0 && rows[lastRow].every((c) => !String(c ?? '').trim())) lastRow--
  let lastCol = -1
  for (let r = 0; r <= lastRow; r++) {
    for (let c = rows[r].length - 1; c > lastCol; c--) {
      if (String(rows[r][c] ?? '').trim()) { lastCol = c; break }
    }
  }
  return rows.slice(0, lastRow + 1).map((r) => r.slice(0, lastCol + 1))
}

/**
 * Convertit UNE feuille (déjà en matrice de valeurs formatées) en tableau
 * markdown. La première ligne non vide sert d'en-tête (cas usuel d'un listing).
 * Rend { markdown, lignes, colonnes, tronqueLignes, tronqueColonnes }.
 */
function feuilleEnMarkdown(matrice, { maxLignes, maxColonnes }) {
  const rows = rognerMatrice(matrice)
  if (!rows.length) return { markdown: '', lignes: 0, colonnes: 0, tronqueLignes: 0, tronqueColonnes: 0 }
  const colonnes = Math.max(...rows.map((r) => r.length))
  const colGardees = Math.min(colonnes, maxColonnes)
  const lignesGardees = Math.min(rows.length, maxLignes)
  const ligne = (cells) => '| ' + Array.from({ length: colGardees }, (_, i) => celluleMarkdown(cells[i])).join(' | ') + ' |'
  const out = [ligne(rows[0]), '|' + ' --- |'.repeat(colGardees)]
  for (let r = 1; r < lignesGardees; r++) out.push(ligne(rows[r]))
  return {
    markdown: out.join('\n'),
    lignes: rows.length,
    colonnes,
    tronqueLignes: Math.max(0, rows.length - lignesGardees),
    tronqueColonnes: Math.max(0, colonnes - colGardees),
  }
}

/**
 * Convertit un classeur SheetJS complet en markdown : une section « ## Feuille
 * "Nom" » par feuille non vide, avec dimensions réelles et mentions de
 * troncature. `XLSX` = le module SheetJS fourni par l'appelant.
 */
export function classeurEnMarkdown(XLSX, workbook, {
  maxLignesParFeuille = TABLEUR_MAX_LIGNES_PAR_FEUILLE,
  maxColonnes = TABLEUR_MAX_COLONNES,
  maxChars = TABLEUR_MAX_CHARS,
} = {}) {
  const sections = []
  let total = 0
  let feuillesOmises = 0
  for (const nom of workbook.SheetNames || []) {
    const ws = workbook.Sheets?.[nom]
    if (!ws) continue
    // raw:false = valeurs telles qu'AFFICHÉES (dates, %, monnaies formatées).
    const matrice = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })
    const f = feuilleEnMarkdown(matrice, { maxLignes: maxLignesParFeuille, maxColonnes })
    if (!f.markdown) continue
    if (total >= maxChars) { feuillesOmises++; continue }
    const entete = `## Feuille « ${celluleMarkdown(nom) || 'Sans nom'} » — ${f.lignes} ligne${f.lignes > 1 ? 's' : ''} × ${f.colonnes} colonne${f.colonnes > 1 ? 's' : ''}`
    const notes = []
    if (f.tronqueLignes) notes.push(`… ${f.tronqueLignes} ligne${f.tronqueLignes > 1 ? 's' : ''} supplémentaire${f.tronqueLignes > 1 ? 's' : ''} non affichée${f.tronqueLignes > 1 ? 's' : ''} (classeur volumineux)`)
    if (f.tronqueColonnes) notes.push(`… ${f.tronqueColonnes} colonne${f.tronqueColonnes > 1 ? 's' : ''} au-delà de la ${maxColonnes}ᵉ non affichée${f.tronqueColonnes > 1 ? 's' : ''}`)
    const section = [entete, '', f.markdown, ...(notes.length ? ['', notes.join('\n')] : [])].join('\n')
    sections.push(section)
    total += section.length
  }
  if (!sections.length) {
    return { ok: false, error: 'Classeur lu mais sans données exploitables (feuilles vides).' }
  }
  if (feuillesOmises) {
    sections.push(`… ${feuillesOmises} feuille${feuillesOmises > 1 ? 's' : ''} supplémentaire${feuillesOmises > 1 ? 's' : ''} non affichée${feuillesOmises > 1 ? 's' : ''} (classeur volumineux).`)
  }
  return { ok: true, markdown: sections.join('\n\n').slice(0, maxChars) }
}

/** Extensions de classeur traitées par ce module (CSV/TSV restent du texte brut). */
export const TABLEUR_RE = /\.(xlsx|xlsm|xltx|xls|ods)$/i

/** Vrai si le nom de fichier désigne un classeur (Excel/ODS). */
export function estTableur(nomOuExt) {
  return TABLEUR_RE.test(String(nomOuExt || ''))
}
