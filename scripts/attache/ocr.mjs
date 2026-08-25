/**
 * SIRAL — Attaché de justice · extraction PDF avec OCR de secours PAGE PAR PAGE.
 *
 * Deux réalités de terrain :
 *   - des pièces entièrement scannées (PV de motivation, retours de service)
 *     sans aucune couche texte ;
 *   - surtout, des pièces MIXTES : un PV tapé de quelques pages suivi
 *     d'annexes en images (captures de conversations, planches photo de
 *     perquisition, tapissages, rapports techniques) — le cœur probatoire.
 *     L'ancienne détection « document entier < 40 caractères » les déclarait
 *     lisibles et n'océrisait JAMAIS leurs annexes.
 *
 * Désormais : couche texte extraite PAGE PAR PAGE ; les pages muettes (< 25
 * caractères) passent à l'OCR local (poppler `pdftoppm` + `tesseract`, fra)
 * quand les binaires sont présents, dans la limite d'un plafond par pièce ;
 * chaque page restée illisible est MARQUÉE dans le texte rendu — jamais de
 * trou silencieux. Si rien n'est lisible, la pièce est dite ILLISIBLE et
 * l'attaché ne prépare rien dessus.
 *
 * Tout est borné (pages, résolution, délais) et gardé : la moindre erreur
 * retombe sur « illisible » ou une page marquée, jamais une exception qui
 * casserait la lecture.
 */
import { createRequire } from 'node:module'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'

// Rastérisation et OCR en ASYNCHRONE : ces commandes durent des dizaines de
// secondes par document, et en execFileSync elles gelaient l'event loop du
// service — pendant un OCR, l'attaché ne répondait plus à rien (chat, panneau,
// chantiers). Le processus externe travaille pareil ; le service, lui, reste
// disponible. Seul le sondage which/where (5 s max, une fois par binaire)
// reste synchrone.
const execFileAsync = promisify(execFile)
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)

// En-dessous de ce nombre de caractères, le DOCUMENT entier est considéré sans
// couche texte exploitable (PDF scanné / image).
const MIN_TEXT_CHARS = 40
// En-dessous, une PAGE est considérée muette (image) → candidate à l'OCR.
const PAGE_MIN_CHARS = 25
// Bornes de l'OCR (une lecture d'outil doit tenir dans le délai du connecteur —
// 180 s : ~30 pages à 2-5 s/page passent, et le résultat est mis en cache) :
const OCR_MAX_PAGES = 30
const OCR_DPI = 200
const PDFTOPPM_TIMEOUT_MS = 120_000
const TESSERACT_TIMEOUT_MS = 45_000

// Présence d'un binaire sur le PATH — mémoïsé (which/where).
const _bin = new Map()
function hasBinary(name) {
  if (_bin.has(name)) return _bin.get(name)
  let ok = false
  try {
    const finder = process.platform === 'win32' ? 'where' : 'which'
    execFileSync(finder, [name], { stdio: 'ignore', timeout: 5000 })
    ok = true
  } catch { ok = false }
  _bin.set(name, ok)
  return ok
}

/**
 * OCR d'une liste de pages précises d'un PDF. Les pages contiguës sont
 * rastérisées par plages (les numéros de page sont conservés dans les noms de
 * fichiers pdftoppm : page-05.png = page 5). Retourne { available, textes } où
 * textes est une Map<numéroDePage, texteOCR>. Ne lève jamais.
 */
