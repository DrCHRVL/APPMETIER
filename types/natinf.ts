// Types du référentiel NATINF (nomenclature officielle des infractions).
// Voir data/natinf/README.md pour la provenance et la mise à jour des données.

export type NatinfNature = 'crime' | 'delit' | 'contravention' | 'civile' | 'inconnu';

/** Peine encourue, structurée (renseignée surtout pour les codes du mémento). */
export interface NatinfQuantum {
  /** Réclusion criminelle à perpétuité */
  perpetuite?: boolean;
  /** Crime : années de réclusion encourues (15, 20, 30) */
  reclusionAnnees?: number;
  /** Délit : mois d'emprisonnement encourus */
  emprisonnementMois?: number;
  /** Délit puni d'amende seule */
  amendeSeule?: boolean;
  /** Contravention : classe (1 à 5) */
  classe?: 1 | 2 | 3 | 4 | 5;
}

/** Une entrée du référentiel NATINF. */
export interface NatinfEntry {
  /** Numéro NATINF (clé) */
  code: string;
  /** Libellé / qualification (officiel s'il a été importé, sinon mémento) */
  libelle: string;
  nature: NatinfNature;
  quantum: NatinfQuantum;
  /** Libellé lisible de la peine encourue, ex. « Crime — 20 ans » */
  quantumLabel: string;
  /** Thème (catégorie du mémento), ex. « Stupéfiants (ILS) » */
  theme?: string;
  /** Vrai si l'infraction figure au Mémento parquet (infractions fréquentes) */
  frequent: boolean;
  // ── Enrichissements de l'export officiel data.gouv (si importé) ──
  /** Nature telle qu'écrite dans l'export officiel (échelle de gravité) */
  natureOfficielle?: string;
  /** Références des articles définissant l'infraction */
  articlesDefinition?: string;
  /** Références des articles édictant les peines */
  articlesRepression?: string;
}

/** Référence légère vers un NATINF, dénormalisée pour conserver une trace
 *  lisible même si le référentiel évolue (snapshot au moment de la saisie). */
export interface NatinfRef {
  code: string;
  libelle: string;
  nature: NatinfNature;
}
