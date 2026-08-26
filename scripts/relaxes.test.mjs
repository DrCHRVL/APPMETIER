/**
 * SIRAL — la relaxe comme résultat d'audience.
 *
 * Une relaxe se saisit au niveau du PRÉVENU (un dossier peut mêler relaxés et
 * condamnés). Les règles vérifiées ici :
 *  - elle sort des condamnations, des peines, des taux et des moyennes ;
 *  - elle alimente sa propre carte (`nombreRelaxes` / `relaxesDetail`) ;
 *  - son DÉFÈREMENT reste compté, à sa date réelle — c'est tout l'intérêt de
 *    la garder dans `condamnations` plutôt que de la jeter ;
 *  - les dénominateurs « condamnations » des autres cartes (interdictions de
 *    gérer, peines par type d'audience) l'excluent aussi.
 *
 *   node scripts/relaxes.test.mjs
 */
import { calculateAudienceStats } from '../lib/stats/audienceCore.mjs'
import {
  condamnesDe,
  relaxesDe,
  relaxesDetail,
  peinesParTypeAudience,
  interdictionsGererParInfraction,
  deferementsAnnee,
} from '../lib/stats/ecranCore.mjs'

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

const condamne = (nom, peines, extra = {}) => ({
  nom,
  peinePrison: 0,
  sursisProbatoire: 0,
  sursisSimple: 0,
  peineAmende: 0,
  interdictionParaitre: false,
  interdictionGerer: false,
  typeAudience: 'CI',
  defere: false,
  ...peines,
  ...extra,
})

const relaxe = (nom, extra = {}) => condamne(nom, {}, { isRelaxe: true, ...extra })

const vide = {
  vehicules: [], immeubles: [], numeraire: 0,
  saisiesBancaires: [], cryptomonnaies: [], objetsMobiliers: [],
}

const enquetes = [
  { id: 1, numero: '85103/2026 - ALPHA', statut: 'archive', dateDebut: '2026-01-05', dateCreation: '2026-01-05' },
  { id: 2, numero: '85104/2026 - BETA', statut: 'archive', dateDebut: '2026-02-01', dateCreation: '2026-02-01' },
]

// Dossier 1 : deux prévenus jugés le 12 mars — l'un condamné, l'autre relaxé.
// Les deux avaient été déférés le 20 janvier (audience à date lointaine).
const resultat1 = {
  enqueteId: 1,
  contentieuxId: 'crimorg',
  dateAudience: '2026-03-12',
  infractionNatinfCodes: ['7995'],
  typeInfraction: 'Trafic de stupéfiants',
  confiscations: vide,
  condamnations: [
    condamne('DUPONT', { peinePrison: 24, interdictionGerer: true }, { defere: true, dateDefere: '2026-01-20' }),
    relaxe('MARTIN', { defere: true, dateDefere: '2026-01-20' }),
  ],
}

// Dossier 2 : prévenu unique, relaxé, non déféré.
const resultat2 = {
  enqueteId: 2,
  contentieuxId: 'crimorg',
  dateAudience: '2026-04-03',
  infractionNatinfCodes: ['7151'],
  typeInfraction: 'Vol en bande organisée',
  confiscations: vide,
  condamnations: [relaxe('DURAND')],
}

const resultats = [resultat1, resultat2]

// ── 1. Agrégats de la page Statistiques
{
  const s = calculateAudienceStats(resultats, enquetes)

  check('condamnations : la relaxe n\'en fait pas partie', s.nombreCondamnations, 1)
  check('relaxes : comptées par prévenu', s.nombreRelaxes, 3 - 1)

  // Une seule peine ferme de 24 mois : la moyenne ne doit pas être diluée par
  // les relaxes, ni leur population entrer dans les taux.
  check('moyenne ferme : inchangée par les relaxes', s.moyennePrison, 24)
  check('effectif ferme', s.nombrePeinesFermes, 1)
  check('taux ferme : 100% des condamnations', s.tauxPeinesFermes, 100)
  check('moyennes de sursis : aucune relaxe n\'y entre', [s.moyenneProbation, s.moyenneSimple], [0, 0])
  check('amende moyenne : dénominateur = condamnations', s.moyenneAmende, 0)

  // Moyennes par infraction : le dossier ALPHA ne porte qu'une condamnation.
  check('peines par infraction : effectif ferme', s.peinesParInfraction['7995'].countFerme, 1)
  check('peines par infraction : moyenne ferme', s.peinesParInfraction['7995'].moyenneFerme, 24)
  check(
    'peines par infraction : un dossier 100% relaxes n\'ouvre pas de ligne',
    s.peinesParInfraction['7151'],
    undefined,
  )

  // Défèrements : les deux déférés du dossier 1 sont comptés au mois de leur
  // défèrement (janvier), pas à celui de l'audience (mars).
  check('défèrements : la relaxe déférée est comptée', s.nombreDeferements, 2)
  check('défèrements : rattachés au mois du défèrement', s.deferementsParMois, { '2026-01': 2 })

  // Le dossier reste une audience, et son orientation aussi.
  check('audiences : les deux dossiers comptent', s.nombreAudiences, 2)
  check('orientation CI : 1 par dossier', s.nombreCI, 2)

  // Interdictions : ratio rapporté aux seules condamnations.
  check('interdictions de gérer', s.totalInterdictionsGerer, 1)
  check('ratio interdictions de gérer', s.ratioInterdictionsGerer, 100)
}

