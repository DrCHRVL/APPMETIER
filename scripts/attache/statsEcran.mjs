/**
 * SIRAL — Attaché de justice · LA PAGE STATISTIQUES TELLE QUE LE MAGISTRAT LA
 * VOIT, carte par carte, pour une ANNÉE donnée.
 *
 * Pourquoi ce module : `statistiques.mjs` produit un BILAN sur période libre
 * (semestre, trimestre…). L'écran, lui, raisonne par ANNÉE CIVILE et affiche
 * des cartes précises — « Total des procédures terminées », « Âge moyen des
 * dossiers au classement », « Delta saisies vs confiscations »… Quand l'agent
 * ne dispose que du bilan, il refait les calculs manquants à sa main et
 * annonce des chiffres qui ne collent pas à ce que le magistrat lit à l'écran.
 *
 * Ce module supprime cet écart : il rend la page, section par section et carte
 * par carte, avec le TITRE EXACT de chaque carte, sa valeur, son détail et la
 * RÈGLE de calcul appliquée. Tout vient des cœurs partagés avec l'app —
 *   lib/stats/ecranCore.mjs       (les cartes elles-mêmes),
 *   lib/stats/audienceCore.mjs    (peines, orientations, saisies),
 *   lib/stats/actesCore.mjs       (actes TSE),
 *   lib/stats/instructionCore.mjs (onglet instruction),
 *   lib/natinf/nataffRegles.mjs   (catégories d'infraction) —
 * donc AUCUNE règle n'est réécrite ici : si l'écran change, ceci change avec.
 *
 * Le seul travail propre à ce fichier est la RÉSOLUTION DES RÉFÉRENTIELS que
 * l'écran obtient de ses hooks React (NATINF, tags d'infraction, services) et
 * la mise en forme des cartes.
 */
import { donneesContentieux } from './statistiques.mjs'
import { attacheContentieux } from './store.mjs'
import { allInstructionDossiers } from './instru.mjs'
import {
  libelleNatinf,
  infractionsDeEnquete,
  categorieDeInfraction,
  servicesDeEnquete,
} from './statsReferentiel.mjs'
import {
  anneeDe,
  moisAffiches,
  libelleMois,
  proceduresTerminees,
  dureesMoyennes,
  deferementsAnnee,
  ouverturesAnnee,
  actesAnnee,
  comparatifAnneePrecedente,
  repartitionServices,
  suiviParquetExterieur,
  statsAudienceAnnee,
  statsAudienceMois,
  totalOrientations,
  deltaSaisiesConfiscations,
  peinesParTypeAudience,
  orientationDetail,
  interdictionsGererParInfraction,
  interdictionsParaitreDetail,
  relaxesDetail,
  enquetesEnCoursPourInfractions,
  enquetesTermineesPourInfractions,
  repartitionCategoriesInfraction,
  stupefiantsSaisisParService,
} from '../../lib/stats/ecranCore.mjs'
import { formatTotaux } from '../../lib/stupefiants/catalogue.mjs'
import { computeInstructionStats } from '../../lib/stats/instructionCore.mjs'
import { ORIENTATION_DATASETS } from '../../lib/stats/chartCouleurs.mjs'

// Les résolutions de référentiel (NATINF, tags d'infraction, services) vivent
// dans statsReferentiel.mjs — partagées avec le bilan par période.
export { libelleNatinf, infractionsDeEnquete, categorieDeInfraction, servicesDeEnquete }

// ── Mise en forme ──

const carte = (titre, valeur, options = {}) => ({
  carte: titre,
  valeur,
  ...(options.sousTitre ? { sousTitre: options.sousTitre } : {}),
  ...(options.detail !== undefined ? { detail: options.detail } : {}),
  regle: options.regle,
})

/** Série mensuelle { 0: n } → [{ mois: 'janvier', valeur: n }] (mois affichés). */
const serie = (parMois, mois) => mois.map((m) => ({ mois: libelleMois(m), valeur: parMois[m] || 0 }))

