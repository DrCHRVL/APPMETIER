/**
 * Configuration des types d'actes pour les Techniques Spéciales d'Enquête (TSE)
 * Chaque type définit les délais légaux, l'autorisation requise et les avertissements.
 */

export type AutreActeTypeKey =
  | 'art76'
  | 'imsi_donnees'
  | 'imsi_interceptions'
  | 'captation_images_public'
  | 'captation_images_prive'
  | 'sonorisation_prive'
  | 'drone_public'
  | 'captation_donnees_informatiques'
  | 'activation_fixe'
  | 'activation_mobile'
  | 'infiltration';

export type DureeUnit = 'jours' | 'mois' | 'heures';

export interface AutreActeTypeConfig {
  key: AutreActeTypeKey;
  label: string;          // Libellé dans le menu déroulant
  // Durée de l'autorisation initiale
  duree?: number;         // undefined = durée libre (procureur fixe)
  dureeUnit?: DureeUnit;
  hasDuree: boolean;      // false = pas de délai propre (art. 76)
  // Prolongations
  maxProlongations: number; // 0 = aucune, 1 = une fois, -1 = pas de limite
  prolongationDuree?: number;
  prolongationDureeUnit?: DureeUnit;
  limiteLegaleTexte?: string; // Ex: "2 mois maximum (1 mois + 1 prolongation)"
  // Autorisation
  autorisation: 'JLD' | 'procureur';
  // Avertissements
  warningBanner?: string;    // Bandeau orange affiché dans le modal
  hoverTips: string[];       // Infos au survol dans la fiche enquête
  toastOnCreate?: string;    // Toast à la création
  toastOnRenewal?: string;   // Toast au clic "Prolonger"
}