// ── 2. Carte « Relaxes »
{
  const d = relaxesDetail(resultats, enquetes, 2026, (k) => k, { maintenant: new Date('2026-12-31') })

  check('carte : total', d.total, 2)
  check('carte : condamnés de la fenêtre', d.condamnes, 1)
  check('carte : personnes jugées', d.juges, 3)
  check('carte : part des personnes jugées', d.partDesJugesPct, 66.7)
  check('carte : mars et avril', [d.parMois[2], d.parMois[3]], [1, 1])
  check('carte : février vide', d.parMois[1], 0)
  check(
    'carte : répartition par type de fait',
    d.repartitionParInfraction,
    [{ infraction: '7151', count: 1 }, { infraction: '7995', count: 1 }],
  )
  check('carte : personnes listées', d.personnes.map((p) => p.nom), ['DURAND', 'MARTIN'])
  check('carte : dossier rattaché', d.personnes[1].dossier, '85103/2026 - ALPHA')
  check('carte : défèrement signalé', d.personnes.map((p) => p.defere), [false, true])

  // Un résultat hors audience (classement, OI, en attente) n'entre jamais.
  const avecClassement = [...resultats, {
    enqueteId: 9, dateAudience: '2026-05-01', isClassement: true,
    condamnations: [relaxe('IGNORE')], confiscations: vide,
  }]
  check(
    'carte : classements et OI exclus',
    relaxesDetail(avecClassement, enquetes, 2026, (k) => k, { maintenant: new Date('2026-12-31') }).total,
    2,
  )

  check('carte : année sans relaxe', relaxesDetail(resultats, enquetes, 2025, (k) => k, { maintenant: new Date('2025-12-31') }).total, 0)
}

// ── 3. Dénominateurs des autres cartes
{
  check('helper : condamnés du résultat', condamnesDe(resultat1).map((c) => c.nom), ['DUPONT'])
  check('helper : relaxés du résultat', relaxesDe(resultat1).map((c) => c.nom), ['MARTIN'])

  const parType = peinesParTypeAudience(resultats, 2026)
  const ci = parType.find((x) => x.type === 'CI')
  check('peines par type d\'audience : relaxes hors effectif', ci.total, 1)
  check('peines par type d\'audience : moyenne ferme', ci.fermePur, { nombre: 1, moyenneMois: 24 })

  const gerer = interdictionsGererParInfraction(resultats, 2026)
  check('interdictions de gérer : dénominateur hors relaxes', gerer.condamnations, 1)
  check('interdictions de gérer : ratio', gerer.ratioPct, 100)

  const def = deferementsAnnee(resultats, 2026, { enquetes, maintenant: new Date('2026-12-31') })
  check('déférements (carte) : la relaxe déférée compte', def.total, 2)
  check('déférements (carte) : au mois de janvier', def.parMois[0], 2)
}

// ── 4. Compatibilité : les données existantes n'ont pas de drapeau
{
  const s = calculateAudienceStats([{
    ...resultat1,
    condamnations: resultat1.condamnations.map(({ isRelaxe, ...c }) => c),
  }], enquetes)
  // MARTIN, sans peine ni drapeau, reste comptabilisé comme avant (une ligne
  // de condamnation sans quantum) : aucune donnée ancienne n'est réinterprétée.
  check('legacy : comportement inchangé sans drapeau', s.nombreCondamnations, 2)
  check('legacy : aucune relaxe inventée', s.nombreRelaxes, 0)
}

if (failures > 0) {
  console.error(`\n${failures} test(s) en échec`)
  process.exit(1)
}
console.log('\nTous les tests passent.')
