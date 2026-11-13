/**
 * SIRAL — Convertisseur PDF → TXT, entièrement DANS le navigateur.
 *
 * Remplace l'ancien outil Python (CONVERTIR.bat) : les PDF, même enfouis dans
 * des ZIP de ZIP, sont lus ici et ne quittent jamais le poste. Un ZIP compte
 * comme un dossier (son nom sans « .zip »), si bien que la structure des
 * pochettes se retrouve telle quelle dans la sortie.
 */

import { zipEntries, pdfToMarkdown } from '@/lib/web/fileToMarkdown'

export interface SourcePdf {
  /** Chemin relatif « Dossier/Sous-dossier/piece.pdf » (séparateur « / »). */
  chemin: string
  lire: () => Promise<Uint8Array>
}

export interface Depot {
  chemin: string
  file: File
}

export interface ResultatPdf {
  chemin: string
  texte: string
  avertissement?: string
  erreur?: string
}

const estPdf = (n: string) => /\.pdf$/i.test(n)
const estZip = (n: string) => /\.zip$/i.test(n)
const ignore = (n: string) => n.split('/').some(s => s === '__MACOSX' || s.startsWith('.'))

export const comparerChemins = (a: string, b: string) =>
  a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' })

/** Déroule fichiers, dossiers et ZIP (récursivement) en une liste de PDF. */
export async function collecterPdfs(depots: Depot[]): Promise<{ pdfs: SourcePdf[]; ignores: string[] }> {
  const pdfs: SourcePdf[] = []
  const ignores: string[] = []

  async function ouvrirZip(base: string, bytes: Uint8Array) {
    const entrees = await zipEntries(bytes)
    if (!entrees.length) { ignores.push(`${base}.zip (archive illisible ou chiffrée)`); return }
    for (const e of entrees) {
      if (ignore(e.name)) continue
      const chemin = `${base}/${e.name}`
      if (estPdf(e.name)) { const d = e.data; pdfs.push({ chemin, lire: async () => d }) }
      else if (estZip(e.name)) await ouvrirZip(chemin.replace(/\.zip$/i, ''), e.data)
      else ignores.push(chemin)
    }
  }

  for (const d of depots) {
    if (ignore(d.chemin)) continue
    if (estPdf(d.chemin)) pdfs.push({ chemin: d.chemin, lire: async () => new Uint8Array(await d.file.arrayBuffer()) })
    else if (estZip(d.chemin)) await ouvrirZip(d.chemin.replace(/\.zip$/i, ''), new Uint8Array(await d.file.arrayBuffer()))
    else ignores.push(d.chemin)
  }

  // doublons (même pochette déposée deux fois) : on garde la première
  const vus = new Set<string>()
  const uniques = pdfs.filter(p => (vus.has(p.chemin) ? false : (vus.add(p.chemin), true)))
  uniques.sort((a, b) => comparerChemins(a.chemin, b.chemin))
  return { pdfs: uniques, ignores }
}

