/**
 * SIRAL — Attaché de justice · composition des graphiques statistiques.
 *
 * Fait le lien entre les agrégats de statistiques.mjs et le moteur de rendu
 * pngChart.mjs : pour chaque graphique du catalogue (les mêmes que la page
 * Statistiques et le rapport PDF), produit l'image PNG ET les données
 * chiffrées qui l'accompagnent — l'attaché VOIT la courbe et dispose des
 * nombres exacts, il n'a jamais à les estimer depuis l'image.
 *
 * Couleurs : la charte de l'app consommée DIRECTEMENT depuis la source
 * unique lib/stats/chartCouleurs.mjs (celle de utils/chartColors.ts) — mêmes
 * couleurs d'orientation, même couleur stable par service (hash du nom),
 * même palette de catégories.
 */
import { bilanStatistiques, labelMois } from './statistiques.mjs'
import { graphiqueCourbe, graphiqueColonnes, graphiqueColonnesEmpilees, graphiqueColonnesGroupees, graphiqueDonut } from './pngChart.mjs'
import { CHART_COLORS, getServiceColor, ORIENTATION_DATASETS } from '../../lib/stats/chartCouleurs.mjs'
import { periodeDeAnnee } from './statsEcran.mjs'

export { CHART_COLORS }
export const couleurService = getServiceColor

// Clés du bilan (orientations.crpc…) ↔ clés d'AudienceStats (nombreCRPC…).
const ORIENTATION_KEY = {
  nombreCRPC: 'crpc', nombreCI: 'ci', nombreCOPJ: 'copj',
  nombreOI: 'oi', nombreCDD: 'cdd', nombreClassements: 'classements',
}
const ORIENTATIONS = ORIENTATION_DATASETS.map((d) => ({ key: ORIENTATION_KEY[d.key], label: d.label, color: d.color }))

/** Catalogue des graphiques disponibles (nom → description pour l'outil MCP). */
export const GRAPHIQUES = {
  procedures_terminees_par_mois: 'Courbe des procédures terminées par mois (hors classements sans suite et ouvertures d\'information) — le graphe-phare du rapport d\'activité.',
  deferements_par_mois: 'Courbe des défèrements par mois, à leur date réelle de défèrement.',
  ouvertures_par_mois: 'Histogramme des ouvertures d\'enquêtes par mois (flux entrant).',
  condamnations_par_mois: 'Histogramme des condamnations par mois.',
  orientation: 'Donut de l\'orientation des procédures (CRPC, CI, COPJ, OI, CDD, classements) sur la période.',
  orientation_par_mois: 'Histogramme empilé de l\'orientation des procédures, mois par mois.',
  infractions_terminees: 'Donut de la répartition par catégorie d\'infraction des enquêtes TERMINÉES sur la période.',
  infractions_en_cours: 'Donut de la répartition par catégorie d\'infraction des enquêtes EN COURS (stock).',
  services_terminees: 'Donut de la répartition par service d\'enquête des procédures terminées.',
  tendance_infractions_par_mois: 'Histogramme empilé des catégories d\'infraction des procédures terminées, mois par mois — pour VOIR les grandes tendances de l\'action (ex. atteintes aux biens en début d\'année, stupéfiants ensuite).',
  // ── Les visuels restants de la page Statistiques ──
  services_toutes_enquetes: 'Donut « Répartition globale par service » : enquêtes ouvertes ET jugées sur la période (la carte du haut de la page, plus large que services_terminees).',
  infractions_grands_titres: 'Donut des GRANDS TITRES d\'infraction (Atteintes aux personnes, aux biens…) des procédures terminées — le repli de l\'onglet « Types d\'infractions ».',
  saisies_vs_confiscations: 'Colonnes groupées saisies d\'enquête vs confiscations d\'audience, poste par poste — la carte « Delta saisies vs confiscations ».',
  peines_moyennes_par_type_audience: 'Colonnes groupées des peines moyennes (ferme pur, sursis probatoire pur, mixte) par type d\'audience — la carte du même nom.',
  peines_prison_par_mois: 'Histogramme des mois de prison ferme prononcés, mois par mois — la ventilation de la carte « Total des peines de prison ».',
  amendes_par_mois: 'Histogramme du montant d\'amendes prononcé par mois — la ventilation de la carte « Amendes ».',
  classements_par_mois: 'Courbe des classements sans suite par mois — la ventilation de la carte « Classements sans suite ».',
  ouvertures_information_par_mois: 'Courbe des ouvertures d\'information par mois — la ventilation de la carte « Ouvertures d\'information ».',
  instruction_mesures_surete: 'Donut des mesures de sûreté des mis en examen (détenus, contrôle judiciaire, ARSE, libres) — onglet « Statistiques instruction ». Photographie du stock actuel, indépendante de la période.',
}

