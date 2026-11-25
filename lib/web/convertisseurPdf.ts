/**
 * SIRAL — Convertisseur PDF → TXT, entièrement DANS le navigateur.
 *
 * Remplace l'ancien outil Python (CONVERTIR.bat) : les PDF, même enfouis dans
 * des ZIP de ZIP, sont lus ici et ne quittent jamais le poste. Un ZIP compte
 * comme un dossier (son nom sans « .zip »), si bien que la structure des
 * pochettes se retrouve telle quelle dans la sortie.
 *
 * Seule exception, à la demande : l'OCR des pages images (« Océriser »), fait
 * sur le serveur SIRAL. Seules ces pages y partent ; rien n'y est gardé.
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
  /** Après « Océriser » : toutes les pages images lues, ou une partie seulement. */
  ocr?: 'complet' | 'partiel'
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

// ── Livrables : fichiers globaux + un .txt par PDF, en ZIP (ou .txt seul) ──

export interface Livrables {
  globaux: { cle: string, nom: string, contenu: string, nb: number }[]
  fichiers: { nom: string, contenu: string }[]
  total: number
}

export function construireLivrables(resultats: ResultatPdf[], mode: ModeGlobal, niveau: number, individuels: boolean): Livrables {
  const parChemin = new Map(resultats.map(r => [r.chemin, r]))
  const groupes = grouper(resultats.map(r => r.chemin).sort(comparerChemins), mode, niveau)
  const noms = new Map<string, number>()
  const globaux = Array.from(groupes.entries()).map(([cle, liste]) => {
    let nom = nomGlobal(cle)
    const n = (noms.get(nom) || 0) + 1; noms.set(nom, n)
    if (n > 1) nom = nom.replace(/\.txt$/, ` (${n}).txt`)
    return { cle, nom, contenu: construireGlobal(cle, liste.map(c => parChemin.get(c)!).filter(Boolean)), nb: liste.length }
  })
  const fichiers = individuels
    ? resultats.filter(r => !r.erreur).map(r => ({ nom: r.chemin.replace(/\.pdf$/i, '.txt'), contenu: r.texte }))
    : []
  return { globaux, fichiers, total: globaux.length + fichiers.length }
}

/** Le fichier à télécharger : le .txt seul s'il n'y en a qu'un, sinon un ZIP nommé d'après la pochette. */
export async function paquetLivrables(l: Livrables, chemins: string[]): Promise<{ blob: Blob, nom: string }> {
  const seul = [...l.globaux.map(g => ({ nom: g.nom, contenu: g.contenu })), ...l.fichiers]
  if (seul.length === 1) return { blob: new Blob([seul[0].contenu], { type: 'text/plain;charset=utf-8' }), nom: seul[0].nom.split('/').pop()! }
  const PizZip = (await import('pizzip')).default
  const zip = new PizZip()
  l.globaux.forEach(g => zip.file(g.nom, g.contenu))
  l.fichiers.forEach(f => zip.file(f.nom, f.contenu))
  const racines = Array.from(new Set(chemins.map(c => c.split('/')[0])))
  const nom = racines.length === 1 && chemins[0]?.includes('/')
    ? `${racines[0]} - texte.zip`
    : `Conversion texte ${new Date().toLocaleDateString('fr-FR').replace(/\//g, '-')}.zip`
  return { blob: zip.generate({ type: 'blob', compression: 'DEFLATE' }) as Blob, nom }
}

// ── OCR des pages images (serveur SIRAL, à la demande) ──

const ROUTE_OCR = '/api/ocr'
/** Secondes par page avant toute mesure réelle (mesuré : ~1,3 s sur 2 cœurs, réseau en sus). */
export const SECONDES_PAR_PAGE = 2
/** En dessous, la page lue est signalée « à vérifier » dans le texte. */
const CONFIANCE_MIN = 0.85

const MARQUE = /\[page (\d+) : image sans couche texte\]/g

/** Numéros des pages marquées « image sans couche texte » dans un texte converti. */
export function pagesImages(texte: string): number[] {
  return Array.from(texte.matchAll(MARQUE), m => Number(m[1]))
}

/**
 * État de l'OCR pour cette session : `pret` ; `absent` (route 404 : service non
 * configuré, SIRAL_OCR_URL vide) ; `injoignable` (configuré mais ne répond pas :
 * conteneur arrêté, en construction ou en panne). Jamais mis en cache : un
 * service qui démarre est vu à la sonde suivante.
 */