async function ocrPages(plain, pageNums) {
  if (!pageNums.length) return { available: true, textes: new Map() }
  if (!hasBinary('pdftoppm') || !hasBinary('tesseract')) {
    return { available: false, textes: new Map() }
  }
  const textes = new Map()
  let dir
  try {
    dir = mkdtempSync(path.join(os.tmpdir(), 'siral-ocr-'))
    const pdfPath = path.join(dir, 'in.pdf')
    writeFileSync(pdfPath, plain)
    // pages triées → plages contiguës → un pdftoppm par plage
    const ranges = []
    for (const n of [...pageNums].sort((a, b) => a - b)) {
      const last = ranges[ranges.length - 1]
      if (last && n === last[1] + 1) last[1] = n
      else ranges.push([n, n])
    }
    for (const [f, l] of ranges) {
      try {
        await execFileAsync(
          'pdftoppm',
          ['-png', '-r', String(OCR_DPI), '-f', String(f), '-l', String(l), pdfPath, path.join(dir, 'page')],
          { timeout: PDFTOPPM_TIMEOUT_MS },
        )
      } catch { /* plage irrastérisable : ses pages resteront marquées */ }
    }
    for (const png of readdirSync(dir).filter((x) => /^page-\d+\.png$/i.test(x))) {
      const num = Number((png.match(/(\d+)\.png$/i) || [])[1])
      if (!Number.isFinite(num)) continue
      const base = path.join(dir, png.replace(/\.png$/i, ''))
      try {
        // tesseract <image> <base> -l fra → écrit <base>.txt
        await execFileAsync('tesseract', [path.join(dir, png), base, '-l', 'fra'], { timeout: TESSERACT_TIMEOUT_MS })
        textes.set(num, readFileSync(base + '.txt', 'utf8'))
      } catch { /* page sautée : restera marquée */ }
    }
    return { available: true, textes }
  } catch {
    return { available: true, textes }
  } finally {
    if (dir) { try { rmSync(dir, { recursive: true, force: true }) } catch { /* */ } }
  }
}

/**
 * Assemble le texte final page par page : couche texte native quand elle
 * existe, OCR sinon, et un MARQUEUR explicite pour toute page restée muette —
 * le lecteur (l'agent surtout) sait exactement ce qui manque et pourquoi.
 * `differees` : pages images volontairement NON océrisées (lecture par défaut,
 * économe) — le marqueur indique comment obtenir leur contenu à la demande.
 */
export function assemblePages(pagesTexte, ocrTextes, { ocrAvailable, nonOcrisees = [], differees = [] } = {}) {
  const maxOcr = ocrTextes.size ? Math.max(...ocrTextes.keys()) : 0
  const n = Math.max(pagesTexte.length, maxOcr)
  const out = []
  for (let p = 1; p <= n; p++) {
    const natif = String(pagesTexte[p - 1] || '').trim()
    if (natif.length >= PAGE_MIN_CHARS) { out.push(natif); continue }
    const ocr = String(ocrTextes.get(p) || '').trim()
    if (ocr.length >= PAGE_MIN_CHARS) {
      out.push(`[page ${p} — texte restitué par OCR]\n${ocr}`)
    } else if (natif || ocr) {
      out.push(natif || ocr)
    } else if (differees.includes(p)) {
      out.push(`[page ${p} : image sans couche texte — non océrisée par défaut ; relire avec integrale:true si son contenu est nécessaire]`)
    } else if (nonOcrisees.includes(p)) {
      out.push(`[page ${p} : image non océrisée — plafond de ${OCR_MAX_PAGES} pages OCR par pièce atteint]`)
    } else if (!ocrAvailable) {
      out.push(`[page ${p} : image sans couche texte — OCR indisponible sur le serveur (installer poppler-utils et tesseract-ocr/fra)]`)
    } else {
      out.push(`[page ${p} : image sans texte exploitable, même après OCR]`)
    }
  }
  return out.join('\n\n')
}

/**
 * Extrait le texte d'un PDF, PAGE PAR PAGE : couche texte native quand elle
 * existe, marqueur explicite pour toute page image. L'OCR des pages images
 * d'une pièce MIXTE (PV tapé + annexes) n'a lieu qu'À LA DEMANDE
 * (`ocrImages: true`) : le texte océrisé allonge chaque lecture faite ensuite
 * par l'agent — c'est un choix pièce par pièce, pas un réflexe. Un document
 * ENTIÈREMENT muet garde l'OCR de secours automatique (sinon rien n'est
 * lisible du tout). Ne lève jamais.
 * @param {Buffer} plain - PDF déchiffré
 * @param {{ocrImages?: boolean}} [opts]
 * @returns {Promise<{ok:true,texte:string,source:'texte'|'ocr'|'texte+ocr',pagesImagesNonLues?:number} | {ok:false,scanned:true,ocrAvailable:boolean,error:string}>}
 */
