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

/**
 * Champs partagés par tous les types d'avoirs/biens saisis pour permettre
 * de tracer une remise ou une vente avant jugement (récupéré dans les stats).
 */
export interface SaisieFlags {
  remiseAvantJugement?: boolean;
  venteAvantJugement?: boolean;
}

export type TypeVehicule = 'voiture' | 'moto' | 'scooter' | 'utilitaire' | 'poids_lourd' | 'bateau' | 'autre';

export interface VehiculeSaisi extends SaisieFlags {
  type: TypeVehicule;
  marqueModele?: string;
  immatriculation?: string;
  valeurEstimee?: number;
}

export type TypeImmeuble = 'appartement' | 'maison' | 'terrain' | 'local_commercial' | 'autre';

export interface ImmeubleSaisi extends SaisieFlags {
  type: TypeImmeuble;
  adresse?: string;
  valeurEstimee?: number;
}

export type TypeAvoir = 'compte_courant' | 'livret' | 'assurance_vie' | 'numeraire' | 'autre';

export interface SaisieBancaire extends SaisieFlags {
  /** Type d'avoir financier. Optionnel pour compat ascendante (ancien format sans type). */
  type?: TypeAvoir;
  montant: number;
  banque?: string;
  /** @deprecated conservé pour relire les anciennes données ; n'est plus saisi dans l'UI. */
  referenceAgrasc?: string;
}

export interface CryptoSaisie extends SaisieFlags {
  montantEur: number;
  typeCrypto?: string;
}

export type CategorieObjet = 'electronique' | 'luxe' | 'transport_leger' | 'informatique' | 'autre';

export interface ObjetMobilier extends SaisieFlags {
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

// Les helpers de confiscations vivent dans le module PARTAGÉ
// lib/stats/audienceCore.mjs (source unique, aussi utilisée par le service
// attaché) — re-exportés ici avec leur typage historique.
import {
  emptyConfiscations as emptyConfiscationsCore,
  hasAnySaisies as hasAnySaisiesCore,
  migrateConfiscations as migrateConfiscationsCore,
} from '@/lib/stats/audienceCore.mjs';

/** Crée un objet Confiscations vide */
export function emptyConfiscations(): Confiscations {
  return emptyConfiscationsCore() as Confiscations;
}

/** Vrai si au moins une saisie est renseignée (toutes catégories confondues). */
export function hasAnySaisies(s: Confiscations | undefined | null): boolean {
  return hasAnySaisiesCore(s);
}

/** Migre l'ancien format (compteurs simples) vers le nouveau format détaillé */
export function migrateConfiscations(raw: any): Confiscations {
  return migrateConfiscationsCore(raw) as Confiscations;
}


export interface PendingCondamnation {
  nom: string;
  dateAudiencePending: string;
}

export interface ResultatAudience {
  enqueteId: number;
  /**
   * Contentieux propriétaire de l'enquête. Indispensable pour que les IDs
   * d'enquête identiques entre contentieux ne se collisionnent pas dans le
   * stockage global des résultats. Optionnel uniquement pour les données
   * legacy (migrées au démarrage vers `crimorg`).
   */
  contentieuxId?: string;
  dateAudience: string;
  modifiedAt?: string; // Horodatage de la dernière modification (pour résolution automatique des conflits de sync)
  condamnations: CondamnationData[];
  confiscations: Confiscations;
  saisies?: Confiscations; // Saisies effectuées par les services d'enquête (phase enquête)
  typeInfraction?: string;
  /** Liste complète des types d'infraction sélectionnés (multi-sélection).
      `typeInfraction` reste renseigné avec le premier pour la compat des stats. */
  typesInfraction?: string[];
  /** Codes NATINF des infractions sélectionnées (dénormalisés au moment de la
      saisie). Cible de la migration tags → NATINF : les statistiques de peines
      se regroupent par ce code quand il est présent, sinon par typeInfraction. */
  infractionNatinfCodes?: string[];
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
  /** Nombre de biens/avoirs marqués "remise avant jugement" (toutes catégories). */
  nombreRemisesAvantJugement: number;
  /** Nombre de biens/avoirs marqués "vente avant jugement" (toutes catégories). */
  nombreVentesAvantJugement: number;
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
  // Effectifs par catégorie de peine (même population que les moyennes/taux
  // ci-dessus : résultats validés par getYearlyStats). Les cartes affichent
  // ces compteurs plutôt que de refiltrer les résultats bruts, pour que
  // effectifs, pourcentages et moyennes proviennent de la même source.
  nombrePeinesFermes: number;
  nombrePeinesProbation: number;
  nombrePeinesSimple: number;
  nombrePeinesMixtesProbation: number;
  nombrePeinesMixtesSimple: number;
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