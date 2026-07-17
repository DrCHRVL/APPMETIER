/**
 * SIRAL — Attaché de justice · OCR de secours.
 *
 * Certaines pièces (PV de motivation scannés, retours de service) arrivent en
 * PDF IMAGE, sans couche texte : pdf-parse renvoie alors du vide. Plutôt que de
 * laisser l'attaché travailler « à l'aveugle » — et rédiger un acte sur un
 * contenu qu'il n'a pas réellement lu — on :
 *   1) détecte l'absence de couche texte (scan) ;
 *   2) tente un OCR de secours LOCAL (poppler `pdftoppm` + `tesseract`, fra)
 *      quand ces binaires sont présents sur le serveur ;
 *   3) sinon (ou si l'OCR ne rend rien), signale clairement la pièce ILLISIBLE —
 *      l'attaché ne doit PAS préparer d'acte dessus (voir prompt), mais demander
 *      une version lisible.
 *
 * Tout est borné (pages, résolution, délais) et gardé : la moindre erreur
 * retombe sur « illisible », jamais une exception qui casserait la lecture.
 */
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)

// En-dessous de ce nombre de caractères, on considère qu'il n'y a pas de couche
// texte exploitable (PDF scanné / image).
const MIN_TEXT_CHARS = 40
// Bornes de l'OCR de secours (une motivation fait quelques pages) :
const OCR_MAX_PAGES = 6
const OCR_DPI = 200
const PDFTOPPM_TIMEOUT_MS = 90_000
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

/** OCR de secours d'un PDF scanné. Retourne { ok, available, texte }. */
function ocrPdf(plain) {
  if (!hasBinary('pdftoppm') || !hasBinary('tesseract')) {
    return { ok: false, available: false, texte: '' }
  }
  let dir
  try {
    dir = mkdtempSync(path.join(os.tmpdir(), 'siral-ocr-'))
    const pdfPath = path.join(dir, 'in.pdf')
    writeFileSync(pdfPath, plain)
    // Rastérise les premières pages en PNG (bornes : pages + résolution).
    execFileSync(
      'pdftoppm',
      ['-png', '-r', String(OCR_DPI), '-f', '1', '-l', String(OCR_MAX_PAGES), pdfPath, path.join(dir, 'page')],
      { stdio: 'ignore', timeout: PDFTOPPM_TIMEOUT_MS },
    )
    const pages = readdirSync(dir).filter((f) => /\.png$/i.test(f)).sort()
    let out = ''
    for (const p of pages) {
      const base = path.join(dir, p.replace(/\.png$/i, ''))
      // tesseract <image> <base> -l fra → écrit <base>.txt
      execFileSync('tesseract', [path.join(dir, p), base, '-l', 'fra'], { stdio: 'ignore', timeout: TESSERACT_TIMEOUT_MS })
      try { out += readFileSync(base + '.txt', 'utf8') + '\n' } catch { /* page sautée */ }
    }
    return { ok: true, available: true, texte: out }
  } catch {
    return { ok: false, available: true, texte: '' }
  } finally {
    if (dir) { try { rmSync(dir, { recursive: true, force: true }) } catch { /* */ } }
  }
}

/**
 * Extrait le texte d'un PDF : couche texte native d'abord, OCR de secours si la
 * pièce est un scan sans texte. Ne lève jamais.
 * @param {Buffer} plain - PDF déchiffré
 * @returns {Promise<{ok:true,texte:string,source:'texte'|'ocr'} | {ok:false,scanned:true,ocrAvailable:boolean,error:string}>}
 */
export async function extractPdfText(plain) {
  // 1) Couche texte native
  let text = ''
  try {
    const pdfParse = require('pdf-parse/lib/pdf-parse.js')
    const parsed = await pdfParse(plain)
    text = String(parsed.text || '').trim()
  } catch { /* pas de couche texte exploitable → on tente l'OCR */ }
  if (text.length >= MIN_TEXT_CHARS) {
    return { ok: true, texte: text, source: 'texte' }
  }

  // 2) Scan probable → OCR de secours (si disponible sur le serveur)
  const ocr = ocrPdf(plain)
  if (ocr.ok && ocr.texte.trim().length >= MIN_TEXT_CHARS) {
    return { ok: true, texte: ocr.texte, source: 'ocr' }
  }

  // 3) Illisible : on le dit franchement (l'attaché ne préparera rien dessus)
  return {
    ok: false,
    scanned: true,
    ocrAvailable: ocr.available,
    error: ocr.available
      ? 'PDF scanné : OCR de secours tenté mais aucun texte exploitable — pièce ILLISIBLE. Ne pas préparer d\'acte dessus ; demander une version lisible au service.'
      : 'PDF scanné sans couche texte, et OCR de secours indisponible sur le serveur — pièce ILLISIBLE. Ne pas préparer d\'acte dessus ; demander une version lisible au service.',
  }
}