export type EtatServiceOcr = 'pret' | 'absent' | 'injoignable'
export async function etatOcr(): Promise<EtatServiceOcr> {
  return (await chargeOcr()).etat
}

/** État + charge du service : requête en cours de calcul, requêtes en file (tous postes confondus). */
export interface ChargeOcr { etat: EtatServiceOcr, occupe: boolean, enAttente: number }
export async function chargeOcr(): Promise<ChargeOcr> {
  try {
    const r = await fetch(ROUTE_OCR, { credentials: 'same-origin', cache: 'no-store' })
    const d = await r.json().catch(() => ({})) as { occupe?: boolean, en_attente?: number }
    const etat: EtatServiceOcr = r.ok ? 'pret' : r.status === 404 ? 'absent' : 'injoignable'
    return { etat, occupe: Boolean(d.occupe), enAttente: Number(d.en_attente) || 0 }
  } catch {
    return { etat: 'injoignable', occupe: false, enAttente: 0 }
  }
}

function enBase64(octets: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < octets.length; i += 0x8000) bin += String.fromCharCode(...octets.subarray(i, i + 0x8000))
  return btoa(bin)
}

interface PageOcr { page: number, texte: string, confiance: number | null, erreur: string | null }

/** Pages images envoyées par requête : petites requêtes, aucune limite de taille. */
const LOT_OCR = 10

/**
 * Océrise les pages images d'un résultat et rend le résultat complété : chaque
 * marque est remplacée par le texte lu. Seules ces pages partent, découpées
 * ici en petits PDF (pdf-lib) de LOT_OCR pages : ni la taille du fichier, ni
 * ses pages de texte ne quittent le poste.
 * `progression(n)` reçoit le nombre de pages traitées à chaque retour.
 */
export async function ocriser(src: SourcePdf, r: ResultatPdf, progression?: (n: number) => void, annule?: () => boolean): Promise<ResultatPdf> {
  const { PDFDocument } = await import('pdf-lib')
  const original = await PDFDocument.load(await src.lire(), { ignoreEncryption: true })
  const pages = pagesImages(r.texte)
  const lues = new Map<number, PageOcr>()
  const tentees = new Set<number>()
  for (let i = 0; i < pages.length && !annule?.(); i += LOT_OCR) {
    const lot = pages.slice(i, i + LOT_OCR)
    const extrait = await PDFDocument.create()
    ;(await extrait.copyPages(original, lot.map(p => p - 1))).forEach(pg => extrait.addPage(pg))
    const res = await fetch(ROUTE_OCR, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ b64: enBase64(await extrait.save()), lignes: false }),
    })
    const data = await res.json().catch(() => ({})) as { ok?: boolean, error?: string, pages?: PageOcr[] }
    if (!res.ok || !data.ok) throw new Error(data.error || `OCR impossible (${res.status})`)
    for (const p of data.pages || []) if (!p.erreur) lues.set(lot[p.page - 1], p)
    lot.forEach(p => tentees.add(p))
    progression?.(lot.length)
  }
  let illisibles = 0
  let nonTentees = 0
  const texte = r.texte.replace(MARQUE, (marque, p) => {
    if (!tentees.has(Number(p))) { nonTentees++; return marque }
    const lu = lues.get(Number(p))
    const t = (lu?.texte || '').trim()
    if (t.replace(/\s/g, '').length < 25) { illisibles++; return marque }
    const conf = lu?.confiance ?? 1
    return conf < CONFIANCE_MIN
      ? `[page ${p} — texte restitué par OCR, confiance ${Math.round(conf * 100)} % : à vérifier sur l'original]\n${t}`
      : `[page ${p} — texte restitué par OCR]\n${t}`
  })
  const avertissements = [
    nonTentees ? `${nonTentees} page(s) image non océrisée(s) (OCR arrêté)` : '',
    illisibles ? `${illisibles} page(s) image restée(s) illisible(s) après OCR (photos, manuscrit…)` : '',
  ].filter(Boolean)
  return {
    ...r,
    texte,
    ocr: avertissements.length ? 'partiel' : 'complet',
    avertissement: avertissements.join(' · ') || undefined,
  }
}
