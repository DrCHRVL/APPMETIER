/**
 * SIRAL — quantités de stupéfiants : agrégation par produit (audienceCore) et
 * ventilation par unité d'enquête (ecranCore).
 *
 * Points sensibles couverts :
 *  - les unités ne s'additionnent qu'entre elles (250 g + 1,5 kg = 1,75 kg,
 *    mais 12 plants restent 12 plants) ;
 *  - saisies d'enquête et confiscations d'audience ne se cumulent JAMAIS ;
 *  - un produit sans quantité chiffrée compte quand même comme dossier ;
 *  - un dossier co-saisi porte sa quantité au crédit de chaque service.
 *
 *   node scripts/stupefiants-stats.test.mjs
 */
import { calculateAudienceStats } from '../lib/stats/audienceCore.mjs'
import { stupefiantsSaisisParService } from '../lib/stats/ecranCore.mjs'
import { formatTotaux, formatMasse, formatVolume } from '../lib/stupefiants/catalogue.mjs'

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

const vide = () => ({
  vehicules: [], immeubles: [], numeraire: 0,
  saisiesBancaires: [], cryptomonnaies: [], objetsMobiliers: [],
})
const stups = (produits) => ({ ...vide(), stupefiants: { types: [], produits } })

const enquetes = [
  { id: 1, numero: '1/2026', dateDebut: '2026-01-05', statut: 'archive', tags: [{ category: 'services', value: 'BR Amiens' }] },
  { id: 2, numero: '2/2026', dateDebut: '2026-01-10', statut: 'archive', tags: [
    { category: 'services', value: 'BR Amiens' },
    { category: 'services', value: 'CSP Abbeville' },
  ] },
  { id: 3, numero: '3/2026', dateDebut: '2026-02-01', statut: 'archive', tags: [] },
]

const condamnation = { peinePrison: 12, sursisProbatoire: 0, sursisSimple: 0, peineAmende: 0, typeAudience: 'CI', defere: false, interdictionParaitre: false, interdictionGerer: false }

const resultats = [
  {
    enqueteId: 1, contentieuxId: 'crimorg', dateAudience: '2026-03-10',
    condamnations: [condamnation],
    // Le tribunal ne confisque que 80 g des 250 g saisis.
    confiscations: stups([{ code: 'cocaine', quantite: 80, unite: 'g' }]),
    saisies: stups([
      { code: 'cocaine', quantite: 250, unite: 'g' },
      { code: 'cannabis_resine', quantite: 1.5, unite: 'kg' },
    ]),
  },
  {
    // Ouverture d'information : pas de peine, mais les saisies sont acquises.
    enqueteId: 2, contentieuxId: 'crimorg', dateAudience: '2026-04-02', isOI: true,
    condamnations: [], confiscations: vide(),
    saisies: stups([
      { code: 'cannabis_plants', quantite: 12, unite: 'plant' },
      { code: 'cannabis_resine', quantite: 800, unite: 'g' },
      { code: 'ghb_gbl', quantite: 2, unite: 'l' },
    ]),
  },
  {
    // Produit retenu sans pesée, et enquête sans service renseigné.
    enqueteId: 3, contentieuxId: 'crimorg', dateAudience: '2026-05-20',
    condamnations: [condamnation], confiscations: vide(),
    saisies: stups([{ code: 'heroine' }]),
  },
]

const stats = calculateAudienceStats(resultats, enquetes)

// ── 1. Agrégation par produit
{
  const saisis = stats.stupefiantsSaisisParProduit
  const parCode = Object.fromEntries(saisis.map((l) => [l.code, l]))

  check('produit : classement par masse décroissante', saisis.map((l) => l.code),
    ['cannabis_resine', 'cocaine', 'ghb_gbl', 'cannabis_plants', 'heroine'])
  check('produit : masses additionnées entre elles', parCode.cannabis_resine.totaux.masseG, 2300)
  check('produit : rendu lisible', formatTotaux(parCode.cannabis_resine.totaux), '2,3 kg')
  check('produit : dossiers comptés', parCode.cannabis_resine.nbDossiers, 2)
  check('produit : plants non fondus dans les masses', parCode.cannabis_plants.totaux.masseG, 0)
  check('produit : plants comptés à part', formatTotaux(parCode.cannabis_plants.totaux), '12 plants')
  check('produit : volume converti en litres', formatTotaux(parCode.ghb_gbl.totaux), '2 L')
  check('produit : libellé du référentiel', parCode.cocaine.libelle, 'Cocaïne')
  check('produit : famille renseignée', parCode.cannabis_plants.famille, 'Cannabis')
}

