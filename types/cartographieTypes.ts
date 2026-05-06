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

export interface CartographieModuleConfig {
  weights: CartographieScoreWeights;
  /** Pondérations par tag d'infraction (clé = Tag.id). */
  tagInfractionWeights: CartographieInfractionWeights;
  /** Version du schéma — incrémenté en cas de migration. */
  version: number;
  updatedAt: string;
  updatedBy?: string;
}

/** Valeurs par défaut, alignées sur la formule MVP historique. */
export const DEFAULT_CARTO_WEIGHTS: CartographieScoreWeights = {
  dossier: 2,
  contentieux: 3,
  miseEnExamen: 1,
  chefDefault: 0.3,
  lienRenseignement: 0,
  recentMultiplier: 1.2,
};

export const DEFAULT_CARTO_CONFIG: CartographieModuleConfig = {
  weights: { ...DEFAULT_CARTO_WEIGHTS },
  tagInfractionWeights: {},
  version: 1,
  updatedAt: new Date(0).toISOString(),
};