const periodeTexte = (b) => `du ${b.periode.du} au ${b.periode.au}`

/**
 * Produit un graphique du catalogue : { titre, note, donnees, png (Buffer) }.
 * Fenêtre : `annee` (le sélecteur de la page Statistiques) OU `du`/`au`
 * (période libre). `bilan` optionnel (déjà calculé) pour éviter un recalcul.
 */
export function genererGraphique(keys, { graphique, annee, du, au, bilan }) {
  const nom = String(graphique || '')
  if (!GRAPHIQUES[nom]) {
    throw new Error(`Graphique inconnu : ${nom}. Disponibles : ${Object.keys(GRAPHIQUES).join(', ')}`)
  }
  const fenetre = annee !== undefined && annee !== null && annee !== ''
    ? periodeDeAnnee(annee) : { du, au }
  const b = bilan || bilanStatistiques(keys, { du: fenetre.du, au: fenetre.au })
  const mois = b.periode.mois
  const avecAnnee = mois.length > 12
  const serieMois = (parMois) => mois.map((m) => ({ label: labelMois(m.cle, avecAnnee), value: parMois[m.cle] || 0 }))

  switch (nom) {
    case 'procedures_terminees_par_mois': {
      const points = serieMois(b.proceduresTerminees.parMois)
      return {
        titre: `Procédures terminées par mois — ${periodeTexte(b)}`,
        note: b.proceduresTerminees.note,
        donnees: { total: b.proceduresTerminees.total, parMois: b.proceduresTerminees.parMois },
        png: graphiqueCourbe({ points, titre: 'Procédures terminées par mois', sousTitre: periodeTexte(b), couleur: '#16307A' }),
      }
    }
    case 'deferements_par_mois': {
      const points = serieMois(b.deferements.parMois)
      return {
        titre: `Défèrements par mois — ${periodeTexte(b)}`,
        note: b.deferements.note,
        donnees: { total: b.deferements.total, parMois: b.deferements.parMois },
        png: graphiqueCourbe({ points, titre: 'Deferements par mois', sousTitre: periodeTexte(b), couleur: '#C01427' }),
      }
    }
    case 'ouvertures_par_mois': {
      const points = serieMois(b.ouvertures.parMois)
      return {
        titre: `Ouvertures d'enquêtes par mois — ${periodeTexte(b)}`,
        note: 'Flux entrant : toutes les enquêtes créées dans la période, quel que soit leur statut actuel.',
        donnees: { total: b.ouvertures.total, parMois: b.ouvertures.parMois, stockEnCours: b.stockEnCours },
        png: graphiqueColonnes({ points, titre: 'Ouvertures par mois', sousTitre: periodeTexte(b), couleur: '#2980b9' }),
      }
    }
    case 'condamnations_par_mois': {
      const parMois = Object.fromEntries(mois.map((m) => [m.cle, b.audienceParMois[m.cle]?.condamnations || 0]))
      return {
        titre: `Condamnations par mois — ${periodeTexte(b)}`,
        note: `Total période : ${b.audience.nombreCondamnations} condamnations.`,
        donnees: { total: b.audience.nombreCondamnations, parMois },
        png: graphiqueColonnes({ points: serieMois(parMois), titre: 'Condamnations par mois', sousTitre: periodeTexte(b), couleur: '#16307A' }),
      }
    }
    case 'orientation': {
      const items = ORIENTATIONS.map((o) => ({ label: o.label, value: b.audience.orientations[o.key] || 0, color: o.color }))
      return {
        titre: `Orientation des procédures — ${periodeTexte(b)}`,
        note: `${b.audience.orientations.note} Dont ${b.audience.deferementsDossiersJuges} défèrement(s) dans les dossiers jugés sur la période.`,
        donnees: b.audience.orientations,
        png: graphiqueDonut({ items, titre: 'Orientation des procedures', sousTitre: periodeTexte(b) }),
      }
    }
    case 'orientation_par_mois': {
      const series = ORIENTATIONS.map((o) => ({
        label: o.label, color: o.color,
        values: mois.map((m) => b.audienceParMois[m.cle]?.orientations?.[o.key] || 0),
      }))
      return {
        titre: `Orientation par mois — ${periodeTexte(b)}`,
        note: b.audience.orientations.note,
        donnees: Object.fromEntries(mois.map((m) => [m.cle, b.audienceParMois[m.cle]?.orientations || {}])),
        png: graphiqueColonnesEmpilees({ labels: mois.map((m) => labelMois(m.cle, avecAnnee)), series, titre: 'Orientation par mois', sousTitre: periodeTexte(b) }),
      }
    }
    case 'infractions_terminees':
    case 'infractions_en_cours': {
      const enCours = nom === 'infractions_en_cours'
      const source = enCours ? b.infractions.enCours : b.infractions.terminees
      const items = source.map((x, i) => ({ label: x.categorie, value: x.count, color: CHART_COLORS[i % CHART_COLORS.length] }))
      return {
        titre: `Répartition par catégorie d'infraction — enquêtes ${enCours ? 'en cours' : 'terminées'} — ${periodeTexte(b)}`,
        note: b.infractions.note,
        donnees: source.map(({ categorie, count }) => ({ categorie, count })),
        png: graphiqueDonut({ items, titre: 'Categories d\'infraction', sousTitre: `Enquetes ${enCours ? 'en cours' : 'terminees'} — ${periodeTexte(b)}` }),
      }
    }
    case 'services_terminees': {
      const items = b.repartitionServices.map((s) => ({ label: s.service, value: s.count, color: couleurService(s.service) }))
      return {
        titre: `Répartition par service — procédures terminées — ${periodeTexte(b)}`,
        note: 'Mêmes couleurs stables par service que la page Statistiques.',
        donnees: b.repartitionServices,
        png: graphiqueDonut({ items, titre: 'Repartition par service', sousTitre: `Procedures terminees — ${periodeTexte(b)}` }),
      }
    }
    case 'tendance_infractions_par_mois': {
      const top = b.infractions.terminees.slice(0, 6)
      const series = top.map((x, i) => ({
        label: x.categorie, color: CHART_COLORS[i % CHART_COLORS.length],
        values: mois.map((m) => b.infractions.tendanceParMois[m.cle]?.[x.categorie] || 0),
      }))
      return {
        titre: `Tendance des catégories d'infraction par mois — ${periodeTexte(b)}`,
        note: 'Procédures terminées (hors classements et OI), top 6 des catégories. C\'est ici que se lisent les bascules du contentieux au fil des mois.',
        donnees: b.infractions.tendanceParMois,
        png: graphiqueColonnesEmpilees({ labels: mois.map((m) => labelMois(m.cle, avecAnnee)), series, titre: 'Tendance des categories par mois', sousTitre: periodeTexte(b), hauteur: 320 }),
      }
    }
    case 'services_toutes_enquetes': {
      const source = b.repartitionServicesGlobale || []
      const items = source.map((x) => ({ label: x.service, value: x.count, color: couleurService(x.service) }))
      return {
        titre: `Répartition globale par service — ${periodeTexte(b)}`,
        note: 'Population : enquêtes OUVERTES dans la période ∪ enquêtes JUGÉES dans la période (dédupliquées) + procédures directes — comme la carte « Répartition globale par service ».',
        donnees: source,
        png: graphiqueDonut({ items, titre: 'Repartition globale par service', sousTitre: periodeTexte(b) }),
      }
    }
    case 'infractions_grands_titres': {
      const source = b.infractions.grandsTitres?.terminees || []
      const items = source.map((x, i) => ({ label: x.grandTitre, value: x.total, color: CHART_COLORS[i % CHART_COLORS.length] }))
      return {
        titre: `Grands titres d'infraction — procédures terminées — ${periodeTexte(b)}`,
        note: 'Une enquête compte une fois par grand titre qu\'elle touche (taxonomie Mémento parquet), comme l\'onglet « Types d\'infractions ».',
        donnees: source,
        png: graphiqueDonut({ items, titre: 'Grands titres d\'infraction', sousTitre: `Procedures terminees — ${periodeTexte(b)}` }),
      }
    }
    case 'saisies_vs_confiscations': {
      const delta = b.audience.deltaSaisiesConfiscations
      const lignes = delta?.lignes || []
      return {
        titre: `Saisies d'enquête vs confiscations d'audience — ${periodeTexte(b)}`,
        note: 'Delta = saisi − confisqué. Les postes financiers (numéraire, bancaire, crypto) sont en euros, les autres en nombre de biens : lire chaque poste pour lui-même.',
        donnees: delta,
        png: graphiqueColonnesGroupees({
          labels: lignes.map((l) => l.poste),
          series: [
            { label: 'Saisi (enquête)', color: '#2980b9', values: lignes.map((l) => l.saisi) },
            { label: 'Confisqué (audience)', color: '#27ae60', values: lignes.map((l) => l.confisque) },
          ],
          titre: 'Saisies vs confiscations',
          sousTitre: periodeTexte(b),
        }),
      }
    }
    case 'peines_moyennes_par_type_audience': {
      const source = b.peinesParTypeAudience || []
      return {
        titre: `Peines moyennes par type d'audience — ${periodeTexte(b)}`,
        note: 'En mois. « Mixte » = moyenne totale de la peine mixte (part ferme + sursis).',
        donnees: source,
        png: graphiqueColonnesGroupees({
          labels: source.map((x) => x.type),
          series: [
            { label: 'Ferme pur', color: '#c0392b', values: source.map((x) => x.fermePur.moyenneMois) },
            { label: 'Sursis probatoire pur', color: '#f39c12', values: source.map((x) => x.probatoirePur.moyenneMois) },
            { label: 'Mixte (total)', color: '#8e44ad', values: source.map((x) => x.mixte.moyenneTotaleMois) },
          ],
          titre: 'Peines moyennes par type d\'audience',
          sousTitre: periodeTexte(b),
        }),
      }
    }
    case 'peines_prison_par_mois': {
      const parMois = Object.fromEntries(mois.map((m) => [m.cle, b.audienceParMois[m.cle]?.prisonFermeMois || 0]))
      return {
        titre: `Prison ferme prononcée par mois — ${periodeTexte(b)}`,
        note: `Total période : ${b.audience.peines.totalPrisonFermeMois} mois de prison ferme (part ferme des peines mixtes comprise).`,
        donnees: { totalMois: b.audience.peines.totalPrisonFermeMois, parMois },
        png: graphiqueColonnes({ points: serieMois(parMois), titre: 'Prison ferme par mois (mois)', sousTitre: periodeTexte(b), couleur: '#c0392b' }),
      }
    }
    case 'amendes_par_mois': {
      const parMois = Object.fromEntries(mois.map((m) => [m.cle, b.audienceParMois[m.cle]?.amendes || 0]))
      return {
        titre: `Amendes prononcées par mois — ${periodeTexte(b)}`,
        note: `Total période : ${b.audience.peines.montantTotalAmendes} € — moyenne par condamnation : ${b.audience.peines.moyenneAmendeParCondamnation} €.`,
        donnees: { totalEuros: b.audience.peines.montantTotalAmendes, parMois },
        png: graphiqueColonnes({ points: serieMois(parMois), titre: 'Amendes par mois (euros)', sousTitre: periodeTexte(b), couleur: '#f39c12' }),
      }
    }
    case 'classements_par_mois':
    case 'ouvertures_information_par_mois': {
      const oi = nom === 'ouvertures_information_par_mois'
      const cle = oi ? 'oi' : 'classements'
      const parMois = Object.fromEntries(mois.map((m) => [m.cle, b.audienceParMois[m.cle]?.orientations?.[cle] || 0]))
      const detail = oi ? b.orientationsDetail.ouverturesInformation : b.orientationsDetail.classementsSansSuite
      return {
        titre: `${oi ? "Ouvertures d'information" : 'Classements sans suite'} par mois — ${periodeTexte(b)}`,
        note: `${detail.nombre} au total (${detail.partDesOrientationsPct}% des orientations) — âge moyen des dossiers : ${detail.ageMoyenJours} jours.`,
        donnees: { total: detail.nombre, parMois, repartitionParTypeDeFait: detail.repartitionParTypeDeFait },
        png: graphiqueCourbe({ points: serieMois(parMois), titre: oi ? "Ouvertures d'information par mois" : 'Classements sans suite par mois', sousTitre: periodeTexte(b), couleur: oi ? '#95a5a6' : '#e74c3c' }),
      }
    }
    case 'instruction_mesures_surete': {
      const i = b.instruction
      if (!i) throw new Error('Aucun dossier d\'instruction accessible : ce graphique est sans objet.')
      const items = [
        { label: 'Détenus', value: i.detenus || 0, color: '#c0392b' },
        { label: 'Contrôle judiciaire', value: i.controleJudiciaire || 0, color: '#f39c12' },
        { label: 'ARSE', value: i.arse || 0, color: '#9b59b6' },
        { label: 'Libres', value: i.libres || 0, color: '#27ae60' },
      ]
      return {
        titre: `Mesures de sûreté des mis en examen — ${i.misEnExamen} MEX sur ${i.actifs} dossiers actifs`,
        note: 'Photographie du stock ACTUEL (indépendante de la période). Un MEX sans mesure renseignée est compté LIBRE.',
        donnees: { misEnExamen: i.misEnExamen, detenus: i.detenus, controleJudiciaire: i.controleJudiciaire, arse: i.arse, libres: i.libres },
        png: graphiqueDonut({ items, titre: 'Mesures de surete', sousTitre: `${i.misEnExamen} mis en examen` }),
      }
    }
    default:
      throw new Error(`Graphique non implémenté : ${nom}`)
  }
}

