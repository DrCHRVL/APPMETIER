/**
 * SIRAL — test du repérage « ce n'est pas un nom/prénom »
 * (utils/nameHeuristics.ts), utilisé par l'export cartographie pour séparer
 * les entrées réellement exploitables (ex. mots-clés d'une règle d'alerte
 * messagerie) de celles qui méritent une relecture manuelle.
 *
 *   node scripts/nameHeuristics.test.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

// `utils/nameHeuristics.ts` est une logique pure : aucun import de valeur.
// On peut donc l'évaluer telle quelle, comme utils/archiveState.ts.
const source = fs.readFileSync(path.join(REPO, 'utils/nameHeuristics.ts'), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
})
if (/^\s*import\s/m.test(outputText)) {
  throw new Error('nameHeuristics.ts doit rester pur (aucun import de valeur) pour ce test')
}
const mod = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const { checkLooksLikeName, splitByNameLikeness, cleanForKeywordUse } = mod

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) {
    failures++
    console.error(`❌ ${label}\n   attendu : ${JSON.stringify(expected)}\n   obtenu  : ${JSON.stringify(actual)}`)
  } else {
    console.log(`✅ ${label}`)
  }
}

// ── Noms exploitables — ne doivent JAMAIS être signalés ──
for (const nom of [
  'MEON Jordan',
  'Marouane BEN CHERQUI',
  "N'DIAYE Almany",
  'ARBONA Y COLOM Aurélien',
  'ONANGA Peter-Clay',   // tiret dans le prénom, mais espace avec le nom
  "BALLOUL M'Barek",     // apostrophe, mais espace avec le nom
  'BONHOMME Sandrine',   // "homme" en sous-chaîne : ne doit pas déclencher "description"
  'LHOMME Julien',
  'DELHOMME Marc',
  'GRANDHOMME Marc',
  'René LEFEBVRE',       // "né le" en sous-chaîne : ne doit pas déclencher "description"
  'Renée LECLERC',
  'Earl JOSEPH',         // "EARL" coïncide avec un prénom, mais en casse naturelle
  'JOSEPH Earl',
]) {
  check(`accepté : "${nom}"`, checkLooksLikeName(nom).looksLikeName, true)
}

// ── Entrées à signaler, avec le motif attendu ──
const casSignales = [
  ['X', 'homonymes'],                 // désormais capté par la règle "un seul mot"
  ['HX', 'homonymes'],
  ['Femme blonde', 'description'],
  ['??? (fifi maurice ??)', "point d'interrogation"],
  ['SARL SOMME TP', 'personne morale'],
  ['SAS MULTITRAV', 'personne morale'],
  ['SDC DE COLNET', 'personne morale'],
  ['MATEA Alin né le 03/11/2001', 'chiffre'],
  ['GARA Christophe (tété)', 'parenthèses'],
  ['La Flèche" qu\'elle nomme "BÉBÉ', 'guillemets'],
  ['« Bébé »', 'guillemets'],         // guillemets français, pas seulement " ou “”
  ['JOSSE Daniel - Rabatteur/complice', 'description'],
  ['BLONDEL', 'homonymes'],           // patronyme seul : homonymes possibles
  ['CETIN', 'homonymes'],
  ['Emilie', 'homonymes'],            // prénom seul
  ['ffef', 'homonymes'],              // coquille : aussi un seul mot
  ['Monsieur X', 'civilité'],         // civilité + initiale seule
  ['Madame Y', 'civilité'],
  ['M. X', 'civilité'],
]
for (const [nom, attenduDansMotif] of casSignales) {
  const res = checkLooksLikeName(nom)
  check(`signalé : "${nom}"`, res.looksLikeName, false)
  check(`  motif contient "${attenduDansMotif}"`, res.reason.includes(attenduDansMotif), true)
}

// ── Partition globale ──
{
  const { valid, flagged } = splitByNameLikeness(['MEON Jordan', 'X', 'SARL SOMME TP', 'BLONDEL'])
  check('partition : valides', valid, ['MEON Jordan'])
  check('partition : signalées', flagged.map(f => f.name), ['X', 'SARL SOMME TP', 'BLONDEL'])
}

// ── Nettoyage pour réemploi (mot-clé de règle) ──
check('nettoyage : espaces multiples', cleanForKeywordUse('DAHOU   Rachid'), 'DAHOU Rachid')
check('nettoyage : virgule finale', cleanForKeywordUse('DUMAY Matthieu,'), 'DUMAY Matthieu')
check('nettoyage : tiret final', cleanForKeywordUse('CAILLY Angélique -'), 'CAILLY Angélique')
check('nettoyage : tabulation', cleanForKeywordUse('BOUCETTA\tMehdi'), 'BOUCETTA Mehdi')
check('nettoyage : point final', cleanForKeywordUse('Thomas HEWUSZ.'), 'Thomas HEWUSZ')
check('nettoyage : ne touche pas un nom déjà propre', cleanForKeywordUse('MEON Jordan'), 'MEON Jordan')

if (failures > 0) {
  console.error(`\n${failures} échec(s).`)
  process.exit(1)
}
console.log('\nTous les tests sont passés.')
