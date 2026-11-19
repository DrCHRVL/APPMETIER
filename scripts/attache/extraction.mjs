/**
 * SIRAL — Attaché de justice · extraction du texte d'une pièce.
 *
 * D'après l'extension : PDF (couche texte native, OCR de secours si scan),
 * texte/HTML bruts, bureautique (ODT/DOCX/RTF), classeurs (XLSX/XLS/ODS).
 */
import { extractPdfText } from './ocr.mjs'
import { extractOfficeText, isOfficeExt, extractSpreadsheetText, isSpreadsheetExt } from './officeText.mjs'

/**
 * Extrait le TEXTE d'une pièce déchiffrée d'après son extension : PDF (couche
 * texte native, OCR de secours si scan), texte/HTML bruts, bureautique
 * (ODT/DOCX/RTF). Renvoie { ok, texte, source?, tronque? } ou
 * { ok:false, error, scanned? }. `max` borne la longueur retournée.
 */
export async function extractTextByName(plain, name, { max = 200_000 } = {}) {
  const lower = String(name || '').toLowerCase()
  const bound = (t) => {
    const s = String(t)
    return { texte: s.slice(0, max), tronque: s.length > max }
  }
  if (lower.endsWith('.pdf')) {
    const res = await extractPdfText(plain)
    if (res.ok) return { ok: true, ...bound(res.texte), source: res.source }
    return { ok: false, error: res.error, scanned: res.scanned }
  }
  if (/\.(txt|html?|md|markdown|csv|json|eml)$/.test(lower)) {
    return { ok: true, ...bound(plain.toString('utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')) }
  }
  if (isOfficeExt(lower)) {
    const res = extractOfficeText(plain, lower)
    if (res.ok) return { ok: true, ...bound(res.texte), source: res.source }
    return { ok: false, error: res.error }
  }
  if (isSpreadsheetExt(lower)) {
    // Classeur Excel/ODS : chaque feuille arrive en tableau markdown — les
    // données se lisent et s'exploitent comme n'importe quelle pièce texte.
    const res = await extractSpreadsheetText(plain, lower)
    if (res.ok) return { ok: true, ...bound(res.texte), source: res.source }
    return { ok: false, error: res.error }
  }
  return { ok: false, error: `Type non textuel (${lower.split('.').pop()}) — ${plain.length} octets` }
}
