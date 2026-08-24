// types/cartographieTypes.ts
//
// Types liés à la configuration du module Cartographie (pondérations du
// score "Top mis en cause"). Séparé de mindmapGraph.ts pour ne pas
// alourdir l'utilitaire de calcul, et exposable côté UI sans dépendance
// au moteur de graphe.

/**
 * Pondérations utilisées par la formule de score MEC. Chaque champ est
 * exprimé en points bruts ; la formule additionne les contributions puis
 * applique la pondération temporelle (cf. CartographieTemporalConfig).
 *
 * Volontairement plat et lisible : l'utilisateur édite directement ces
 * champs depuis l'écran "Paramètres du module Cartographie".
 */
export interface CartographieScoreWeights {
  /** Points par dossier dans lequel le MEC apparaît. */
  dossier: number;
  /** Points par contentieux distinct (transversalité). */
  contentieux: number;
  /** Points par mise en examen formelle. */
  miseEnExamen: number;
  /** Points par chef d'inculpation, quand aucun tag d'infraction spécifique
   *  ne s'applique (fallback). */
  chefDefault: number;
  /** Points par lien renseignement attaché au MEC (entrant ou sortant). */
  lienRenseignement: number;
  /** Coefficient appliqué au bonus d'infraction d'un dossier lorsqu'un MEC y
   *  est rattaché par un simple lien de renseignement (et non comme mis en
   *  cause). Permet de récompenser une implication "indirecte" sans la
   *  compter à plein. 0 = ignore, 0.8 = 80 % du bonus, 1 = plein bonus. */
  lienRenseignementInfractionCoef: number;
  /** CONTAMINATION LATENTE — fraction du poids d'un MEC transmise à un autre
   *  MEC auquel il est relié par un lien de renseignement (lien personne ↔
   *  personne). Un individu qui n'est dans aucun dossier mais qui gravite
   *  autour de gens lourdement impliqués cesse ainsi de peser zéro. La
   *  transmission décroît à chaque saut (coef^distance). 0 = désactive. */
  lienMecPropagationCoef: number;
  /** Nombre maximal de sauts personne ↔ personne sur lesquels la contamination
   *  latente se propage. 1 = voisins directs seulement ; 2 = « l'ami de mon
   *  ami » (recommandé) ; 0 = désactive. */
  lienMecPropagationHops: number;
}

/**
 * Pondération TEMPORELLE du score MEC. Deux effets combinés, appliqués en
 * multiplicateur sur le total des points bruts (avant le bonus manuel) :
 *
 *  1. MALUS D'ANCIENNETÉ — un individu dont la dernière implication connue
 *     remonte à plusieurs années pèse moins qu'un individu un peu moins
 *     actif mais présent récemment. Le malus est progressif : neutre en
 *     deçà de `freshYears`, maximal (`dormantMultiplier`) au-delà de
 *     `staleYears`, interpolé linéairement entre les deux.
 *
 *  2. BONUS DE CONTINUITÉ — un individu impliqué sur plusieurs années
 *     DISTINCTES (activité continue, et non un pic isolé) reçoit jusqu'à
 *     `continuityBonus` de bonus, atteint à `continuityYears` années
 *     d'activité.
 *
 * Les années d'implication d'un MEC sont l'union des périodes d'activité
 * des dossiers qui le concernent (dates judiciaires : début d'enquête, OP,
 * audience ; date approximative pour les dossiers manuels). Un MEC sans
 * aucune date exploitable reste neutre (facteur 1) — on ne pénalise jamais
 * une absence d'information.
 */
export interface CartographieTemporalConfig {
  /** Active la pondération temporelle. Décoché = facteur 1 pour tout le monde. */
  enabled: boolean;
  /** Ancienneté (en années) en deçà de laquelle aucun malus ne s'applique. */
  freshYears: number;
  /** Ancienneté (en années) à partir de laquelle le malus est maximal. */
  staleYears: number;
  /** Multiplicateur appliqué à un MEC totalement dormant (ancienneté ≥
   *  `staleYears`). 0.5 = score divisé par deux ; 1 = pas de malus. */
  dormantMultiplier: number;
  /** Bonus maximal pour une activité continue. 0.3 = +30 % au plafond. */
  continuityBonus: number;
  /** Nombre d'années d'activité distinctes à partir duquel le bonus de
   *  continuité est plein. */
  continuityYears: number;
}

/**
 * Pondération additionnelle par tag d'infraction. La clé est l'`id` du
 * Tag (cf. config/tags.ts), la valeur le poids en points bruts.
 *
 * Appliqué :
 *  - sur les dossiers ex nihilo qui portent ce tag (via
 *    DossierExNihilo.typeInfractionTagIds) → bonus pour chaque MEC du dossier
 *  - sur les dossiers d'instruction réels (via InfractionReproche dont la
 *    qualification matche la valeur du tag, en best-effort)
 *
 * Un MEC qui apparaît dans deux dossiers "trafic stups" voit donc le poids
 * "trafic stups" appliqué deux fois → la récidive est gratuite.
 */
export type CartographieInfractionWeights = Record<string, number>;

