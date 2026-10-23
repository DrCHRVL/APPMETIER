/**
 * SIRAL — lecture d'une pièce d'entraide par le service attaché
 * (scripts/attache/entraideAnalyse.mjs).
 *
 * Un faux CLI `claude` rend une réponse en partie fausse (mesure hors
 * catalogue, date mal formée, pays en minuscules) : on vérifie que la fiche
 * de lecture est filtrée, que la pièce n'est pas conservée, que la lecture
 * est stockée chiffrée et relue, et que la consommation est consignée.
 *
 *   node scripts/attache-entraide-lecture.test.mjs
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument, StandardFonts } from 'pdf-lib'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-entraide-lecture-'))
process.env.SIRAL_DATA_DIR = path.join(SCRATCH, 'data')
fs.mkdirSync(path.join(process.env.SIRAL_DATA_DIR, 'vaults'), { recursive: true })
process.env.SIRAL_ATTACHE_MASTER_KEY = crypto.randomBytes(32).toString('hex')

// Faux CLI : capture le prompt, rend une enveloppe JSON avec un bilan de jetons.
const PROMPT = path.join(SCRATCH, 'prompt.txt')
const FAUX = path.join(SCRATCH, 'claude')
const reponse = {
  synthese: 'Le 13/08/2023, M. Paul X. aurait quitté les lieux d’un accident à Tournai.',
  demande: 'Entendre M. Paul X. en qualité de témoin et vérifier son adresse.',
  mesures: ['audition_temoin', 'verification_adresse', 'mesure_inventee'],
  lieux: [{ ville: 'Montdidier', adresse: '34 avenue Saint-Louis', role: 'domicile' }],
  personnes: [{ nom: 'X. Paul', qualite: 'témoin', naissance: '02/05/1990 à Compiègne' }, { qualite: 'sans nom' }],
  autorite: { nom: 'Parquet du Procureur du Roi de Mons', ville: 'Tournai', pays: 'belgique', reference: 'TO.12.L1.2023' },
  pays: 'belgique', type: 'dee', sens: 'recue', dateButoir: '15/12/2026', vigilance: ['Adresse à confirmer'],
}
fs.writeFileSync(FAUX, `#!/usr/bin/env node
const i = process.argv.indexOf('-p'); require('fs').writeFileSync(${JSON.stringify(PROMPT)}, process.argv[i + 1])
process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: '\`\`\`json\\n' + ${JSON.stringify(JSON.stringify(reponse))} + '\\n\`\`\`', usage: { input_tokens: 1200, output_tokens: 300 }, total_cost_usd: 0.01 }))
`)
fs.chmodSync(FAUX, 0o755)
process.env.SIRAL_ATTACHE_CLAUDE_BIN = FAUX

const { lirePieceEntraide, sauverLecture, lireLectures } = await import(`${REPO}/scripts/attache/entraideAnalyse.mjs`)
const { attacheDir } = await import(`${REPO}/scripts/attache/store.mjs`)

const echecs = []
function attendu(nom, cond, detail) {
  console.log(`${cond ? '✅' : '❌'} ${nom}${detail ? ' — ' + detail : ''}`)
  if (!cond) echecs.push(nom)
}

// Une DEE minimale en PDF texte.
const pdf = await PDFDocument.create()
const page = pdf.addPage()
const font = await pdf.embedFont(StandardFonts.Helvetica)
const lignes = [
  'DECISION D ENQUETE EUROPEENNE - ANNEXE A',
  'Section A : Autorite d emission : Parquet du Procureur du Roi de Mons, division de Tournai (Belgique)',
  'Reference : TO.12.L1.2023',
  'Section C : mesures d enquete : audition en qualite de temoin de M. Paul X., ne le 02/05/1990 a Compiegne,',
  'demeurant 34 avenue Saint-Louis a Montdidier ; verification de son adresse.',
  'Section G : faits : delit de fuite le 13/08/2023 a Tournai.',
]
lignes.forEach((l, i) => page.drawText(l, { x: 30, y: 780 - i * 18, size: 9, font }))
const octets = Buffer.from(await pdf.save())

const r = await lirePieceEntraide({ nom: 'DEE-Tournai.pdf', octets })
attendu('lecture ok', r.ok, r.error)
const a = r.analyse || {}
attendu('texte de la pièce transmis au modèle', /Montdidier/.test(fs.readFileSync(PROMPT, 'utf8')))
attendu('catalogue des mesures fourni au modèle', /audition_temoin : Audition d’un témoin/.test(fs.readFileSync(PROMPT, 'utf8')))
attendu('mesure hors catalogue écartée', JSON.stringify(a.mesures) === '["audition_temoin","verification_adresse"]')
attendu('pays normalisé', a.pays === 'Belgique' && a.autorite?.pays === 'Belgique')
attendu('date butoir mal formée ignorée', a.dateButoir === '')
attendu('personne sans nom écartée', a.personnes?.length === 1 && a.personnes[0].nom === 'X. Paul')
attendu('lieu d’exécution conservé', a.lieux?.[0]?.ville === 'Montdidier')
attendu('provenance renseignée', a.piece === 'DEE-Tournai.pdf' && a.source === 'texte')

const usage = fs.readFileSync(attacheDir('usage.jsonl'), 'utf8')
attendu('consommation consignée', usage.trim().split('\n').length === 1)

// Stockage chiffré de la fiche de lecture, jamais de la pièce.
const keys = { global: crypto.randomBytes(32) }
await sauverLecture(keys, 'd123', a)
await sauverLecture(keys, 'd123', { ...a, synthese: 'seconde lecture' })
const relues = lireLectures(keys, 'd123')
attendu('lectures relues, la plus récente d’abord', relues.length === 2 && relues[0].synthese === 'seconde lecture')
const brut = fs.readFileSync(attacheDir('entraide-analyses', 'd123.json'), 'utf8')
attendu('fiche de lecture chiffrée sur disque', !brut.includes('Montdidier') && !brut.includes('Paul'))
const fichiers = fs.readdirSync(process.env.SIRAL_DATA_DIR, { recursive: true }).map(String)
attendu('aucune copie de la pièce conservée', !fichiers.some((f) => /\.pdf/i.test(f)))
attendu('autre clé : rien de lisible', lireLectures({ global: crypto.randomBytes(32) }, 'd123').length === 0)

const vide = await lirePieceEntraide({ nom: 'vide.txt', octets: Buffer.from('trop court') })
attendu('pièce sans texte : refus clair', !vide.ok && /peu de texte/.test(vide.error))

fs.rmSync(SCRATCH, { recursive: true, force: true })
console.log(echecs.length ? `\n❌ ${echecs.length} échec(s) : ${echecs.join(' · ')}` : '\n✅ TOUS LES TESTS PASSENT')
process.exit(echecs.length ? 1 : 0)
