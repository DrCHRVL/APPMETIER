/**
 * SIRAL — test : OCR de TOUTES les pages images d'un PDF (plus de plafond).
 *
 * Avant : 30 pages OCR au plus par pièce, et les pages images d'une pièce
 * MIXTE (PV tapé + annexes) jamais océrisées par défaut — le texte partiel
 * était mis en cache et servait ensuite partout (recherche, registre,
 * dossier_global). Vérifie, avec un faux tesseract (pdftoppm réel requis) :
 *   - PDF mixte de 45 pages : les 44 pages images sont toutes océrisées ;
 *   - échéance dépassée : lecture marquée `partiel`, pages restantes marquées ;
 *   - texteDocumentIntegral : la copie markdown INCOMPLÈTE du téléversement est
 *     écartée au profit de l'original, et le texte complet est mis en cache.
 *
 *   node scripts/attache-ocr-complet.test.mjs
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
try { execFileSync('which', ['pdftoppm'], { stdio: 'ignore' }) } catch {
  console.log('pdftoppm absent (poppler-utils) — test sauté.')
  process.exit(0)
}
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-ocr-test-'))
const BIN = path.join(SCRATCH, 'bin')
fs.mkdirSync(BIN)
// Faux tesseract : « tesseract <image> <base> -l fra » → <base>.txt
fs.writeFileSync(path.join(BIN, 'tesseract'), `#!/usr/bin/env node
const [img, base] = process.argv.slice(2)
const n = Number((img.match(/(\\d+)\\.png$/) || [])[1])
require('fs').writeFileSync(base + '.txt', 'OCR page ' + n + ' — texte restitué depuis l\\'image')
`)
fs.chmodSync(path.join(BIN, 'tesseract'), 0o755)
process.env.PATH = `${BIN}:${process.env.PATH}`

/** PDF minimal : page 1 avec du texte, pages 2..n blanches (muettes). */
function pdfMixte(n) {
  const objs = []
  const kids = []
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  let id = 4
  for (let p = 1; p <= n; p++) {
    const flux = p === 1 ? 'BT /F1 12 Tf 50 750 Td (Proces-verbal d audition de DUPONT Jean, page tapee) Tj ET' : ''
    objs[id] = `<< /Length ${flux.length} >>\nstream\n${flux}\nendstream`
    objs[id + 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id} 0 R >>`
    kids.push(`${id + 1} 0 R`)
    id += 2
  }
  objs[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${n} >>`
  let out = '%PDF-1.4\n'
  const offsets = []
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = Buffer.byteLength(out)
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`
  }
  const xref = Buffer.byteLength(out)
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`
  for (let i = 1; i < objs.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

const echecs = []
function attendu(nom, cond, detail) {
  console.log(`${cond ? '✅' : '❌'} ${nom}${detail ? ' — ' + detail : ''}`)
  if (!cond) echecs.push(nom)
}

const { extractPdfText } = await import(`${REPO}/scripts/attache/ocr.mjs`)
const PDF = pdfMixte(45)

const r = await extractPdfText(PDF)
const ocrs = (r.texte?.match(/OCR page \d+/g) || []).length
attendu('PDF mixte : page tapée lue par sa couche texte', /DUPONT Jean/.test(r.texte || ''))
attendu('PDF mixte : les 44 pages images TOUTES océrisées (plus de plafond de 30)', ocrs === 44, `${ocrs} page(s) OCR`)
attendu('PDF mixte : page 45 comprise', /OCR page 45\b/.test(r.texte || ''))
attendu('aucune page marquée « non océrisée »', !/non océrisée/.test(r.texte || ''))
attendu('lecture complète non marquée partielle', !r.partiel)

const r2 = await extractPdfText(PDF, { echeance: Date.now() - 1 })
attendu('échéance dépassée : lecture marquée partielle', r2.partiel === true)
attendu('échéance dépassée : pages restantes MARQUÉES, jamais un trou muet', /\[page 2 : image non océrisée\]/.test(r2.texte || ''))

// ── Chaîne complète : copie markdown incomplète écartée, cache intégral ──
process.env.SIRAL_DATA_DIR = path.join(SCRATCH, 'data')
process.env.SIRAL_ATTACHE_MASTER_KEY = crypto.randomBytes(32).toString('hex')
fs.mkdirSync(path.join(SCRATCH, 'data', 'vaults'), { recursive: true })
const { encryptDocBlob } = await import(`${REPO}/scripts/attache/crypto.mjs`)
const { grantKeyring, loadKeyring } = await import(`${REPO}/scripts/attache/keyring.mjs`)
const { writeDocBlob, attacheTj } = await import(`${REPO}/scripts/attache/store.mjs`)
const { texteDocumentIntegral } = await import(`${REPO}/scripts/attache/dossier.mjs`)
const keyGlobal = crypto.randomBytes(32)
grantKeyring({ global: keyGlobal.toString('base64') }, 'test')
const keys = loadKeyring()
const KEY = 'OCRTEST'
writeDocBlob(attacheTj(), KEY, 'PV/annexes.pdf', encryptDocBlob(keyGlobal, PDF), { savedBy: 'test' })
// copie du navigateur : pages images seulement MARQUÉES (pas d'OCR navigateur)
const copie = 'Proces-verbal d audition de DUPONT Jean\n\n' + Array.from({ length: 44 }, (_, i) => `[page ${i + 2} : image sans couche texte]`).join('\n\n')
writeDocBlob(attacheTj(), KEY, 'MD/PV/annexes.md', encryptDocBlob(keyGlobal, Buffer.from(copie, 'utf8')), { savedBy: 'test' })

const lu = await texteDocumentIntegral(keys, KEY, 'PV/annexes.pdf')
attendu('copie markdown incomplète ÉCARTÉE : l\'original est relu avec OCR', lu.ok && /OCR page 44\b/.test(lu.texte), JSON.stringify(lu.extra))
const relu = await texteDocumentIntegral(keys, KEY, 'PV/annexes.pdf', { extraire: false })
attendu('texte complet mis en cache (relu sans extraction)', relu.ok && relu.extra?.cache === true && /OCR page 45\b/.test(relu.texte))

fs.rmSync(SCRATCH, { recursive: true, force: true })
if (echecs.length) { console.log(`\n${echecs.length} échec(s).`); process.exit(1) }
console.log('\nTous les tests passent.')
