/**
 * SIRAL — export TABLEUR (.xlsx) des productions qui contiennent des tableaux.
 *
 * Le pendant « données » des exports PDF/Word : quand l'attaché remet un
 * décompte, un échéancier, une liste chiffrée — structurés en tableaux
 * markdown dans le texte de la production — ce module les extrait et génère
 * un classeur Excel réel (SheetJS, déjà en dépendance) : une feuille par
 * tableau, nommée d'après le titre qui le précède, nombres français reconnus
 * (« 1 234,56 » devient une vraie valeur numérique triable et sommable),
 * largeurs de colonnes ajustées. Le texte de la production reste la source
 * unique : l'export se régénère à la demande, rien n'est stocké.
 */

import { acteFileBase, type ActeExportable } from './acteExport'

interface TableauExtrait {
  nom: string
  lignes: string[][]
}

/** Ligne de tableau markdown → cellules (sans les bords vides). */
function cellules(ligne: string): string[] {
  const cells = ligne.split('|')
  if (cells.length && !cells[0].trim()) cells.shift()
  if (cells.length && !cells[cells.length - 1].trim()) cells.pop()
  return cells.map((c) => c.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').trim())
}

const RE_LIGNE_TABLEAU = /^\s*\|.*\|\s*$/
const RE_SEPARATEUR = /^\s*\|[\s:|-]+\|\s*$/

/**
 * Extrait tous les tableaux markdown du texte, chacun nommé d'après le
 * dernier titre (« # », « ## », « ### ») rencontré avant lui.
 */
export function extraireTableaux(contenu: string): TableauExtrait[] {
  const lignes = String(contenu || '').replace(/\r\n?/g, '\n').split('\n')
  const out: TableauExtrait[] = []
  let titre = ''
  let courant: TableauExtrait | null = null
  for (const l of lignes) {
    const h = /^#{1,3}\s+(.+)$/.exec(l.trim())
    if (h) { titre = h[1].trim(); courant = null; continue }
    if (RE_LIGNE_TABLEAU.test(l)) {
      if (RE_SEPARATEUR.test(l)) continue
      if (!courant) {
        courant = { nom: titre, lignes: [] }
        out.push(courant)
      }
      courant.lignes.push(cellules(l))
    } else if (l.trim()) {
      courant = null // un texte entre deux blocs = deux tableaux distincts
    }
  }
  // Un « tableau » d'une seule ligne sans en-tête n'a rien à exporter.
  return out.filter((t) => t.lignes.length >= 2)
}

/** Vrai si la production contient au moins un tableau exportable. */
export function contientTableaux(contenu: string): boolean {
  return extraireTableaux(contenu).length > 0
}

/** « 1 234,56 » / « 12,5 » / « 1200 » → nombre ; sinon null. */
function nombreFr(s: string): number | null {
  const t = s.replace(/[\s  ]/g, '')
  if (!/^-?\d{1,15}(?:,\d+)?$/.test(t) && !/^-?\d{1,15}(?:\.\d+)?$/.test(t)) return null
  const n = Number(t.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** Nom de feuille Excel valide (31 caractères, sans []:*?/\), unique. */
function nomFeuille(brut: string, index: number, pris: Set<string>): string {
  let base = (brut || `Tableau ${index + 1}`).replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31)
  if (!base) base = `Tableau ${index + 1}`
  let nom = base
  let n = 2
  while (pris.has(nom.toLowerCase())) {
    const suffixe = ` (${n++})`
    nom = base.slice(0, 31 - suffixe.length) + suffixe
  }
  pris.add(nom.toLowerCase())
  return nom
}

/** Génère et télécharge le classeur .xlsx d'une production à tableaux. */
export async function downloadActeXlsx(p: ActeExportable): Promise<void> {
  const tableaux = extraireTableaux(p.contenu)
  if (!tableaux.length) throw new Error('Aucun tableau dans ce document')
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  const pris = new Set<string>()
  tableaux.forEach((t, i) => {
    const nbCols = Math.max(...t.lignes.map((l) => l.length))
    // Première ligne = en-tête (texte) ; ensuite, nombres français convertis.
    const aoa: Array<Array<string | number>> = t.lignes.map((l, r) =>
      Array.from({ length: nbCols }, (_, c) => {
        const cell = l[c] ?? ''
        if (r === 0) return cell
        const n = nombreFr(cell)
        return n === null ? cell : n
      }))
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!cols'] = Array.from({ length: nbCols }, (_, c) => ({
      wch: Math.min(48, Math.max(9, ...t.lignes.map((l) => String(l[c] ?? '').length + 2))),
    }))
    XLSX.utils.book_append_sheet(wb, ws, nomFeuille(t.nom, i, pris))
  })
  XLSX.writeFile(wb, acteFileBase(p) + '.xlsx')
}