// ── 2. Sans quantité : le dossier compte quand même
{
  const heroine = stats.stupefiantsSaisisParProduit.find((l) => l.code === 'heroine')
  check('sans pesée : dossier compté', heroine.nbDossiers, 1)
  check('sans pesée : aucune quantité affichée', formatTotaux(heroine.totaux), '')
}

// ── 3. Saisies et confiscations restent séparées
{
  const confisques = stats.stupefiantsConfisquesParProduit
  check('confiscations : seuls les produits confisqués', confisques.map((l) => l.code), ['cocaine'])
  check('confiscations : quantité propre', formatTotaux(confisques[0].totaux), '80 g')
  const cocaineSaisie = stats.stupefiantsSaisisParProduit.find((l) => l.code === 'cocaine')
  check('confiscations : non cumulées avec les saisies', formatTotaux(cocaineSaisie.totaux), '250 g')
  check('dossiers avec stupéfiants confisqués', stats.totalStupefiants, 1)
}

// ── 4. Ventilation par unité d'enquête
{
  const servicesDe = (e) => (e?.tags || []).filter((t) => t.category === 'services').map((t) => t.value)
  const parService = stupefiantsSaisisParService(resultats, enquetes, 2026, servicesDe)

  check('service : dossiers concernés', parService.nbDossiers, 3)
  check('service : total général', parService.general.libelle, '2,55 kg + 2 L + 12 plants')
  check('service : ordre par masse', parService.lignes.map((l) => l.service), ['BR Amiens', 'CSP Abbeville'])

  const br = parService.lignes.find((l) => l.service === 'BR Amiens')
  check('service : cumul des deux dossiers de la BR', br.libelle, '2,55 kg + 2 L + 12 plants')
  check('service : dossiers de la BR', br.nbDossiers, 2)

  // Le dossier 2 est co-saisi : sa quantité est portée au crédit des DEUX
  // services. Le total par service dépasse donc volontairement le général.
  const abbeville = parService.lignes.find((l) => l.service === 'CSP Abbeville')
  check('service : co-saisine créditée aux deux', abbeville.libelle, '800 g + 2 L + 12 plants')
  check('service : co-saisines signalées', parService.coSaisines, 1)
  check('service : dossier sans service signalé', parService.sansService, 1)
  check('service : quantités présentes', parService.aDesQuantites, true)
}

// ── 5. Fenêtre temporelle : une autre année ne retient rien
{
  const servicesDe = (e) => (e?.tags || []).filter((t) => t.category === 'services').map((t) => t.value)
  const autre = stupefiantsSaisisParService(resultats, enquetes, 2025, servicesDe)
  check('année : 2025 vide', autre.aDesDonnees, false)
  check('année : prédicat libre accepté', 
    stupefiantsSaisisParService(resultats, enquetes, (r) => r.dateAudience >= '2026-04-01', servicesDe).nbDossiers, 2)
}

// ── 6. Formats
{
  check('format : gramme sous le kilo', formatMasse(250), '250 g')
  check('format : bascule au kilo', formatMasse(1000), '1 kg')
  check('format : décimales limitées', formatMasse(1234), '1,23 kg')
  check('format : millilitres', formatVolume(400), '400 ml')
  check('format : litres', formatVolume(2500), '2,5 L')
  check('format : rien', formatMasse(0), '')
}

if (failures > 0) {
  console.error(`\n${failures} test(s) en échec`)
  process.exit(1)
}
console.log('\nTous les tests passent.')