export const AUTRE_ACTE_TYPES: Record<AutreActeTypeKey, AutreActeTypeConfig> = {

  art76: {
    key: 'art76',
    label: 'Article 76 (acte de procédure préliminaire)',
    hasDuree: false,
    duree: undefined,
    maxProlongations: 0,
    autorisation: 'JLD',
    warningBanner: undefined,
    hoverTips: [
      'Pas de délai propre — durée encadrée par le cadre de l\'enquête préliminaire.',
      'Autorisation JLD requise sur requête du procureur de la République.',
    ],
    toastOnCreate: undefined,
    toastOnRenewal: undefined,
  },

  imsi_donnees: {
    key: 'imsi_donnees',
    label: 'IMSI-Catcher — Recueil de données (art. 706-95-4 CPP)',
    hasDuree: true,
    duree: 1,
    dureeUnit: 'mois',
    maxProlongations: 1,
    prolongationDuree: 1,
    prolongationDureeUnit: 'mois',
    limiteLegaleTexte: 'Limite légale : 1 mois + 1 renouvellement',
    autorisation: 'JLD',
    warningBanner: 'Autorisation JLD requise (sur requête procureur). Durée : 1 mois, renouvelable une fois.',
    hoverTips: [
      'L\'OPJ doit dresser un PV mentionnant date et heure de début et de fin de chaque opération.',
      'Limite légale : 1 mois + 1 renouvellement.',
    ],
    toastOnRenewal: 'IMSI-Catcher (données) : 1 renouvellement maximum. Vérifier que la limite n\'est pas atteinte.',
  },

  imsi_interceptions: {
    key: 'imsi_interceptions',
    label: 'IMSI-Catcher — Interceptions de communication (art. 706-95-4 CPP)',
    hasDuree: true,
    duree: 48,
    dureeUnit: 'heures',
    maxProlongations: 1,
    prolongationDuree: 48,
    prolongationDureeUnit: 'heures',
    limiteLegaleTexte: 'Limite légale : 48h + 1 renouvellement',
    autorisation: 'JLD',
    warningBanner: 'Autorisation JLD requise. Durée : 48h, renouvelable une fois.',
    hoverTips: [
      'Les correspondances interceptées ne peuvent concerner que la personne ou la liaison visée par l\'autorisation.',
      'L\'OPJ doit dresser un PV mentionnant date et heure de début et de fin de chaque opération.',
      'Limite légale : 48h + 1 renouvellement.',
    ],
    toastOnCreate: 'IMSI-Catcher (interceptions) : durée 48h. Autorisation JLD obligatoire.',
    toastOnRenewal: 'IMSI-Catcher (interceptions) : 1 renouvellement de 48h maximum.',
  },

  captation_images_public: {
    key: 'captation_images_public',
    label: 'Captation d\'images et sonorisation — Lieux publics',
    hasDuree: true,
    duree: undefined, // Durée fixée par le procureur
    maxProlongations: -1, // Renouvelable sans limite explicite
    prolongationDuree: undefined,
    limiteLegaleTexte: 'Pas de limite légale explicite de renouvellement. Durée fixée par le procureur.',
    autorisation: 'procureur',
    warningBanner: 'Durée déterminée par le procureur de la République, renouvelable dans les mêmes conditions. Pas de limite légale explicite.',
    hoverTips: [
      'Photographier des objets visibles depuis la voie publique = pouvoir général de constat, pas d\'autorisation nécessaire.',
      'Photographier des personnes dans un lieu privé visible depuis l\'extérieur = autorisation JLD obligatoire (Cass. Crim. 11 oct. 2022).',
      'La révélation d\'autres infractions en cours d\'opération ne constitue pas une cause de nullité des procédures incidentes.',
      'Si la mesure doit être mise en place dans un autre ressort, le parquet du lieu doit être avisé.',
    ],
    toastOnCreate: 'Captation (lieux publics) : autorisation procureur. Préciser la durée demandée.',
  },

  captation_images_prive: {
    key: 'captation_images_prive',
    label: 'Captation d\'images — Lieux privés (y compris hors art. 59)',
    hasDuree: true,
    duree: 1,
    dureeUnit: 'mois',
    maxProlongations: 1,
    prolongationDuree: 1,
    prolongationDureeUnit: 'mois',
    limiteLegaleTexte: 'Limite légale : 1 mois + 1 renouvellement',
    autorisation: 'JLD',
    warningBanner: 'Autorisation JLD sur requête procureur. Y compris hors heures légales (art. 59). ATTENTION : le renouvellement doit intervenir AVANT l\'expiration de la mesure.',
    hoverTips: [
      'ATTENTION : le renouvellement doit intervenir avant l\'expiration de la mesure précédente.',
      'La révélation d\'autres infractions en cours d\'opération ne constitue pas une cause de nullité des procédures incidentes.',
      'Si la mesure doit être mise en place dans un autre ressort, le parquet du lieu doit être avisé.',
      'Limite légale : 1 mois + 1 renouvellement.',
    ],
    toastOnRenewal: 'ATTENTION : le renouvellement doit intervenir AVANT l\'expiration de la mesure précédente (lieux privés).',
  },

  sonorisation_prive: {
    key: 'sonorisation_prive',
    label: 'Sonorisation — Lieux privés (y compris hors art. 59)',
    hasDuree: true,
    duree: 1,
    dureeUnit: 'mois',
    maxProlongations: 1,
    prolongationDuree: 1,
    prolongationDureeUnit: 'mois',
    limiteLegaleTexte: 'Limite légale : 1 mois + 1 renouvellement',
    autorisation: 'JLD',
    warningBanner: 'Autorisation JLD sur requête procureur. Y compris hors heures légales (art. 59). ATTENTION : le renouvellement doit intervenir AVANT l\'expiration de la mesure.',
    hoverTips: [
      'ATTENTION : le renouvellement doit intervenir avant l\'expiration de la mesure précédente.',
      'La révélation d\'autres infractions en cours d\'opération ne constitue pas une cause de nullité des procédures incidentes.',
      'Si la mesure doit être mise en place dans un autre ressort, le parquet du lieu doit être avisé.',
      'Limite légale : 1 mois + 1 renouvellement.',
    ],
    toastOnRenewal: 'ATTENTION : le renouvellement doit intervenir AVANT l\'expiration de la mesure précédente (lieux privés).',
  },

  drone_public: {
    key: 'drone_public',
    label: 'Captation d\'images par drone/aéronef — Lieux publics',
    hasDuree: true,
    duree: 1,
    dureeUnit: 'mois',
    maxProlongations: 1,
    prolongationDuree: 1,
    prolongationDureeUnit: 'mois',
    limiteLegaleTexte: 'Limite légale : 1 mois + 1 renouvellement',
    autorisation: 'procureur',
    warningBanner: 'Autorisation procureur de la République. Durée : 1 mois, renouvelable une fois.',
    hoverTips: [
      'Autorisation : Procureur de la République (pas de JLD).',
      'Limite légale : 1 mois + 1 renouvellement.',
    ],
    toastOnRenewal: 'Drone (lieux publics) : 1 renouvellement maximum.',
  },

  captation_donnees_informatiques: {
    key: 'captation_donnees_informatiques',
    label: 'Captation de données informatiques (key logger)',
    hasDuree: true,
    duree: 1,
    dureeUnit: 'mois',
    maxProlongations: 1,
    prolongationDuree: 1,
    prolongationDureeUnit: 'mois',
    limiteLegaleTexte: 'Limite légale : 1 mois + 1 renouvellement',
    autorisation: 'JLD',
    warningBanner: 'Autorisation JLD sur requête procureur. Introduction dans un lieu privé (y compris habitation, hors heures légales) possible uniquement pour la pose ou le retrait du dispositif.',
    hoverTips: [
      'L\'introduction dans un lieu privé n\'est permise que pour la mise en place ou le retrait du dispositif.',
      'Limite légale : 1 mois + 1 renouvellement.',
    ],
    toastOnCreate: 'Captation informatique : autorisation JLD. Préciser dans la requête la nature exacte du lieu si introduction nécessaire.',
    toastOnRenewal: 'Captation informatique : 1 renouvellement maximum.',
  },

  activation_fixe: {
    key: 'activation_fixe',
    label: 'Activation à distance — Appareil fixe (art. 706-102-1 CPP)',
    hasDuree: true,
    duree: 1,
    dureeUnit: 'mois',
    maxProlongations: 1,
    prolongationDuree: 1,
    prolongationDureeUnit: 'mois',
    limiteLegaleTexte: 'Limite légale : 1 mois + 1 renouvellement',
    autorisation: 'JLD',
    warningBanner: 'Autorisation JLD. ATTENTION : mesure exclue pour les lieux visés aux art. 56-1, 56-2, 56-3, 56-5 CPP et pour le domicile ou bureau d\'un parlementaire, avocat ou magistrat.',
    hoverTips: [
      'ATTENTION : exclut les lieux art. 56-1 / 56-2 / 56-3 / 56-5 CPP.',
      'ATTENTION : exclut le domicile ou bureau d\'un parlementaire, avocat ou magistrat.',
      'Limite légale : 1 mois + 1 renouvellement.',
    ],
    toastOnCreate: 'Vérifier que l\'appareil ciblé ne se trouve pas dans un lieu exclu (avocat, magistrat, parlementaire — art. 56-1 et s. CPP).',
    toastOnRenewal: 'Activation distance (fixe) : 1 renouvellement maximum. Vérifier les exclusions légales.',
  },

  activation_mobile: {
    key: 'activation_mobile',
    label: 'Activation à distance — Appareil mobile (art. 706-102-1 CPP)',
    hasDuree: true,
    duree: 15,
    dureeUnit: 'jours',
    maxProlongations: 1,
    prolongationDuree: 15,
    prolongationDureeUnit: 'jours',
    limiteLegaleTexte: 'Limite légale : 15 jours + 1 renouvellement',
    autorisation: 'JLD',
    warningBanner: 'Autorisation JLD. Critère de subsidiarité OBLIGATOIRE à justifier : impossibilité de sonorisation/captation ou risque pour l\'intégrité des agents. ATTENTION : exclut les appareils utilisés par un avocat, magistrat, journaliste, médecin, député ou sénateur.',
    hoverTips: [
      'Critère de subsidiarité obligatoire : justifier l\'impossibilité de sonorisation/captation d\'image OU le risque pour l\'intégrité des agents.',
      'ATTENTION : exclut les appareils utilisés par un député, sénateur, magistrat, avocat, journaliste ou médecin.',
      'Limite légale : 15 jours + 1 renouvellement.',
    ],
    toastOnCreate: 'Activation mobile : critère de subsidiarité OBLIGATOIRE à mentionner dans la requête.',
    toastOnRenewal: 'Activation mobile : 1 renouvellement de 15 jours maximum. Vérifier les exclusions (avocat, magistrat, journaliste, médecin, élu).',
  },

  infiltration: {
    key: 'infiltration',
    label: 'Infiltration (art. 706-81 à 706-87-1 CPP)',
    hasDuree: true,
    duree: 4,
    dureeUnit: 'mois',
    maxProlongations: -1, // Renouvelable dans les mêmes conditions sans limite explicite
    prolongationDuree: 4,
    prolongationDureeUnit: 'mois',
    limiteLegaleTexte: 'Maximum 4 mois, renouvelable dans les mêmes conditions',
    autorisation: 'procureur',
    warningBanner: 'Autorisation : Procureur de la République UNIQUEMENT (pas de JLD). Durée maximum : 4 mois, renouvelable. ATTENTION : les actes de l\'infiltré ne peuvent pas constituer une incitation à commettre une infraction (peine de nullité).',
    hoverTips: [
      'Autorisation : Procureur de la République exclusivement.',
      'ATTENTION : les actes ne peuvent pas constituer une incitation à commettre une infraction — peine de nullité (art. 706-84 CPP).',
      'Durée maximum : 4 mois, renouvelable dans les mêmes conditions.',
    ],
    toastOnCreate: 'Infiltration : autorisation procureur uniquement. Vérifier que les actes prévus n\'impliquent pas d\'incitation à commettre une infraction.',
    toastOnRenewal: 'Infiltration renouvelée : vérifier que le cadre légal est toujours respecté (pas d\'incitation à l\'infraction).',
  },

};