export async function extractPdfText(plain, { ocrImages = false } = {}) {
  // Un petit Buffer Node (< 4 Ko) vit dans le POOL partagé : pdf.js 1.10 lit
  // alors l'ArrayBuffer sous-jacent ENTIER (le pool, données étrangères
  // comprises) et échoue en « bad XRef entry ». Copie dans un ArrayBuffer
  // propre et exact — coût négligeable, correction indispensable.
  const data = new Uint8Array(plain)

  // 1) Couche texte native, page par page (l'ordre d'appel de pagerender est
  //    l'ordre des pages — pdf-parse les traite séquentiellement).
  const pagesTexte = []
  try {
    const pdfParse = require('pdf-parse/lib/pdf-parse.js')
    await pdfParse(data, {
      pagerender: async (pageData) => {
        const tc = await pageData.getTextContent()
        const txt = tc.items.map((it) => String(it.str || '')).join(' ')
        pagesTexte.push(txt)
        return txt
      },
    })
  } catch { /* structure illisible : pagesTexte vide → OCR intégral ci-dessous */ }

  const muettes = []
  pagesTexte.forEach((t, i) => { if (String(t).trim().length < PAGE_MIN_CHARS) muettes.push(i + 1) })

  // Document entièrement porté par sa couche texte : rien à océriser.
  if (pagesTexte.length && !muettes.length) {
    const texte = assemblePages(pagesTexte, new Map(), { ocrAvailable: true })
    if (texte.trim().length >= MIN_TEXT_CHARS) return { ok: true, texte, source: 'texte' }
  }

  // 2) Pages muettes. OCR seulement si demandé (ocrImages) OU si le document
  //    est ENTIÈREMENT muet — dans ce dernier cas il n'y a rien d'autre à lire.
  //    Structure illisible par pdf-parse : OCR « à l'aveugle » des premières
  //    pages (pdftoppm s'arrête de lui-même à la dernière page réelle).
  const documentEntierMuet = !pagesTexte.length || muettes.length >= pagesTexte.length
  const doOcr = ocrImages || documentEntierMuet
  const candidates = pagesTexte.length ? muettes : Array.from({ length: OCR_MAX_PAGES }, (_, i) => i + 1)
  const aOcr = doOcr ? candidates.slice(0, OCR_MAX_PAGES) : []
  const nonOcrisees = doOcr ? candidates.slice(OCR_MAX_PAGES) : []
  const differees = doOcr ? [] : candidates
  const { available, textes } = await ocrPages(plain, aOcr)

  const texte = assemblePages(pagesTexte, textes, { ocrAvailable: available, nonOcrisees, differees })
  // Lisible si un contenu réel subsiste une fois les marqueurs de pages retirés.
  const utile = texte.replace(/\[page \d+ : [^\]]*\]/g, '').trim()
  if (utile.length >= MIN_TEXT_CHARS) {
    const source = pagesTexte.length && muettes.length < pagesTexte.length
      ? (textes.size ? 'texte+ocr' : 'texte')
      : 'ocr'
    return { ok: true, texte, source, ...(differees.length ? { pagesImagesNonLues: differees.length } : {}) }
  }

  // 3) Illisible : on le dit franchement (l'attaché ne préparera rien dessus)
  return {
    ok: false,
    scanned: true,
    ocrAvailable: available,
    error: available
      ? 'PDF scanné : OCR de secours tenté mais aucun texte exploitable — pièce ILLISIBLE. Ne pas préparer d\'acte dessus ; demander une version lisible au service.'
      : 'PDF scanné sans couche texte, et OCR de secours indisponible sur le serveur — pièce ILLISIBLE. Ne pas préparer d\'acte dessus ; demander une version lisible au service.',
  }
}