export async function convertirPdf(src: SourcePdf): Promise<ResultatPdf> {
  try {
    const { markdown, avertissement } = await pdfToMarkdown(await src.lire())
    return {
      chemin: src.chemin,
      texte: markdown,
      avertissement: avertissement && /scann/i.test(avertissement)
        ? 'PDF scanné (image) : pas de texte extractible, OCR nécessaire'
        : avertissement,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const erreur = /password/i.test(msg) || (e as { name?: string })?.name === 'PasswordException'
      ? 'protégé par mot de passe' : msg
    return { chemin: src.chemin, texte: '', erreur }
  }
}

// ── Regroupement des fichiers globaux ──

export type ModeGlobal = 'aucun' | 'unique' | 'parDossier'

/**
 * Profondeur de départ du mode « un global par dossier » : on descend tant que
 * TOUT est dans un seul et même dossier. Déposer un ZIP qui contient trois
 * dossiers donne donc trois globaux, comme déposer les trois ZIP directement.
 */
export function niveauAuto(chemins: string[]): number {
  let d = 0
  for (;;) {
    const segs = chemins.map(c => c.split('/'))
    if (!segs.length || segs.some(s => s.length <= d + 1)) return d
    const premier = segs[0][d]
    if (segs.some(s => s[d] !== premier)) return d
    d++
  }
}

/** Profondeur maximale utile (au-delà, chaque global ne contiendrait qu'un fichier isolé). */
export function niveauMax(chemins: string[]): number {
  return Math.max(0, ...chemins.map(c => c.split('/').length - 2))
}

export const LIBELLE_RACINE = 'Pièces isolées'

/** Clé de groupe d'un PDF à une profondeur donnée : le chemin du dossier à ce niveau. */
export function cleGroupe(chemin: string, niveau: number): string {
  const segs = chemin.split('/')
  if (segs.length <= niveau + 1) {
    // fichier posé au-dessus du niveau choisi : rangé avec son propre dossier
    return segs.length > 1 ? segs.slice(0, -1).join('/') : LIBELLE_RACINE
  }
  return segs.slice(0, niveau + 1).join('/')
}

export function grouper(chemins: string[], mode: ModeGlobal, niveau: number): Map<string, string[]> {
  const groupes = new Map<string, string[]>()
  if (mode === 'aucun') return groupes
  for (const c of [...chemins].sort(comparerChemins)) {
    const cle = mode === 'unique' ? 'TOUS LES DOCUMENTS' : cleGroupe(c, niveau)
    if (!groupes.has(cle)) groupes.set(cle, [])
    groupes.get(cle)!.push(c)
  }
  return groupes
}

export const nomGlobal = (cle: string) =>
  `GLOBAL - ${cle.split('/').pop()!.replace(/[\\:*?"<>|]/g, '_')}.txt`

export function construireGlobal(cle: string, resultats: ResultatPdf[]): string {
  const sep = '='.repeat(80)
  const out: string[] = [
    `FICHIER GLOBAL — ${cle}`,
    sep,
    `Documents : ${resultats.length}    ·    Généré par SIRAL le ${new Date().toLocaleString('fr-FR')}`,
    '',
    'SOMMAIRE',
    '-'.repeat(40),
    ...resultats.map((r, i) => `${String(i + 1).padStart(3)}. ${r.chemin}`),
    '',
  ]
  resultats.forEach((r, i) => {
    out.push(sep, `[${i + 1}] ${r.chemin}`, sep, '')
    if (r.erreur) out.push(`[ÉCHEC DE LA CONVERSION : ${r.erreur}]`)
    else {
      if (r.avertissement) out.push(`[${r.avertissement}]`, '')
      out.push(r.texte.trim())
    }
    out.push('')
  })
  out.push(sep, 'FIN DU FICHIER GLOBAL')
  return out.join('\n')
}

/** Lit un glisser-déposer en conservant l'arborescence des dossiers déposés. */
export async function lireDataTransfer(dt: DataTransfer): Promise<Depot[]> {
  // les entrées doivent être prises AVANT tout await : le DataTransfer se vide ensuite
  const racines = Array.from(dt.items)
    .map(it => (it.kind === 'file' ? it.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => !!e)

  if (!racines.length) return Array.from(dt.files).map(file => ({ chemin: file.name, file }))

  const out: Depot[] = []
  async function parcourir(e: FileSystemEntry) {
    if (e.isFile) {
      const file = await new Promise<File>((ok, ko) => (e as FileSystemFileEntry).file(ok, ko))
      out.push({ chemin: e.fullPath.replace(/^\//, ''), file })
    } else if (e.isDirectory) {
      const lecteur = (e as FileSystemDirectoryEntry).createReader()
      // readEntries rend les entrées par paquets : on boucle jusqu'au paquet vide
      for (;;) {
        const lot = await new Promise<FileSystemEntry[]>((ok, ko) => lecteur.readEntries(ok, ko))
        if (!lot.length) break
        for (const x of lot) await parcourir(x)
      }
    }
  }
  for (const r of racines) await parcourir(r)
  return out
}