/**
 * Plusieurs graphiques d'un coup, sur la MÊME fenêtre (le bilan n'est calculé
 * qu'une fois) : ce que demande « montre-moi mes graphiques ». Un graphique
 * sans objet (ex. instruction absente) est signalé, il n'interrompt pas la
 * planche.
 */
export function genererGraphiques(keys, { graphiques, annee, du, au }) {
  const noms = (Array.isArray(graphiques) ? graphiques : [graphiques]).map(String).filter(Boolean)
  if (!noms.length) throw new Error('Aucun graphique demandé.')
  const inconnus = noms.filter((n) => !GRAPHIQUES[n])
  if (inconnus.length) {
    throw new Error(`Graphique inconnu : ${inconnus.join(', ')}. Disponibles : ${Object.keys(GRAPHIQUES).join(', ')}`)
  }
  const fenetre = annee !== undefined && annee !== null && annee !== ''
    ? periodeDeAnnee(annee) : { du, au }
  const bilan = bilanStatistiques(keys, { du: fenetre.du, au: fenetre.au })
  return noms.map((nom) => {
    try {
      return { graphique: nom, ...genererGraphique(keys, { graphique: nom, bilan }) }
    } catch (e) {
      return { graphique: nom, indisponible: e.message }
    }
  })
}
