/**
 * SIRAL — test : fiches et entités refaites quand l'OCR complète une pièce.
 *
 * Une pièce fichée AVANT la lecture intégrale l'a été sur une copie markdown
 * sans OCR (annexes marquées, vides) : sa fiche et ses entités ignorent les
 * annexes. L'ingestion doit (1) relever les entités sur le texte complet,
 * (2) remettre la fiche à faire — la nouvelle fiche porte `texteComplet` et le
 * rapport du dossier change de signature —, sans toucher à une fiche dont la
 * source était complète. Une pièce pas encore extraite est extraite par
 * l'étape des fiches au lieu d'y compter un échec.
 *
 *   node scripts/attache-fiches-apres-ocr.test.mjs
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
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-fiches-ocr-'))
const BIN = path.join(SCRATCH, 'bin')
fs.mkdirSync(BIN)
// Faux tesseract : l'annexe (page 2) porte un numéro de téléphone
fs.writeFileSync(path.join(BIN, 'tesseract'), `#!/usr/bin/env node
const [img, base] = process.argv.slice(2)
const n = Number((img.match(/(\\d+)\\.png$/) || [])[1])
require('fs').writeFileSync(base + '.txt', n === 2 ? 'Capture : contact Théo FONTAINE 07 81 76 72 88 — annexe' : 'OCR page ' + n + ' — sans objet particulier')
`)
// Faux CLI : une fiche par pièce jointe, nommant ce que le texte contient
fs.writeFileSync(path.join(BIN, 'claude'), `#!/usr/bin/env node
const prompt = require('fs').readFileSync(0, 'utf8')
const blocs = prompt.split('═══ PIÈCE ').slice(1)
const fiches = blocs.map((b) => {
  const chemin = b.slice(0, b.indexOf(' ═══'))
  return { chemin, type: 'PV audition', personnes: /FONTAINE/.test(b) ? [{ nom: 'FONTAINE Théo' }] : [], resume: /FONTAINE/.test(b) ? 'annexe lue' : 'sans annexe' }
})
process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: JSON.stringify(fiches), usage: { input_tokens: 1, output_tokens: 1 } }))
`)
for (const f of ['tesseract', 'claude']) fs.chmodSync(path.join(BIN, f), 0o755)
process.env.PATH = `${BIN}:${process.env.PATH}`
process.env.SIRAL_ATTACHE_CLAUDE_BIN = path.join(BIN, 'claude')
process.env.SIRAL_DATA_DIR = path.join(SCRATCH, 'data')
process.env.SIRAL_ATTACHE_MASTER_KEY = crypto.randomBytes(32).toString('hex')
fs.mkdirSync(path.join(SCRATCH, 'data', 'vaults'), { recursive: true })

/** PDF : page 1 tapée, pages 2..n blanches (images). */
function pdfMixte(n) {
  const objs = []; const kids = []
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  let id = 4
  for (let p = 1; p <= n; p++) {
    const flux = p === 1 ? 'BT /F1 12 Tf 50 750 Td (Proces-verbal d audition de LAMBERT Antoine, page tapee) Tj ET' : ''
    objs[id] = `<< /Length ${flux.length} >>\nstream\n${flux}\nendstream`
    objs[id + 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id} 0 R >>`
    kids.push(`${id + 1} 0 R`); id += 2
  }
  objs[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${n} >>`
  let out = '%PDF-1.4\n'; const off = []
  for (let i = 1; i < objs.length; i++) { off[i] = Buffer.byteLength(out); out += `${i} 0 obj\n${objs[i]}\nendobj\n` }
  const x = Buffer.byteLength(out)
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n` + off.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

const echecs = []
function attendu(nom, cond, detail) {
  console.log(`${cond ? '✅' : '❌'} ${nom}${detail ? ' — ' + detail : ''}`)
  if (!cond) echecs.push(nom)
}

const { encryptDocBlob } = await import(`${REPO}/scripts/attache/crypto.mjs`)
const { grantKeyring, loadKeyring } = await import(`${REPO}/scripts/attache/keyring.mjs`)
const { writeDocBlob, attacheTj } = await import(`${REPO}/scripts/attache/store.mjs`)
const { readRegistre, writeRegistre, registreFichesStep } = await import(`${REPO}/scripts/attache/registre.mjs`)
const { ingestPass } = await import(`${REPO}/scripts/attache/ingest.mjs`)
const keyGlobal = crypto.randomBytes(32)
grantKeyring({ global: keyGlobal.toString('base64') }, 'test')
const keys = loadKeyring()
const KEY = 'FICHESOCR'
const SHA = {}
const verse = (rel, buf) => { SHA[rel] = crypto.createHash('sha256').update(buf).digest('hex'); writeDocBlob(attacheTj(), KEY, rel, encryptDocBlob(keyGlobal, buf), { savedBy: 'test' }) }

// Pièce mixte + copie markdown SANS OCR (comme le navigateur la produit)
verse('PV/annexes.pdf', pdfMixte(3))
verse('MD/PV/annexes.md', Buffer.from('Proces-verbal d audition de LAMBERT Antoine\n\n[page 2 : image sans couche texte]\n\n[page 3 : image sans couche texte]', 'utf8'))
// Pièce témoin : texte complet, fiche à conserver
verse('PV/temoin.txt', Buffer.from('Audition du témoin DUPONT, rien d\'autre.', 'utf8'))

// État « d'avant » : fiches et entités faites sur les copies sans OCR
const reg = readRegistre(keys, KEY)
reg.pieces['PV/annexes.pdf'] = { sha: SHA['PV/annexes.pdf'], entites: { tel: [], plaque: [], iban: [], adresse: [] }, fiche: { type: 'PV audition', personnes: [{ nom: 'LAMBERT Antoine' }], resume: 'audition seule', integrale: true, majLe: '2026-10-01T00:00:00.000Z' } }
reg.pieces['PV/temoin.txt'] = { sha: SHA['PV/temoin.txt'], entites: { tel: [], plaque: [], iban: [], adresse: [] }, fiche: { type: 'PV audition', personnes: [{ nom: 'DUPONT' }], resume: 'témoin', integrale: true, majLe: '2026-10-01T00:00:00.000Z' } }
writeRegistre(keys, KEY, reg)

await ingestPass(keys, { docKeys: [KEY] })
let r = readRegistre(keys, KEY)
const a = r.pieces['PV/annexes.pdf']
attendu('entités relevées sur le texte COMPLET (téléphone de l\'annexe océrisée)', JSON.stringify(a.entites).includes('0781767288'), JSON.stringify(a.entites))
attendu('fiche faite sur la copie sans OCR : remise à faire', !a.fiche)
attendu('fiche dont la source était complète : CONSERVÉE', r.pieces['PV/temoin.txt'].fiche?.resume === 'témoin')

await registreFichesStep(keys, { docKey: KEY })
r = readRegistre(keys, KEY)
const f = r.pieces['PV/annexes.pdf'].fiche
attendu('fiche refaite sur le texte intégral (annexe lue), marquée texteComplet', f?.texteComplet === true && f?.personnes?.some((p) => /FONTAINE/.test(p.nom)), JSON.stringify(f))

// Seconde ingestion : rien n'est refait (pas de boucle)
await ingestPass(keys, { docKeys: [KEY] })
r = readRegistre(keys, KEY)
attendu('pas de boucle : la fiche refaite reste en place', r.pieces['PV/annexes.pdf'].fiche?.texteComplet === true)

// Pièce versée mais pas encore extraite : l'étape des fiches l'extrait elle-même
verse('PV/neuve.pdf', pdfMixte(2))
const reg2 = readRegistre(keys, KEY)
reg2.pieces['PV/neuve.pdf'] = { sha: SHA['PV/neuve.pdf'], entites: { tel: [], plaque: [], iban: [], adresse: [] }, texteComplet: true }
writeRegistre(keys, KEY, reg2)
await registreFichesStep(keys, { docKey: KEY })
r = readRegistre(keys, KEY)
attendu('pièce non encore extraite : fichée (extraction faite), aucun échec compté', Boolean(r.pieces['PV/neuve.pdf'].fiche) && !r.pieces['PV/neuve.pdf'].ficheEchecs, JSON.stringify(r.pieces['PV/neuve.pdf']))

fs.rmSync(SCRATCH, { recursive: true, force: true })
if (echecs.length) { console.log(`\n${echecs.length} échec(s).`); process.exit(1) }
console.log('\nTous les tests passent.')