/**
 * Paramètres avancés de disposition (espacement) de la carte. Purement
 * visuels : ils ne changent NI les scores, NI les liens, NI le regroupement —
 * seulement les distances à l'écran. Prennent effet au prochain
 * «&nbsp;Recompacter la carte&nbsp;» (le layout est mis en cache entre-temps).
 *
 * Rappel du modèle : un «&nbsp;réseau&nbsp;» (galaxie) = un groupe de dossiers
 * reliés entre eux. Les dossiers d'un même réseau restent serrés ; ces
 * réglages agissent surtout sur l'air ENTRE réseaux indépendants.
 */
export interface CartographieLayoutConfig {
  /** Espace (px) entre deux réseaux qui n'ont AUCUN lien entre eux. C'est le
   *  principal levier d'aération : plus il est grand, plus les dossiers
   *  indépendants s'écartent. */
  interGalaxyPadding: number;
  /** Espace (px) entre deux réseaux reliés par un lien de renseignement. Gardé
   *  petit pour qu'ils restent visiblement proches (le trait reste court). */
  interGalaxyPaddingRens: number;
  /** Distance cible (px) d'un lien À L'INTÉRIEUR d'un même réseau (entre
   *  dossiers liés). Plus petit = dossiers liés plus collés. */
  linkDistance: number;
}

export interface CartographieModuleConfig {
  weights: CartographieScoreWeights;
  /** Pondération temporelle (malus d'ancienneté + bonus de continuité). */
  temporal: CartographieTemporalConfig;
  /** Pondérations par tag d'infraction (clé = Tag.id). LEGACY : conservé pour
   *  rétrocompat le temps de la migration vers NATINF (cf. natinfWeights). */
  tagInfractionWeights: CartographieInfractionWeights;
  /** Pondération de BASE par catégorie d'infraction (clé = code StatCategory du
   *  Mémento parquet, cf. lib/natinf/nataff.ts — ex. 'STUP', 'BLANCHIMENT',
   *  'VIOL'…). C'est l'axe principal recommandé : on pondère une fois par
   *  catégorie, et chaque NATINF hérite du poids de sa catégorie. Évite le biais
   *  des anciens « tags d'infraction » qui faussaient le score. */
  categoryWeights: CartographieInfractionWeights;
  /** Pondérations par code NATINF (clé = code NATINF). AFFINAGE « de luxe » :
   *  un poids posé ici PRIME sur le poids de catégorie pour ce NATINF précis,
   *  quand on a besoin de descendre dans le détail. */
  natinfWeights: CartographieInfractionWeights;
  /** Ancrage zonal par service d'enquête (puits de gravité). Quand activé,
   *  les galaxies partageant un même service dominant sont doucement
   *  attirées vers un centroïde commun (recalculé en continu) lors d'un
   *  recompactage. Purement additif : n'altère ni les liens, ni le layout
   *  intra-galactique. Prend effet au prochain recompactage de la carte. */
  groupByService: boolean;
  /** Paramètres avancés d'espacement de la carte (purement visuels). */
  layout: CartographieLayoutConfig;
  /** Version du schéma — incrémenté en cas de migration. */
  version: number;
  updatedAt: string;
  updatedBy?: string;
}

/** Version courante du schéma de configuration.
 *  v2 : suppression du multiplicateur « récent » (booléen 12 mois, trop
 *       binaire) au profit du bloc `temporal` (malus d'ancienneté progressif
 *       + bonus de continuité).
 *  v3 : ajout de la CONTAMINATION LATENTE (lienMecPropagationCoef /
 *       lienMecPropagationHops) — les liens personne ↔ personne ne rapportent
 *       plus zéro. Les configs v2 héritent des valeurs par défaut (0.3 / 2)
 *       via `normalize`, sans migration explicite. */
export const CARTO_CONFIG_VERSION = 3;

/** Valeurs par défaut des paramètres d'espacement. Doivent rester alignées
 *  sur les constantes de repli de components/mindmap (INTER_GALAXY_PADDING,
 *  INTER_GALAXY_PADDING_RENS, LINK_DISTANCE). */
export const DEFAULT_CARTO_LAYOUT: CartographieLayoutConfig = {
  interGalaxyPadding: 300,
  interGalaxyPaddingRens: 60,
  linkDistance: 180,
};

/** Valeurs par défaut, alignées sur la formule MVP historique. */
export const DEFAULT_CARTO_WEIGHTS: CartographieScoreWeights = {
  dossier: 2,
  contentieux: 3,
  miseEnExamen: 1,
  chefDefault: 0.3,
  lienRenseignement: 0,
  lienRenseignementInfractionCoef: 0.8,
  lienMecPropagationCoef: 0.3,
  lienMecPropagationHops: 2,
};

/** Valeurs par défaut de la pondération temporelle. Activée d'office : sans
 *  elle, un réseau démantelé il y a dix ans continue de dominer le Top. */
export const DEFAULT_CARTO_TEMPORAL: CartographieTemporalConfig = {
  enabled: true,
  freshYears: 2,
  staleYears: 10,
  dormantMultiplier: 0.5,
  continuityBonus: 0.3,
  continuityYears: 4,
};

export const DEFAULT_CARTO_CONFIG: CartographieModuleConfig = {
  weights: { ...DEFAULT_CARTO_WEIGHTS },
  temporal: { ...DEFAULT_CARTO_TEMPORAL },
  tagInfractionWeights: {},
  categoryWeights: {},
  natinfWeights: {},
  groupByService: false,
  layout: { ...DEFAULT_CARTO_LAYOUT },
  version: CARTO_CONFIG_VERSION,
  updatedAt: new Date(0).toISOString(),
};
