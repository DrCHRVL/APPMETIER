/**
 * SIRAL — report des saisies (phase enquête) vers les confiscations (audience).
 *
 * Couvre la reprise rétroactive des dossiers archivés : le magistrat renseigne
 * a posteriori les saisies depuis le détail de l'enquête, puis rouvre le
 * résultat d'audience pour corriger les confiscations. Ce chemin doit
 *  - ne jamais dupliquer une ligne déjà présente ;
 *  - ne jamais écraser une confiscation déjà renseignée ;
 *  - tolérer les enregistrements partiels (catégorie absente).
 *
 *   node scripts/saisies-confiscations.test.mjs
 */
import {
  emptyConfiscations,
  hasAnySaisies,
  migrateConfiscations,
  mergeConfiscations,
  countConfiscations,
} from '../lib/stats/audienceCore.mjs'

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

const saisies = {
  vehicules: [{ type: 'voiture', marqueModele: 'Golf', immatriculation: 'AB-123-CD', valeurEstimee: 8000 }],
  immeubles: [],
  numeraire: 4500,
  saisiesBancaires: [{ type: 'compte_courant', montant: 12000, banque: 'CIC' }],
  cryptomonnaies: [],
  objetsMobiliers: [{ categorie: 'luxe', description: 'Rolex', quantite: 1 }],
  stupefiants: { types: ['cocaine'], quantite: '2 kg' },
}

// ── 1. Confiscations vides : tout est repris
{
  const { merged, totalAdded } = mergeConfiscations(emptyConfiscations(), saisies)
  check('vide : véhicule repris', merged.vehicules.length, 1)
  check('vide : numéraire repris', merged.numeraire, 4500)
  check('vide : avoir bancaire repris', merged.saisiesBancaires.length, 1)
  check('vide : objet repris', merged.objetsMobiliers.length, 1)
  check('vide : stupéfiants repris', merged.stupefiants.types, ['cocaine'])
  check('vide : total ajouté', totalAdded, 5)
}

// ── 2. Report idempotent : rejouer le report n'ajoute rien
{
  const first = mergeConfiscations(emptyConfiscations(), saisies).merged
  const { merged, totalAdded } = mergeConfiscations(first, saisies)
  check('idempotence : aucun ajout au second passage', totalAdded, 0)
  check('idempotence : pas de doublon véhicule', merged.vehicules.length, 1)
  check('idempotence : pas de doublon bancaire', merged.saisiesBancaires.length, 1)
}

// ── 3. Confiscations déjà renseignées : on complète sans écraser
{
  const confiscations = {
    ...emptyConfiscations(),
    // Le juge n'a confisqué que le véhicule, avec une valeur retenue différente,
    // et le magistrat avait déjà porté un numéraire moindre.
    vehicules: [{ type: 'voiture', marqueModele: 'Golf', immatriculation: 'AB-123-CD', valeurEstimee: 6000 }],
    numeraire: 3000,
  }
  const { merged, added } = mergeConfiscations(confiscations, saisies)
  check('complément : numéraire existant préservé', merged.numeraire, 3000)
  check('complément : numéraire non recompté', added.numeraire, 0)
  check('complément : avoir bancaire ajouté', added.saisiesBancaires, 1)
  check('complément : objet ajouté', added.objetsMobiliers, 1)
  // Valeur retenue différente = ligne distincte : on l'ajoute plutôt que de
  // corriger silencieusement ce que le magistrat a saisi.
  check('complément : véhicule de valeur différente ajouté', merged.vehicules.length, 2)
}

// ── 4. Signatures : casse et espaces ne créent pas de doublon
{
  const base = { ...emptyConfiscations(), saisiesBancaires: [{ type: 'compte_courant', montant: 12000, banque: '  cic ' }] }
  const { totalAdded } = mergeConfiscations(base, saisies)
  check('signature : banque insensible à la casse/espaces', totalAdded, 4)
}

// ── 5. Enregistrements partiels : aucune exception
{
  const partiel = { vehicules: [{ type: 'moto' }] } // pas d'immeubles, ni d'objets…
  check('partiel : hasAnySaisies ne lève pas', hasAnySaisies(partiel), true)
  check('partiel : migration recomplète les catégories', migrateConfiscations(partiel).objetsMobiliers, [])
  check('partiel : merge fonctionne', mergeConfiscations(emptyConfiscations(), partiel).merged.vehicules.length, 1)
  check('partiel : hasAnySaisies sur objet nu', hasAnySaisies({}), false)
  check('partiel : hasAnySaisies sur null', hasAnySaisies(null), false)
}

// ── 6. Immutabilité : la source n'est pas modifiée
{
  const snapshot = JSON.stringify(saisies)
  const base = { ...emptyConfiscations(), numeraire: 100 }
  const { merged } = mergeConfiscations(base, saisies)
  merged.vehicules.push({ type: 'bateau' })
  check('immutabilité : saisies source intactes', JSON.stringify(saisies), snapshot)
  check('immutabilité : base intacte', base.vehicules.length, 0)
}

// ── 7. Comptage affiché à l'utilisateur
{
  check('comptage : 5 éléments', countConfiscations(saisies), 5)
  check('comptage : rien', countConfiscations(emptyConfiscations()), 0)
  check('comptage : indéfini', countConfiscations(undefined), 0)
}

if (failures > 0) {
  console.error(`\n${failures} test(s) en échec`)
  process.exit(1)
}
console.log('\nTous les tests passent.')