// Liste ordonnée pour le menu déroulant
export const AUTRE_ACTE_TYPE_OPTIONS: { key: AutreActeTypeKey; label: string }[] = [
  { key: 'art76',                        label: AUTRE_ACTE_TYPES.art76.label },
  { key: 'imsi_donnees',                 label: AUTRE_ACTE_TYPES.imsi_donnees.label },
  { key: 'imsi_interceptions',           label: AUTRE_ACTE_TYPES.imsi_interceptions.label },
  { key: 'captation_images_public',      label: AUTRE_ACTE_TYPES.captation_images_public.label },
  { key: 'captation_images_prive',       label: AUTRE_ACTE_TYPES.captation_images_prive.label },
  { key: 'sonorisation_prive',           label: AUTRE_ACTE_TYPES.sonorisation_prive.label },
  { key: 'drone_public',                 label: AUTRE_ACTE_TYPES.drone_public.label },
  { key: 'captation_donnees_informatiques', label: AUTRE_ACTE_TYPES.captation_donnees_informatiques.label },
  { key: 'activation_fixe',             label: AUTRE_ACTE_TYPES.activation_fixe.label },
  { key: 'activation_mobile',           label: AUTRE_ACTE_TYPES.activation_mobile.label },
  { key: 'infiltration',                label: AUTRE_ACTE_TYPES.infiltration.label },
];
