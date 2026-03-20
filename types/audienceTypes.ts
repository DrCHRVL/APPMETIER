export type TypeAudience = 'CRPC-Def' | 'CI' | 'COPJ' | 'OI' | 'CDD';

export interface CondamnationData {
  nom?: string;
  /** Lien optionnel vers le MisEnCause correspondant dans l'enquête (pour stats par MEC) */
  misEnCauseId?: number;
  peinePrison: number;
  sursisProbatoire: number;
  sursisSimple: number;
  peineAmende: number;
  interdictionParaitre: boolean;
  typeAudience: TypeAudience;
  defere: boolean;
  dateDefere?: string;
  // Nouveaux champs pour les résultats partiels
  isPending?: boolean;
  dateAudiencePending?: string;
}

export interface Confiscations {
  vehicules: number;
  immeubles: number;
  argentTotal: number;
}

export interface PendingCondamnation {
  nom: string;
  dateAudiencePending: string;
}

export interface ResultatAudience {
  enqueteId: number;
  dateAudience: string;
  modifiedAt?: string; // Horodatage de la dernière modification (pour résolution automatique des conflits de sync)
  condamnations: CondamnationData[];
  confiscations: Confiscations;
  typeInfraction?: string;
  numeroAudience?: string; // Format: "YYYY-MM-DD-N"
  isDirectResult?: boolean;
  isOI?: boolean; // Pour marquer les ouvertures d'information
  isAudiencePending?: boolean; // Pour marquer les enquêtes en attente d'audience
  service?: string;
  isClassement?: boolean;
  motifClassement?: string; // Nouveau champ pour le motif de classement
  nombreDeferes?: number;
  dateDefere?: string;
  // Nouveaux champs pour les résultats partiels
  hasPartialResults?: boolean; // Indique que l'enquête a des résultats partiels
  pendingCondamnations?: PendingCondamnation[]; // Liste des condamnés en attente
  isPartiallyPending?: boolean; // Alias pour hasPartialResults
}

export interface PeineParInfraction {
  moyenneFerme: number;
  moyenneProbation: number;
  moyenneSimple: number;
  countFerme: number;
  countProbation: number;
  countSimple: number;
  moyenneMixtesProbation: string;
  moyenneMixtesSimple: string;
  countPeinesMixtesProbation: number;
  countPeinesMixtesSimple: number;
}

export interface AudienceStats {
  moyennePrison: number;
  moyenneProbation: number;
  moyenneSimple: number;
  moyenneAmende: number;
  totalVehicules: number;
  totalImmeubles: number;
  totalArgent: number;
  nombreAudiences: number;
  nombreCondamnations: number;
  totalPeinePrison: number;
  tauxSursis: number;
  montantTotalAmendes: number;
  delaiMoyenJugement: number;
  dureeMoyenneEnquete: number; // Ajout de la durée moyenne
  ratioConfiscations: number;
  peinesParInfraction: Record<string, PeineParInfraction>;
  totalInterdictionsParaitre: number;
  ratioInterdictionsParaitre: number;
  tauxPeinesFermes: number;
  tauxPeinesProbation: number;
  tauxPeinesSimple: number;
  tauxPeinesMixtesProbation: number;
  tauxPeinesMixtesSimple: number;
  moyenneMixtesProbation: string;
  moyenneMixtesSimple: string;
  nombreCRPC: number;
  nombreCI: number;
  nombreCOPJ: number;
  nombreOI: number;
  nombreCDD: number;
  nombreDeferements: number;
  nombreClassements: number;
  deferementsParMois: Record<string, number>;
}