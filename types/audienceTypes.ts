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
  lieuInterdictionParaitre?: string;
  dureeInterdictionParaitre?: number; // en mois
  interdictionGerer: boolean;
  dureeInterdictionGerer?: number; // en mois
  typeAudience: TypeAudience;
  defere: boolean;
  dateDefere?: string;
  // Nouveaux champs pour les résultats partiels
  isPending?: boolean;
  dateAudiencePending?: string;
}

// --- Types détaillés pour les saisies ---

export type TypeVehicule = 'voiture' | 'moto' | 'scooter' | 'utilitaire' | 'poids_lourd' | 'bateau' | 'autre';

export interface VehiculeSaisi {
  type: TypeVehicule;
  marqueModele?: string;
  immatriculation?: string;
  valeurEstimee?: number;
}

export type TypeImmeuble = 'appartement' | 'maison' | 'terrain' | 'local_commercial' | 'autre';

export interface ImmeubleSaisi {
  type: TypeImmeuble;
  adresse?: string;
  valeurEstimee?: number;
}

export interface SaisieBancaire {
  montant: number;
  banque?: string;
  referenceAgrasc?: string;
}

export interface CryptoSaisie {
  montantEur: number;
  typeCrypto?: string;
}

export type CategorieObjet = 'electronique' | 'luxe' | 'transport_leger' | 'informatique' | 'autre';

export interface ObjetMobilier {
  categorie: CategorieObjet;
  description?: string;
  quantite: number;
  valeurEstimee?: number;
}

export type TypeStupefiant = 'cocaine' | 'heroine' | 'cannabis' | 'synthese' | 'autre';

export interface StupefiantSaisi {
  types: TypeStupefiant[];
  quantite?: string;
  description?: string;
}

export interface Confiscations {
  vehicules: VehiculeSaisi[];
  immeubles: ImmeubleSaisi[];
  numeraire: number;
  saisiesBancaires: SaisieBancaire[];
  cryptomonnaies: CryptoSaisie[];
  objetsMobiliers: ObjetMobilier[];
  stupefiants?: StupefiantSaisi;
}

/** Crée un objet Confiscations vide */
export function emptyConfiscations(): Confiscations {
  return {
    vehicules: [],
    immeubles: [],
    numeraire: 0,
    saisiesBancaires: [],
    cryptomonnaies: [],
    objetsMobiliers: [],
  };
}

/** Vrai si au moins une saisie est renseignée (toutes catégories confondues). */
export function hasAnySaisies(s: Confiscations | undefined | null): boolean {
  if (!s) return false;
  return (
    s.vehicules.length > 0 ||
    s.immeubles.length > 0 ||
    (s.numeraire || 0) > 0 ||
    s.saisiesBancaires.length > 0 ||
    s.cryptomonnaies.length > 0 ||
    s.objetsMobiliers.length > 0 ||
    (s.stupefiants?.types?.length ?? 0) > 0
  );
}

/** Migre l'ancien format (compteurs simples) vers le nouveau format détaillé */
export function migrateConfiscations(raw: any): Confiscations {
  if (!raw) return emptyConfiscations();
  // Déjà au nouveau format (vehicules est un tableau)
  if (Array.isArray(raw.vehicules)) return raw as Confiscations;
  // Ancien format : vehicules: number, immeubles: number, argentTotal: number
  const legacy = raw as { vehicules?: number; immeubles?: number; argentTotal?: number };
  return {
    vehicules: Array.from({ length: legacy.vehicules || 0 }, () => ({ type: 'voiture' as TypeVehicule })),
    immeubles: Array.from({ length: legacy.immeubles || 0 }, () => ({ type: 'autre' as TypeImmeuble })),
    numeraire: legacy.argentTotal || 0,
    saisiesBancaires: [],
    cryptomonnaies: [],
    objetsMobiliers: [],
  };
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
  saisies?: Confiscations; // Saisies effectuées par les services d'enquête (phase enquête)
  typeInfraction?: string;
  numeroAudience?: string; // Format: "YYYY-MM-DD-N"
  isDirectResult?: boolean;
  isOI?: boolean; // Pour marquer les ouvertures d'information
  isAudiencePending?: boolean; // Pour marquer les enquêtes en attente d'audience
  /**
   * Brouillon créé depuis le détail d'une enquête en cours pour stocker
   * progressivement les saisies pendant l'enquête préliminaire.
   * - dateAudience est vide tant que l'enquête n'est pas archivée
   * - les stats l'ignorent (filtrées par dateAudience non vide)
   * - le cleanup périodique le préserve s'il contient des saisies
   * Au moment de l'archivage, ce flag est remplacé par isAudiencePending /
   * isClassement / isOI selon le choix de l'utilisateur, et dateAudience est rempli.
   */
  isPreArchiveSaisies?: boolean;
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
  totalNumeraire: number;
  totalBancaire: number;
  totalCrypto: number;
  totalObjets: number;
  totalStupefiants: number;
  // Saisies (phase enquête)
  totalSaisiesVehicules: number;
  totalSaisiesImmeubles: number;
  totalSaisiesArgent: number;
  totalSaisiesNumeraire: number;
  totalSaisiesBancaire: number;
  totalSaisiesCrypto: number;
  totalSaisiesObjets: number;
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
  totalInterdictionsGerer: number;
  ratioInterdictionsGerer: number;
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