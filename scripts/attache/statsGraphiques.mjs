/**
 * SIRAL — Attaché de justice · composition des graphiques statistiques.
 *
 * Fait le lien entre les agrégats de statistiques.mjs et le moteur de rendu
 * pngChart.mjs : pour chaque graphique du catalogue (les mêmes que la page
 * Statistiques et le rapport PDF), produit l'image PNG ET les données
 * chiffrées qui l'accompagnent — l'attaché VOIT la courbe et dispose des
 * nombres exacts, il n'a jamais à les estimer depuis l'image.
 *
 * Couleurs : la charte de l'app (utils/chartColors.ts) reproduite à
 * l'identique — mêmes couleurs d'orientation, même couleur stable par
 * service (hash du nom), même palette de catégories.
 */
import { bilanStatistiques, labelMois } from './statistiques.mjs'
import { graphiqueCourbe, graphiqueColonnes, graphiqueColonnesEmpilees, graphiqueDonut } from './pngChart.mjs'

// Miroir de utils/chartColors.ts — à conserver en phase.
export const CHART_COLORS = [
  '#34495e', '#3498db', '#2ecc71', '#16a085', '#e74c3c', '#c0392b',
  '#f1c40f', '#f39c12', '#9b59b6', '#8e44ad', '#1abc9c', '#7f8c8d',
  '#d35400', '#27ae60', '#2980b9', '#95a5a6',
]

export function couleurService(service) {
  let hash = 0
  const s = String(service)
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash)
  return CHART_COLORS[Math.abs(hash) % CHART_COLORS.length]
}

const ORIENTATIONS = [
  { key: 'crpc', label: 'CRPC', color: '#34495e' },
  { key: 'ci', label: 'CI', color: '#3498db' },
  { key: 'copj', label: 'COPJ', color: '#2ecc71' },
  { key: 'oi', label: 'OI', color: '#95a5a6' },
  { key: 'cdd', label: 'CDD', color: '#E8D0A9' },
  { key: 'classements', label: 'Classement', color: '#e74c3c' },
]

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
}

const periodeTexte = (b) => `du ${b.periode.du} au ${b.periode.au}`

/**
 * Produit un graphique du catalogue : { titre, note, donnees, png (Buffer) }.
 * `bilan` optionnel (déjà calculé) pour éviter un recalcul.
 */
export function genererGraphique(keys, { graphique, du, au, bilan }) {
  const nom = String(graphique || '')
  if (!GRAPHIQUES[nom]) {
    throw new Error(`Graphique inconnu : ${nom}. Disponibles : ${Object.keys(GRAPHIQUES).join(', ')}`)
  }
  const b = bilan || bilanStatistiques(keys, { du, au })
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
    default:
      throw new Error(`Graphique non implémenté : ${nom}`)
  }
}
