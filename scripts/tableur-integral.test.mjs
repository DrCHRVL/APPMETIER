/**
 * SIRAL — test : un classeur (fadette, relevé bancaire) est converti EN ENTIER.
 *
 * Avant : 1 500 lignes par feuille, 40 colonnes, cellules à 300 caractères,
 * 350 000 caractères au total — une fadette de 20 000 lignes était lue à 7 %.
 *
 *   node scripts/tableur-integral.test.mjs
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import XLSX from 'xlsx'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const { classeurEnMarkdown } = await import(`${REPO}/lib/tableur/classeurMarkdown.mjs`)

const echecs = []
function attendu(nom, cond, detail) {
  console.log(`${cond ? '✅' : '❌'} ${nom}${detail ? ' — ' + detail : ''}`)
  if (!cond) echecs.push(nom)
}

const LIGNES = 20_000
const entete = Array.from({ length: 50 }, (_, c) => `col${c + 1}`)
const rows = [entete]
for (let r = 1; r <= LIGNES; r++) rows.push(Array.from({ length: 50 }, (_, c) => (c === 0 ? `appel-${r}` : `v${r}-${c}`)))
rows[LIGNES][49] = 'x'.repeat(500) + 'FIN-CELLULE'
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Fadette')

const res = classeurEnMarkdown(XLSX, wb)
attendu('conversion réussie', res.ok)
attendu(`les ${LIGNES} lignes présentes (dernière comprise)`, res.markdown.includes(`appel-${LIGNES} |`))
attendu('les 50 colonnes présentes', res.markdown.includes('| col50 |'))
attendu('cellule longue entière', res.markdown.includes('FIN-CELLULE'))
attendu('aucune mention de troncature', !/non affichée/.test(res.markdown))

if (echecs.length) { console.log(`\n${echecs.length} échec(s).`); process.exit(1) }
console.log('\nTous les tests passent.')
