/**
 * SIRAL — test du RAPPROCHEMENT PHONÉTIQUE des noms (nomsCore).
 *
 * La voie phonétique doit attraper les graphies équivalentes d'un même nom
 * (translittérations, doublements de consonnes) SANS fusionner des noms
 * distincts : chaque garde-fou (longueur, deux premières lettres, distance
 * d'édition ≤ 2) est vérifié par un contre-exemple.
 *
 *   node scripts/noms-phonetique.test.mjs
 */
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const { sameMecPerson, phonetiqueFr } = await import(`${REPO}/lib/recoupements/nomsCore.mjs`)
const { detecterRecoupements } = await import(`${REPO}/lib/recoupements/moteurCore.mjs`)

let echecs = 0
function verifie(libelle, condition, detail = '') {
  if (condition) console.log(`  ✓ ${libelle}`)
  else { echecs++; console.log(`  ✗ ${libelle}${detail ? ` — ${detail}` : ''}`) }
}

console.log('\n— Codes phonétiques')
verifie('yacine ≈ yassine', phonetiqueFr('yacine') === phonetiqueFr('yassine'))
verifie('belkacem ≈ belkassem', phonetiqueFr('belkacem') === phonetiqueFr('belkassem'))
verifie('mohamed ≈ mouhamed', phonetiqueFr('mohamed') === phonetiqueFr('mouhamed'))
verifie('cherif ≈ sherif (son « ch »)', phonetiqueFr('cherif') === phonetiqueFr('sherif'))
verifie('kevin ≠ kelvin', phonetiqueFr('kevin') !== phonetiqueFr('kelvin'))
verifie('mot court : pas de code', phonetiqueFr('lea') === null)
verifie('pseudo chiffré : pas de code', phonetiqueFr('karim80') === null)

console.log('\n— Rapprochement de personnes (sameMecPerson)')
// Ce qui doit fusionner.
verifie('HADDAD Yacine ↔ HADDAD Yassine', sameMecPerson('HADDAD Yacine', 'HADDAD Yassine'))
verifie('BELKACEM Mohamed ↔ BELKASSEM Mohammed', sameMecPerson('BELKACEM Mohamed', 'BELKASSEM Mohammed'))
verifie('ordre des mots + phonétique', sameMecPerson('Yassine HADDAD', 'HADDAD Yacine'))
verifie('coquille simple (règle historique intacte)', sameMecPerson('MOKRANI Micky', 'MOKRANI Miky'))
// Ce qui ne doit PAS fusionner.
verifie('MARTIN ≠ MORTAIN (débuts différents)', !sameMecPerson('MARTIN Paul', 'MORTAIN Paul'))
verifie('DURAND ≠ DUPOND (codes différents)', !sameMecPerson('DURAND Alex', 'DUPOND Alex'))
verifie('BERNARD ≠ BESNARD… si, distance 1 (règle historique)', sameMecPerson('BERNARD Luc', 'BESNARD Luc'))
verifie('prénoms distincts : pas de fusion du nom complet', !sameMecPerson('HADDAD Yacine', 'HADDAD Nordine'))
verifie('mots courts hors phonétique', !sameMecPerson('LE Yan', 'LA Yan'))

console.log('\n— Le moteur de recoupements fusionne les graphies')
{
  const corpus = [
    {
      key: 'e1', numero: '2026/1', label: 'RESEAU A', nature: 'enquete', contentieuxId: 'crimorg',
      personnes: ['HADDAD Yacine'],
      fragments: [{ origine: 'description', texte: 'Trafic organisé autour de HADDAD Yacine à Amiens nord.' }],
    },
    {
      key: 'e2', numero: '2026/2', label: 'RESEAU B', nature: 'enquete', contentieuxId: 'crimorg',
      personnes: ['HADDAD Yassine'],
      fragments: [{ origine: 'description', texte: 'Mise en cause de HADDAD Yassine pour blanchiment.' }],
    },
  ]
  const signaux = await detecterRecoupements(corpus, {})
  const personne = (signaux || []).find((s) => s.kind === 'personne')
  verifie('un signal « même personne » réunit les deux dossiers',
    Boolean(personne) && personne.dossierKeys.length === 2,
    JSON.stringify((signaux || []).map((s) => `${s.kind}:${s.valeur}`)))
}

console.log('')
if (echecs > 0) { console.error(`${echecs} échec(s)`); process.exit(1) }
console.log('Tous les tests passent.')