const euros = (n) => Math.round(Number(n) || 0)

/** Année valide : entier plausible, défaut = année en cours. */
export function anneeNormalisee(valeur, maintenant = new Date()) {
  if (valeur === undefined || valeur === null || valeur === '') return maintenant.getFullYear()
  const n = Number(valeur)
  if (!Number.isInteger(n) || n < 2000 || n > 2100) throw new Error(`Année invalide : ${valeur}`)
  return n
}

/**
 * Fenêtre de dates correspondant au sélecteur « Année » de l'écran : du 1ᵉʳ
 * janvier au 31 décembre, borné à AUJOURD'HUI pour l'année en cours (l'écran
 * s'arrête au mois courant). Sert à demander au bilan par période exactement
 * ce que la page affiche.
 */
export function periodeDeAnnee(anneeBrute, maintenant = new Date()) {
  const annee = anneeNormalisee(anneeBrute, maintenant)
  const aujourdhui = maintenant.toISOString().slice(0, 10)
  return {
    annee,
    du: `${annee}-01-01`,
    au: annee === maintenant.getFullYear() ? aujourdhui : `${annee}-12-31`,
  }
}

// ── La page ──

/**
 * Rend la page Statistiques de l'année demandée, carte par carte : exactement
 * les nombres qu'affiche l'app, avec la règle de chacun.
 */
