/**
 * SIRAL — l'attaché est-il vivant, et le dit-on correctement ?
 *
 * Sur cinq façons de tomber en panne, TROIS laissent le service parfaitement
 * vivant en apparence : clés jamais remises, clés révoquées, clés remises pour
 * une partie seulement des contentieux. Dans ces trois cas, les recoupements
 * cessent d'être calculés et l'écran affiche une liste vide — indiscernable de
 * « vos dossiers ne se touchent pas ».
 *
 * Ce test vérifie que chacune de ces situations reçoit son verdict propre, et
 * qu'une authentification Claude périmée n'est JAMAIS confondue avec une panne :
 * les recoupements et le texte des pièces sont du calcul local, ils n'ont aucun
 * besoin d'intelligence artificielle.
 *
 *   node scripts/attache-sante.test.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-sante-'))
const { outputText } = ts.transpileModule(
  fs.readFileSync(path.join(REPO, 'lib/server/attacheSante.ts'), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
)
fs.writeFileSync(path.join(TMP, 'sante.mjs'), outputText)
const { verdictAttache } = await import(path.join(TMP, 'sante.mjs'))

let echecs = 0
const ok = (cond, libelle, detail = '') => {
  if (cond) console.log(`  ✓ ${libelle}`)
  else { echecs++; console.error(`  ✗ ${libelle}${detail ? ` — ${detail}` : ''}`) }
}

const ATTENDUS = ['global', 'ctx-crimorg', 'ctx-enviro', 'ctx-ecofi']
const sain = {
  configure: true, joignable: true, cleMaitre: true,
  scopesAttendus: ATTENDUS, scopesRemis: ATTENDUS, claudeOk: true,
}
const verdict = (patch) => verdictAttache({ ...sain, ...patch })

console.log('\nLes deux pannes franches :')
ok(verdict({ configure: false }).etat === 'absent', 'pas installé du tout')
ok(verdict({ joignable: false }).etat === 'injoignable', 'installé mais éteint')

console.log('\nLes trois pannes qui ne se voient pas — c\'est pour elles que ce panneau existe :')
const sansCleMaitre = verdict({ cleMaitre: false })
ok(sansCleMaitre.etat === 'aveugle', 'clé-maître absente : le service tourne, et ne voit rien')
ok(/clé-maître/i.test(sansCleMaitre.resume), 'le résumé nomme la cause', sansCleMaitre.resume)

const sansClefs = verdict({ scopesRemis: [] })
ok(sansClefs.etat === 'aveugle', 'trousseau jamais remis (ou révoqué) : aveugle')
ok(/révoqu|remises/i.test(sansClefs.resume), 'le résumé dit qu\'il s\'agit des clés', sansClefs.resume)
ok(Boolean(sansClefs.remede), 'et il dit quoi faire')

const partiel = verdict({ scopesRemis: ['global', 'ctx-crimorg'] })
ok(partiel.etat === 'partiel', 'clés remises pour une partie seulement des contentieux')
ok(partiel.contentieuxManquants.join(',') === 'enviro,ecofi',
  'les contentieux hors périmètre sont NOMMÉS', partiel.contentieuxManquants.join(','))
ok(/inaperçu|AUCUN recoupement/i.test(partiel.resume),
  'le résumé dit la conséquence : un pont passerait inaperçu', partiel.resume)

console.log('\nCe qui ne doit PAS être pris pour une panne :')
const sansIA = verdict({ claudeOk: false })
ok(sansIA.etat === 'en-marche',
  'authentification Claude périmée : l\'attaché reste EN MARCHE (les calculs n\'en dépendent pas)')
ok(sansIA.iaDisponible === false, 'mais la capacité rédactionnelle est signalée indisponible')
ok(verdict({}).etat === 'en-marche' && verdict({}).remede === null,
  'tout est en ordre : aucun remède proposé')

console.log('\nLe verdict est toujours lisible tel quel :')
for (const cas of [{ configure: false }, { joignable: false }, { cleMaitre: false }, { scopesRemis: [] }, { scopesRemis: ['global'] }, {}]) {
  const v = verdict(cas)
  if (!v.resume || v.resume.length < 30) { echecs++; console.error(`  ✗ résumé trop maigre pour ${JSON.stringify(cas)}`) }
}
ok(true, 'chaque situation rend une phrase complète, pas un code technique')

console.log('')
fs.rmSync(TMP, { recursive: true, force: true })
if (echecs > 0) {
  console.error(`${echecs} vérification(s) en échec.`)
  process.exit(1)
}
console.log('État de l\'attaché : chaque panne a son verdict, et aucune ne passe pour une autre.\n')
