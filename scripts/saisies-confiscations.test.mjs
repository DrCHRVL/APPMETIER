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
import {
  chercherProduitStupefiant,
  creerProduitStupefiant,
  formatQuantite,
  libelleProduit,
  normaliserStupefiants,
  PREFIXE_PRODUIT_LIBRE,
} from '../lib/stupefiants/catalogue.mjs'

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
  stupefiants: {
    types: ['cocaine'],
    produits: [
      { code: 'cocaine', quantite: 250, unite: 'g' },
      { code: 'cannabis_resine', quantite: 1.5, unite: 'kg' },
    ],
  },
}

// ── 1. Confiscations vides : tout est repris
{
  const { merged, totalAdded } = mergeConfiscations(emptyConfiscations(), saisies)
  check('vide : véhicule repris', merged.vehicules.length, 1)
  check('vide : numéraire repris', merged.numeraire, 4500)
  check('vide : avoir bancaire repris', merged.saisiesBancaires.length, 1)
  check('vide : objet repris', merged.objetsMobiliers.length, 1)
  check('vide : stupéfiants repris', merged.stupefiants.produits.map((p) => p.code), ['cocaine', 'cannabis_resine'])
  check('vide : cases historiques redérivées', merged.stupefiants.types, ['cocaine', 'cannabis'])
  check('vide : quantité par produit conservée', merged.stupefiants.produits[1].quantite, 1.5)
  check('vide : total ajouté', totalAdded, 6)
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
  check('signature : banque insensible à la casse/espaces', totalAdded, 5)
}

// ── 4 bis. Stupéfiants : un produit déjà confisqué garde SA quantité
{
  const confiscations = {
    ...emptyConfiscations(),
    stupefiants: { types: ['cocaine'], produits: [{ code: 'cocaine', quantite: 80, unite: 'g' }] },
  }
  const { merged, added } = mergeConfiscations(confiscations, saisies)
  check('stups : quantité confisquée préservée', merged.stupefiants.produits[0].quantite, 80)
  check('stups : produit manquant ajouté', added.stupefiants, 1)
  check('stups : pas de doublon de produit', merged.stupefiants.produits.length, 2)
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

// ── 6 bis. Migration de l'ancien format stupéfiants (cases à cocher)
{
  // Une seule case : la quantité globale se rattache sans ambiguïté au produit.
  const solo = normaliserStupefiants({ types: ['cocaine'], quantite: '2 kg' })
  check('migration : produit reconstruit', solo.produits.map((p) => p.code), ['cocaine'])
  check('migration : quantité libre rattachée', solo.produits[0].precision, '2 kg')
  check('migration : pas de quantité globale résiduelle', solo.quantite, undefined)

  // Plusieurs cases : impossible de savoir à quel produit la quantité se
  // rapporte — elle est conservée telle quelle plutôt que d'être attribuée au hasard.
  const multi = normaliserStupefiants({ types: ['cannabis', 'synthese'], quantite: '5 kg' })
  check('migration : quantité ambiguë conservée', multi.quantite, '5 kg')
  check('migration : aucune précision inventée', multi.produits.every((p) => !p.precision), true)

  check('migration : bloc vide → undefined', normaliserStupefiants({ types: [] }), undefined)
  check('migration : idempotente', normaliserStupefiants(normaliserStupefiants(solo)), solo)

  // migrateConfiscations doit appliquer la même normalisation.
  const conf = migrateConfiscations({ ...emptyConfiscations(), stupefiants: { types: ['heroine'] } })
  check('migration : appliquée par migrateConfiscations', conf.stupefiants.produits[0].code, 'heroine')
  check('migration : hasAnySaisies voit les produits', hasAnySaisies(conf), true)
}

// ── 6 ter. Référentiel : recherche, produits libres, quantités facultatives
{
  check('catalogue : recherche par argot', chercherProduitStupefiant('shit').map((p) => p.code), ['cannabis_resine'])
  check('catalogue : accents ignorés', chercherProduitStupefiant('methamph').map((p) => p.code), ['methamphetamine'])
  check(
    'catalogue : produit déjà retenu exclu',
    chercherProduitStupefiant('cocaine', { exclure: ['cocaine'] }).map((p) => p.code),
    ['crack'],
  )
  check('catalogue : unité par défaut', creerProduitStupefiant('cannabis_plants').unite, 'plant')
  check('catalogue : quantité facultative', formatQuantite({ code: 'cocaine', unite: 'g' }), '')
  check('catalogue : quantité formatée', formatQuantite({ code: 'cocaine', quantite: 250, unite: 'g' }), '250 g')
  check('catalogue : pluriel', formatQuantite({ code: 'x', quantite: 3, unite: 'plant' }), '3 plants')
  check('catalogue : décimale à la française', formatQuantite({ code: 'x', quantite: 1.5, unite: 'kg' }), '1,5 kg')

  const libre = creerProduitStupefiant(`${PREFIXE_PRODUIT_LIBRE}Kratom`, 'Kratom')
  check('catalogue : produit libre libellé', libelleProduit(libre), 'Kratom')
  check('catalogue : produit libre rangé en « autre »', normaliserStupefiants({ types: [], produits: [libre] }).types, ['autre'])
}

// ── 7. Comptage affiché à l'utilisateur
{
  check('comptage : 6 éléments', countConfiscations(saisies), 6)
  check('comptage : rien', countConfiscations(emptyConfiscations()), 0)
  check('comptage : indéfini', countConfiscations(undefined), 0)
}

if (failures > 0) {
  console.error(`\n${failures} test(s) en échec`)
  process.exit(1)
}
console.log('\nTous les tests passent.')