export function ecranStatistiques(keys, { annee: anneeBrute } = {}) {
  const maintenant = new Date()
  const annee = anneeNormalisee(anneeBrute, maintenant)
  const { enquetes, resultats, customTags } = donneesContentieux(keys)

  const infractionsDe = (e) => infractionsDeEnquete(e, customTags)
  const mois = moisAffiches(annee, maintenant)
  const anneeEnCours = annee === maintenant.getFullYear()

  // ── Agrégats communs (mêmes appels que l'écran)
  const terminees = proceduresTerminees(resultats, enquetes, annee, maintenant)
  const durees = dureesMoyennes(resultats, enquetes, annee, maintenant)
  const deferements = deferementsAnnee(resultats, annee, { maintenant, enquetes })
  const ouvertures = ouverturesAnnee(enquetes, annee, maintenant)
  const actes = actesAnnee(enquetes, annee, maintenant)
  const comparatif = comparatifAnneePrecedente(resultats, enquetes, annee, maintenant)
  const services = repartitionServices(resultats, enquetes, annee, servicesDeEnquete, maintenant)
  const suivi = suiviParquetExterieur(resultats, enquetes, annee)
  const audience = statsAudienceAnnee(resultats, enquetes, annee)
  const statsMois = Object.fromEntries(mois.map((m) => [m, statsAudienceMois(resultats, enquetes, annee, m)]))
  const parMoisDe = (champ) => Object.fromEntries(mois.map((m) => [m, statsMois[m]?.[champ] || 0]))

  // ── Section « Statistiques générales »
  const generales = [
    carte('Total des procédures terminées', terminees.total, {
      sousTitre: 'Hors classements sans suite et ouvertures d\'information',
      detail: {
        parMois: serie(terminees.parMois, mois),
        totalAvecClassementsEtOi: terminees.totalAvecClassementsEtOi,
        dontOuverturesInformation: terminees.ouverturesInformation,
        dontClassementsSansSuite: terminees.classements,
        dossiers: [
          ...terminees.termineesHorsClOi.map((e) => e.numero),
          ...terminees.directesHorsClOi.map(() => '(procédure directe)'),
        ],
      },
      regle: 'Enquêtes ARCHIVÉES dont l\'audience tombe dans l\'année + procédures directes (permanence) de l\'année. Classements sans suite et ouvertures d\'information sont exclus du chiffre-phare et comptés à part.',
    }),
    carte('Durée moyenne', `${durees.termineesJours} jours`, {
      sousTitre: 'Pour les enquêtes préliminaires terminées',
      detail: {
        termineesJours: durees.termineesJours,
        dossiersMesures: durees.nbTerminees,
        enquetesEnCoursJours: durees.enCoursJours,
        stockEnCours: durees.nbEnCours,
      },
      regle: 'Terminées : de dateDebut à la date d\'audience, sur les enquêtes jugées dans l\'année (classements et OI compris). En cours : ancienneté du stock actuel, tous millésimes.',
    }),
    carte('Actes d\'enquête en préliminaire', actes.totalAvecProlongations, {
      sousTitre: `Actes et prolongations réalisés en ${annee} (rattachés à leur date, toutes enquêtes confondues)`,
      detail: {
        ecoutes: actes.ecoutes,
        geolocalisations: actes.geolocalisations,
        autresActes: actes.autresActes,
        prolongationsEcoutes: actes.prolongationsEcoutes,
        prolongationsGeo: actes.prolongationsGeo,
        prolongationsAutres: actes.prolongationsAutres,
        totalActes: actes.totalActes,
        totalProlongations: actes.totalProlongations,
        enquetesConcernees: actes.enquetesAvecActes,
        moyenneParEnqueteConcernee: actes.moyenneParEnqueteConcernee,
        estimationCharge: {
          minutesParActe: actes.minutesParActe,
          heures: actes.tempsEstimeHeures,
          minutes: actes.tempsEstimeMinutesRestantes,
          moyenneActesParSemaine: actes.moyenneActesParSemaine,
          moyenneHeuresParSemaine: actes.moyenneTempsParSemaineHeures,
          moyenneActesParMois: actes.moyenneActesParMois,
          moyenneHeuresParMois: actes.moyenneTempsParMoisHeures,
        },
      },
      regle: 'Chaque acte et chaque prolongation est rattaché à SA date (pas à l\'année d\'ouverture de l\'enquête). Estimation de charge : 35 min par acte ou prolongation, moyennes sur la période écoulée.',
    }),
    carte('Nombre d\'enquêtes en cours', durees.nbEnCours, {
      sousTitre: 'Stock actuel, tous millésimes confondus',
      detail: {
        ouvertesDansLAnnee: ouvertures.total,
        ouverturesParMois: serie(ouvertures.parMois, mois),
      },
      regle: 'Stock = enquêtes au statut « en cours » aujourd\'hui. Ouvertures = flux entrant : enquêtes CRÉÉES dans l\'année, quel que soit leur statut actuel.',
    }),
    carte('Évolution des déférements', deferements.total, {
      sousTitre: `déférement(s) en ${annee} — toutes enquêtes confondues`,
      detail: {
        parMois: serie(deferements.parMois, mois),
        detailParMois: Object.fromEntries(mois.map((m) => [libelleMois(m), deferements.detailParMois[m] || []])),
        deferementsDansLesDossiersJuges: audience?.nombreDeferements || 0,
      },
      regle: 'Comptés à leur DATE RÉELLE (dateDefere, à défaut la date d\'audience), y compris dossiers en attente d\'audience, OI et classements. Ce total DIFFÈRE volontairement du « dont déférements » de la carte Orientation, qui ne compte que les dossiers jugés dans l\'année.',
    }),
    carte(`Comparatif ${annee - 1} / ${annee}`, comparatif.donneesAnneePrecedente ? 'affiché' : 'masqué (pas de données N-1)', {
      detail: {
        proceduresTerminees: comparatif.proceduresTerminees,
        condamnations: comparatif.condamnations,
        prisonFermeMois: comparatif.prisonFermeMois,
        amendes: comparatif.amendes,
        deferements: comparatif.deferements,
      },
      regle: 'Mêmes définitions que les cartes ci-dessus, appliquées à l\'année précédente entière.',
    }),
    carte(`Répartition globale par service (${annee})`, services.global.length, {
      sousTitre: 'Enquêtes en cours et enquêtes terminées',
      detail: services.global,
      regle: 'Population = enquêtes CRÉÉES dans l\'année ∪ enquêtes JUGÉES dans l\'année (dédupliquées) + procédures directes. Une enquête compte une fois par service qui y figure.',
    }),
    carte(`Répartition par service des enquêtes terminées (${annee})`, services.terminees.length, {
      detail: services.terminees,
      regle: 'Mêmes règles, restreint aux enquêtes jugées dans l\'année et aux procédures directes.',
    }),
    carte('Suivi parquet extérieur (JIRS / PG)', suivi.total, {
      detail: {
        jirs: suivi.jirs.length,
        pg: suivi.pg.length,
        lesDeux: suivi.lesDeux.length,
        dossiersJirs: suivi.jirs.map((e) => e.numero),
        dossiersPg: suivi.pg.map((e) => e.numero),
      },
      regle: 'Enquêtes créées au plus tard dans l\'année, encore en cours (ou à l\'instruction) ou clôturées dans l\'année, portant le tag de suivi JIRS ou PG.',
    }),
  ]

  // ── Section « Types d'infractions »
  const enCoursInfra = enquetesEnCoursPourInfractions(enquetes, annee)
  const termineesInfra = enquetesTermineesPourInfractions(resultats, enquetes, annee)
  const repEnCours = repartitionCategoriesInfraction(enCoursInfra, infractionsDe, categorieDeInfraction)
  const repTerminees = repartitionCategoriesInfraction(termineesInfra, infractionsDe, categorieDeInfraction)

  const infractions = [
    carte(`Répartition des enquêtes en cours par catégorie d'infraction (${annee})`, enCoursInfra.length, {
      sousTitre: 'Catégories du parquet, repliables par grand titre',
      detail: { grandsTitres: repEnCours.groupes, nonClasse: repEnCours.nonClasse },
      regle: 'Enquêtes au statut « en cours » créées au plus tard dans l\'année. Une enquête compte UNE fois par catégorie qu\'elle touche, quel que soit le nombre de NATINF qui s\'y rattachent.',
    }),
    carte(`Répartition des enquêtes terminées par catégorie d'infraction (${annee})`, termineesInfra.length, {
      sousTitre: 'Hors classements sans suite et ouvertures d\'information',
      detail: { grandsTitres: repTerminees.groupes, nonClasse: repTerminees.nonClasse },
      regle: 'Enquêtes archivées jugées dans l\'année, hors classements et OI. Même comptage « une fois par catégorie ».',
    }),
  ]

  // ── Section « Résultats d'audience »
  const classements = orientationDetail(resultats, enquetes, annee, 'isClassement', infractionsDe, { maintenant, statsFenetre: audience })
  const oi = orientationDetail(resultats, enquetes, annee, 'isOI', infractionsDe, { maintenant, statsFenetre: audience })
  const gerer = interdictionsGererParInfraction(resultats, annee, libelleNatinf)
  const paraitre = interdictionsParaitreDetail(resultats, enquetes, annee, libelleNatinf)
  const delta = deltaSaisiesConfiscations(audience)
  const stups = stupefiantsSaisisParService(resultats, enquetes, annee, servicesDeEnquete)
  const parTypeAudience = peinesParTypeAudience(resultats, annee)
  const relaxes = relaxesDetail(resultats, enquetes, annee, libelleNatinf, { maintenant })

  const peinesParInfraction = Object.fromEntries(
    Object.entries(audience?.peinesParInfraction || {}).map(([cle, p]) => [libelleNatinf(cle), p]),
  )

  const resultatsAudience = audience ? [
    carte('Orientation', totalOrientations(audience), {
      sousTitre: 'Nombre de fois où un juge a été mobilisé, plus les classements sans suite',
      detail: {
        ...Object.fromEntries(ORIENTATION_DATASETS.map((d) => [d.label, audience[d.key] || 0])),
        dontDeferements: audience.nombreDeferements || 0,
        nombreAudiences: audience.nombreAudiences || 0,
      },
      regle: '1 par dossier pour une CI, une OI, une CDD ou un classement ; 1 par PRÉVENU pour une CRPC.',
    }),
    carte('Orientation par mois', 'ventilation mensuelle', {
      detail: Object.fromEntries(mois.map((m) => [libelleMois(m),
        Object.fromEntries(ORIENTATION_DATASETS.map((d) => [d.label, statsMois[m]?.[d.key] || 0]))])),
      regle: 'Même règle, résultat rattaché au mois de son audience.',
    }),
    carte('Condamnations', audience.nombreCondamnations || 0, {
      sousTitre: 'Toutes enquêtes confondues',
      detail: { parMois: serie(parMoisDe('nombreCondamnations'), mois) },
      regle: 'Chaque personne condamnée compte une fois, dans le dossier où elle est jugée. Les RELAXES en sont exclues — voir la carte « Relaxes ».',
    }),
    carte('Relaxes', relaxes.total, {
      sousTitre: 'Personnes jugées et non condamnées',
      detail: {
        personnesJugees: relaxes.juges,
        condamnees: relaxes.condamnes,
        partDesJugeesPct: relaxes.partDesJugesPct,
        parMois: serie(relaxes.parMois, mois),
        parTypeDeFait: Object.fromEntries(relaxes.repartitionParInfraction.map((r) => [r.infraction, r.count])),
        personnes: relaxes.personnes,
      },
      regle: 'Une relaxe se compte par PRÉVENU (un dossier peut mêler relaxés et condamnés), au mois de son audience. Elle est EXCLUE des condamnations, des peines et des moyennes ; son défèrement, lui, reste compté.',
    }),
    carte('Total des peines de prison', `${audience.totalPeinePrison || 0} mois`, {
      sousTitre: 'Emprisonnement FERME uniquement (part ferme des peines mixtes comprise)',
      detail: {
        mois: audience.totalPeinePrison || 0,
        equivalentAnnees: Math.floor((audience.totalPeinePrison || 0) / 12),
        equivalentMoisRestants: (audience.totalPeinePrison || 0) % 12,
        parMois: serie(parMoisDe('totalPeinePrison'), mois),
      },
      regle: 'Somme des quantums fermes prononcés dans l\'année (sursis exclus).',
    }),
    carte('Peines moyennes', 'en mois', {
      sousTitre: 'Toutes enquêtes confondues',
      detail: {
        prisonFermeUniquement: { moyenneMois: audience.moyennePrison, nombre: audience.nombrePeinesFermes, tauxPct: audience.tauxPeinesFermes },
        sursisProbatoireUniquement: { moyenneMois: audience.moyenneProbation, nombre: audience.nombrePeinesProbation, tauxPct: audience.tauxPeinesProbation },
        sursisSimpleUniquement: { moyenneMois: audience.moyenneSimple, nombre: audience.nombrePeinesSimple, tauxPct: audience.tauxPeinesSimple },
        mixteAvecSursisProbatoire: { moyenne: audience.moyenneMixtesProbation, nombre: audience.nombrePeinesMixtesProbation, tauxPct: audience.tauxPeinesMixtesProbation },
        mixteAvecSursisSimple: { moyenne: audience.moyenneMixtesSimple, nombre: audience.nombrePeinesMixtesSimple, tauxPct: audience.tauxPeinesMixtesSimple },
        tauxSursisPct: audience.tauxSursis,
      },
      regle: 'Chaque condamnation est classée dans UNE catégorie (ferme pur, probatoire pur, simple pur, mixte probatoire, mixte simple) ; les moyennes se calculent sur cette catégorie. Les moyennes mixtes se lisent « ferme + sursis ».',
    }),
    carte('Amendes', euros(audience.moyenneAmende), {
      sousTitre: 'Moyenne par condamnation (€)',
      detail: {
        moyenneParCondamnation: euros(audience.moyenneAmende),
        montantTotal: euros(audience.montantTotalAmendes),
        parMois: serie(parMoisDe('montantTotalAmendes'), mois),
      },
      regle: 'La moyenne se calcule sur TOUTES les condamnations de l\'année, y compris celles sans amende.',
    }),
    carte('Interdictions', (audience.totalInterdictionsParaitre || 0) + (audience.totalInterdictionsGerer || 0), {
      detail: {
        interdictionsDeParaitre: { nombre: audience.totalInterdictionsParaitre || 0, ratioPct: Math.round((audience.ratioInterdictionsParaitre || 0) * 10) / 10, detailParInfraction: paraitre },
        interdictionsDeGerer: { nombre: audience.totalInterdictionsGerer || 0, ratioPct: Math.round((audience.ratioInterdictionsGerer || 0) * 10) / 10 },
      },
      regle: 'Comptées par condamnation prononcée dans l\'année ; le ratio rapporte au nombre total de condamnations.',
    }),
    carte('Saisies (enquête)', euros(audience.totalSaisiesArgent), {
      sousTitre: 'Biens saisis par les services d\'enquête — total des avoirs financiers (€)',
      detail: {
        vehicules: audience.totalSaisiesVehicules || 0,
        immeubles: audience.totalSaisiesImmeubles || 0,
        numeraire: euros(audience.totalSaisiesNumeraire),
        comptesBancaires: euros(audience.totalSaisiesBancaire),
        cryptomonnaies: euros(audience.totalSaisiesCrypto),
        totalAvoirs: euros(audience.totalSaisiesArgent),
        objetsMobiliers: audience.totalSaisiesObjets || 0,
        remisesAvantJugement: audience.nombreRemisesAvantJugement || 0,
        ventesAvantJugement: audience.nombreVentesAvantJugement || 0,
      },
      regle: 'Ce qui a été saisi PENDANT L\'ENQUÊTE, rattaché au dossier et à son année de jugement.',
    }),
    carte('Confiscations (audience)', euros(audience.totalArgent), {
      sousTitre: 'Biens confisqués par décision du tribunal — total des avoirs financiers (€)',
      detail: {
        vehicules: audience.totalVehicules || 0,
        immeubles: audience.totalImmeubles || 0,
        numeraire: euros(audience.totalNumeraire),
        comptesBancaires: euros(audience.totalBancaire),
        cryptomonnaies: euros(audience.totalCrypto),
        totalAvoirs: euros(audience.totalArgent),
        objetsMobiliers: audience.totalObjets || 0,
        dossiersAvecStupefiants: audience.totalStupefiants || 0,
      },
      regle: 'Ce que le tribunal a effectivement confisqué. À ne PAS confondre avec les saisies d\'enquête.',
    }),
    carte('Delta saisies vs confiscations', delta?.totalAvoirs?.delta ?? 0, {
      sousTitre: 'Écart, poste par poste, entre saisies d\'enquête et confiscations d\'audience (€ pour les avoirs)',
      detail: delta,
      regle: 'Delta = saisi − confisqué. Positif = saisi non confisqué par le juge ; négatif = confiscation supérieure à la saisie renseignée.',
    }),
    carte('Stupéfiants saisis', stups.general.libelle || `${stups.nbDossiers} dossier(s)`, {
      sousTitre: 'Quantités saisies en phase enquête, par produit puis par unité d\'enquête',
      detail: {
        totalSaisi: stups.general.libelle || null,
        nbDossiers: stups.nbDossiers,
        parProduit: (audience.stupefiantsSaisisParProduit || []).map((l) => ({
          produit: l.libelle,
          famille: l.famille,
          dossiers: l.nbDossiers,
          saisi: formatTotaux(l.totaux) || null,
        })),
        confisqueParProduit: (audience.stupefiantsConfisquesParProduit || []).map((l) => ({
          produit: l.libelle,
          dossiers: l.nbDossiers,
          confisque: formatTotaux(l.totaux) || null,
        })),
        parUniteEnquete: stups.lignes.map((l) => ({
          service: l.service,
          dossiers: l.nbDossiers,
          saisi: l.libelle || null,
        })),
        dossiersCoSaisis: stups.coSaisines,
        dossiersSansService: stups.sansService,
      },
      regle: 'Saisies d\'enquête uniquement (les confiscations d\'audience sont données à part, sans les additionner : ce sont souvent les mêmes produits). Masses additionnées entre elles, volumes entre eux, comprimés/plants/doses/unités comptés séparément. Un produit sans quantité chiffrée compte quand même comme dossier. Un dossier co-saisi porte sa quantité au crédit de CHAQUE service : la somme des unités peut dépasser le total.',
    }),
    carte('Interdictions de gérer', gerer.total, {
      sousTitre: 'Pourcentage filtrable par type d\'infraction',
      detail: { ...gerer, clesDisponibles: undefined },
      regle: 'Sur les résultats jugés de l\'année (hors OI, classements et audiences en attente). Le pourcentage rapporte les interdictions au nombre de condamnations.',
    }),
    carte('Peines moyennes par type d\'infraction (mois)', Object.keys(peinesParInfraction).length, {
      detail: peinesParInfraction,
      regle: 'Mêmes catégories de peine que la carte « Peines moyennes », ventilées par infraction du dossier.',
    }),
    carte('Peines moyennes par type d\'audience', parTypeAudience.length, {
      sousTitre: `Condamnations de l'année ${annee}`,
      detail: parTypeAudience,
      regle: 'Ventilation ferme pur / sursis probatoire pur / mixte, par type d\'audience (CRPC-Def, CI, COPJ, CDD). Le « mixte » se lit « total dont sursis ».',
    }),
    carte('Classements sans suite', classements.nombre, {
      sousTitre: `${classements.partDesOrientationsPct}% des orientations`,
      detail: {
        partDesOrientationsPct: classements.partDesOrientationsPct,
        ageMoyenJours: classements.ageMoyenJours,
        dossiersAvecAge: classements.dossiersAvecAge,
        repartitionParTypeDeFait: classements.repartitionParTypeDeFait.map(({ infraction, natinf, count, partPct }) => ({ infraction, natinf, count, partPct })),
        parMois: serie(classements.parMois, mois),
      },
      regle: 'Âge moyen = de dateDebut de l\'enquête à la date du classement. La part se calcule sur le total des orientations.',
    }),
    carte('Ouvertures d\'information', oi.nombre, {
      sousTitre: `${oi.partDesOrientationsPct}% des orientations`,
      detail: {
        partDesOrientationsPct: oi.partDesOrientationsPct,
        ageMoyenJours: oi.ageMoyenJours,
        dossiersAvecAge: oi.dossiersAvecAge,
        repartitionParTypeDeFait: oi.repartitionParTypeDeFait.map(({ infraction, natinf, count, partPct }) => ({ infraction, natinf, count, partPct })),
        parMois: serie(oi.parMois, mois),
      },
      regle: 'Âge moyen = de dateDebut de l\'enquête à la date d\'ouverture d\'information.',
    }),
  ] : [carte('Résultats d\'audience', 0, {
    regle: `Aucun résultat d'audience daté en ${annee} : l'écran affiche « Aucune donnée disponible pour l'année ${annee} ».`,
  })]

  // ── Section « Statistiques instruction »
  let instruction = null
  try {
    const dossiers = allInstructionDossiers(keys)
    if (dossiers.length) {
      const s = computeInstructionStats(dossiers, maintenant)
      const arrondi = (n) => Math.round(n)
      instruction = [
        carte('Dossiers d\'instruction', s.nbDossiers, {
          detail: {
            actifs: s.nbDossiersActifs,
            archives: s.nbDossiersArchives,
            auReglement: s.nbDossiersAuReglement,
            article175Recu: s.nbDossiers175Recu,
            requisitoiresDefinitifsRediges: s.nbDossiersReqDef,
            ordonnanceRendue: s.nbDossiersOrdonnance,
          },
          regle: 'Photographie du stock ACTUEL — indépendante de l\'année sélectionnée.',
        }),
        carte('Mis en examen', s.nbMisEnExamen, {
          detail: { detenus: s.nbDetenus, controleJudiciaire: s.nbCJ, arse: s.nbARSE, libres: s.nbLibres },
          regle: 'Sur les dossiers actifs. Un MEX sans mesure de sûreté renseignée est compté LIBRE : détenus + CJ + ARSE + libres = total.',
        }),
        carte('Âge des dossiers', `${arrondi(s.ageMoyenDossiersActifs)} jours`, {
          detail: {
            ageMoyenActifsJours: arrondi(s.ageMoyenDossiersActifs),
            ageMaxActifJours: arrondi(s.ageMaxDossierActif),
            ageMoyenAuReglementJours: arrondi(s.ageMoyenAuReglement),
          },
          regle: 'Depuis la date d\'ouverture de l\'information.',
        }),
        carte('Demandes de mise en liberté', s.nbDmlTotal, {
          detail: { enAttente: s.nbDmlEnAttente, moyenneParDossier: Math.round(s.dmlMoyenParDossier * 10) / 10 },
          regle: 'Sur les dossiers actifs.',
        }),
        carte('Cotes', s.cotesTotal, {
          detail: { moyenneParDossier: Math.round(s.cotesMoyennes * 10) / 10 },
          regle: 'Tomes/cotes renseignés sur les dossiers actifs.',
        }),
        carte('Dossiers à régler (art. 175 CPP)', s.dossiersARegler.total, {
          detail: {
            avecDetenu: s.dossiersARegler.avecDetenu,
            echeances: s.dossiersARegler.urgents,
            delaiDetenuJours: 30,
          },
          regle: '175 rendu : le règlement d\'un dossier avec détenu est dû dans le mois. Une échéance marquée `approx` repose sur la dernière modification du dossier, faute de date de 175 enregistrée.',
        }),
        carte('Délai moyen de clôture par cabinet', Object.keys(s.ageMoyenClotureParCabinet).length, {
          detail: s.ageMoyenClotureParCabinet,
          regle: 'Sur les dossiers archivés : âge moyen simple et âge pondéré par le nombre de mis en examen.',
        }),
      ]
    }
  } catch { /* module instruction absent : section omise */ }

  return {
    ecran: 'Page « Statistiques » de SIRAL',
    contentieux: attacheContentieux(),
    annee,
    selecteurAnnee: `Année : ${annee}`,
    periodeCouverte: anneeEnCours
      ? `du 1ᵉʳ janvier ${annee} au ${maintenant.toISOString().slice(0, 10)} (année en cours : l'écran s'arrête au mois courant)`
      : `année civile ${annee} complète`,
    moisAffiches: mois.map(libelleMois),
    commentLire: 'Chaque entrée est UNE CARTE de la page Statistiques, avec son titre exact, sa valeur affichée, son détail et sa règle de calcul. Ces nombres SONT ceux de l\'écran du magistrat : les citer tels quels, ne jamais les recalculer ni les recouper à la main. Pour une période non calendaire (semestre, trimestre), utiliser stats_synthese ; pour voir un graphique, stats_graphique.',
    sections: [
      { section: 'Statistiques générales', cartes: generales },
      { section: 'Types d\'infractions', cartes: infractions },
      { section: 'Résultats d\'audience', cartes: resultatsAudience },
      ...(instruction ? [{ section: 'Statistiques instruction', cartes: instruction }] : []),
    ],
  }
}

/** Années pour lesquelles le contentieux porte des données (sélecteur de l'écran). */
export function anneesDisponibles(keys) {
  const { enquetes, resultats } = donneesContentieux(keys)
  const annees = new Set()
  for (const e of enquetes) { const a = anneeDe(e.dateCreation); if (a) annees.add(a) }
  for (const r of resultats) { const a = anneeDe(r.dateAudience); if (a) annees.add(a) }
  return [...annees].sort((a, b) => b - a)
}
