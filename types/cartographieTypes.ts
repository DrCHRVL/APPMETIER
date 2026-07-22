// types/cartographieTypes.ts
//
// Types liés à la configuration du module Cartographie (pondérations du
// score "Top mis en cause"). Séparé de mindmapGraph.ts pour ne pas
// alourdir l'utilitaire de calcul, et exposable côté UI sans dépendance
// au moteur de graphe.

/**
 * Pondérations utilisées par la formule de score MEC. Chaque champ est
 * exprimé en points bruts ; la formule additionne les contributions puis
 * applique le multiplicateur "récent" si activé.
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
  /** Multiplicateur appliqué si au moins un dossier a été touché dans
   *  la fenêtre "récent" (12 mois). 1.0 = neutralise. */
  recentMultiplier: number;
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
  recentMultiplier: 1.2,
};

export const DEFAULT_CARTO_CONFIG: CartographieModuleConfig = {
  weights: { ...DEFAULT_CARTO_WEIGHTS },
  tagInfractionWeights: {},
  categoryWeights: {},
  natinfWeights: {},
  groupByService: false,
  layout: { ...DEFAULT_CARTO_LAYOUT },
  version: 1,
  updatedAt: new Date(0).toISOString(),
};
