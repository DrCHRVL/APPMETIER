// types/instructionTypes.ts
//
// Modèle de données du module Instruction (refonte complète).
// Ce fichier est la source de vérité pour tout ce qui concerne les dossiers
// d'instruction. Les anciens types (EnqueteInstruction, etc.) ont été retirés.

import type { Tag } from './interfaces';

// ──────────────────────────────────────────────
// CABINET D'INSTRUCTION (configurable depuis l'admin)
// ──────────────────────────────────────────────

/** Définition d'un cabinet d'instruction (paramétrable) */
export interface Cabinet {
  /** Identifiant stable (ex: "cab-1", slug) */
  id: string;
  /** Libellé affiché (ex: "Cabinet 1", "Cabinet Mme Durand") */
  label: string;
  /** Couleur hex pour les badges et la carte */
  color: string;
  /** Magistrat instructeur par défaut affecté à ce cabinet (optionnel) */
  magistratParDefaut?: string;
  /** Ordre d'affichage */
  order: number;
  /** false = cabinet désactivé (masqué) */
  enabled?: boolean;
}

/** Configuration globale du module instruction (côté serveur partagé) */
export interface InstructionModuleConfig {
  cabinets: Cabinet[];
  /** Version pour la sync future */
  version: number;
  updatedAt: string;
  updatedBy?: string;
}

// ──────────────────────────────────────────────
// MIS EN EXAMEN (refondu)
// ──────────────────────────────────────────────

export type StatutMisEnExamen = 'libre' | 'cj' | 'arse' | 'detenu';

/** Régime de la détention provisoire (impacte les durées légales max) */
export type RegimeDetentionProvisoire = 'correctionnel' | 'criminel';

/** Une infraction reprochée à un mis en examen */
export interface InfractionReproche {
  id: number;
  /** Qualification pénale (ex: "Trafic de stupéfiants en bande organisée") */
  qualification: string;
  /** Date des faits (ISO) */
  dateInfraction?: string;
  /** Lieu des faits */
  lieuInfraction?: string;
  /** Explication / contexte des faits */
  explication?: string;
}

/** Catégorie d'élément de personnalité */
export type CategoriePersonnalite =
  | 'situation_familiale'
  | 'situation_professionnelle'
  | 'antecedents'
  | 'addictions'
  | 'sante'
  | 'logement'
  | 'autre';

/** Élément de personnalité du mis en examen */
export interface ElementPersonnalite {
  id: number;
  categorie: CategoriePersonnalite;
  contenu: string;
  /** Date d'observation / source (optionnel) */
  date?: string;
}

/** Demande de mise en liberté (DML) — délai légal 10 jours */
export interface DemandeMiseEnLiberte {
  id: number;
  /** Date de dépôt de la DML */
  dateDepot: string;
  /** Date d'échéance (calculée auto = +10 jours) */
  dateEcheance: string;
  statut: 'en_attente' | 'accordee' | 'rejetee';
  /** Date de rédaction des réquisitions parquet */
  dateRequisitions?: string;
  notes?: string;
}

/** Période de DP avec son régime, durée, et infos JLD */
export interface PeriodeDetentionProvisoire {
  id: number;
  /** Début de la période */
  dateDebut: string;
  /** Durée de la période (en mois) */
  dureeMois: number;
  /** Date de fin théorique (calculée auto = dateDebut + dureeMois) */
  dateFin: string;
  /** Régime applicable à cette période */
  regime: RegimeDetentionProvisoire;
  /** Type de période : initiale ou prolongation */
  type: 'placement' | 'prolongation';
  /** Motif d'une prolongation (notamment pour les prolongations exceptionnelles) */
  motifProlongation?: string;
  /** Référence ordonnance JLD */
  ordonnanceJLD?: string;
  /** Date du débat JLD ayant abouti à cette période */
  dateDebatJLD?: string;
  /** Notes libres */
  notes?: string;
}

/** État courant des mesures de sûreté (discriminated union) */
export type MesureSurete =
  | { type: 'libre'; depuis?: string; notes?: string }
  | { type: 'cj'; depuis: string; obligations?: string[]; notes?: string }
  | { type: 'arse'; depuis: string; lieu?: string; notes?: string }
  | {
      type: 'detenu';
      /** Date de premier placement en DP */
      depuis: string;
      /** Régime principal applicable au MEX */
      regime: RegimeDetentionProvisoire;
      /** Liste chronologique des périodes (placement initial + prolongations) */
      periodes: PeriodeDetentionProvisoire[];
      notes?: string;
    };

/** Mis en examen — entité centrale de chaque dossier d'instruction */
export interface MisEnExamen {
  id: number;

  // Identité
  nom: string;                    // "DUPONT Jean"
  dateNaissance?: string;
  lieuNaissance?: string;
  nationalite?: string;
  profession?: string;
  adresse?: string;

  // Mise en examen
  dateMiseEnExamen: string;

  // Charges & infractions
  infractions: InfractionReproche[];
  /** Synthèse libre des éléments à charge contre lui */
  elementsCharge?: string;

  // Personnalité
  elementsPersonnalite: ElementPersonnalite[];

  // Mesures de sûreté
  mesureSurete: MesureSurete;

  // DML (par MEX, pour suivre qui en dépose et compter)
  dmls: DemandeMiseEnLiberte[];

  // Notes brèves
  notes?: string;
}

// ──────────────────────────────────────────────
// OP fixée par le JI (le juge d'instruction programme une vague d'OP)
// ──────────────────────────────────────────────

export interface OPInstruction {
  id: number;
  /** Date prévue de l'opération */
  date: string;
  description?: string;
  /** Service en charge */
  service?: string;
  /** Réquisitions parquet rédigées ? */
  requisitionsRedigees?: boolean;
  dateRequisitions?: string;
  notes?: string;
}

// ──────────────────────────────────────────────
// DÉBAT JLD planifié
// ──────────────────────────────────────────────

export type TypeDebatJLD = 'placement_dp' | 'prolongation_dp' | 'dml' | 'autre';

export interface DebatJLDPlanifie {
  id: number;
  /** Date communiquée par le JLD (avec ou sans heure exacte) */
  date: string;
  /** Heure exacte connue ? (sinon date seule) */
  heureExacte?: boolean;
  type: TypeDebatJLD;
  /** MEX concerné */
  misEnExamenId?: number;
  /** Réquisitions parquet rédigées ? */
  requisitionsRedigees?: boolean;
  dateRequisitions?: string;
  /** Décision rendue (si débat passé) */
  decision?: 'placement' | 'maintien' | 'remise_en_liberte' | 'cj' | 'arse' | 'autre';
  notes?: string;
}

// ──────────────────────────────────────────────
// NOTE PERSO (par dossier — distincte des CR enquête)
// ──────────────────────────────────────────────

export interface NotePersoInstruction {
  id: number;
  date: string;
  contenu: string;
  /** Tags optionnels (ex: "expertise", "JLD", "audition") */
  tags?: string[];
  /** Auteur (windowsUsername) */
  auteur?: string;
}

// ──────────────────────────────────────────────
// VÉRIFICATION PÉRIODIQUE
// ──────────────────────────────────────────────

export interface VerificationPeriodique {
  id: number;
  /** Date à laquelle le point a été fait */
  date: string;
  /** Notes du point dossier */
  contenu?: string;
  /** Checklist du point */
  checklist?: {
    actesEnCours?: boolean;
    expertisesEnCours?: boolean;
    mexQuiDorment?: boolean;
    delaiDP?: boolean;
    relanceJI?: boolean;
  };
  auteur?: string;
}

// ──────────────────────────────────────────────
// ÉTAT DU RÈGLEMENT
// ──────────────────────────────────────────────

export type EtatReglement =
  | 'en_cours'           // instruction en cours
  | '175_recu'           // 175 reçu (avis de fin d'information)
  | 'reqdef_redigees'    // réquisitions définitives rédigées (RD)
  | 'ordonnance_rendue'; // ordonnance de règlement rendue

// ──────────────────────────────────────────────
// ORIENTATION PRÉVISIBLE (tag)
// ──────────────────────────────────────────────

export type OrientationPrevisible =
  | 'TC'
  | 'CCD'
  | 'Assises'
  | 'TPE'
  | 'CAM'
  | 'non_lieu'
  | 'incertain';

// ──────────────────────────────────────────────
// VICTIME / PARTIE CIVILE
// ──────────────────────────────────────────────

export interface Victime {
  id: number;
  nom: string;
  /** Constituée partie civile ? */
  partieCivile?: boolean;
  /** Date de constitution */
  datePC?: string;
  notes?: string;
}

// ──────────────────────────────────────────────
// ORIGINE DU DOSSIER
// ──────────────────────────────────────────────

export type OrigineDossier =
  | 'preliminaire'
  | 'flagrance'
  | 'plainte_avec_cpc'
  | 'autre';

// ──────────────────────────────────────────────
// DOSSIER D'INSTRUCTION (entité racine)
// ──────────────────────────────────────────────

export interface DossierInstruction {
  id: number;

  // Identifiants
  /** N° d'instruction interne (ex: "JIRS AC 23/05") */
  numeroInstruction: string;
  /** N° de parquet rattaché */
  numeroParquet: string;
  /** Référence au cabinet (Cabinet.id) */
  cabinetId: string;
  /** Magistrat instructeur en charge */
  magistratInstructeur?: string;

  // Données générales
  description?: string;
  origine?: OrigineDossier;
  /** Lien optionnel vers l'enquête préliminaire d'origine */
  enquetePreliminaireId?: number;
  serviceEnqueteur?: string;
  /** Tags (notamment infractions) */
  tags?: Tag[];

  // Dates clés
  /** Date d'ouverture du dossier (souvent = date du RI) */
  dateOuverture: string;
  /** Date du réquisitoire introductif */
  dateRI: string;

  // Personnes
  misEnExamen: MisEnExamen[];
  victimes?: Victime[];

  // Suivi & échéances
  ops: OPInstruction[];
  debatsJLD: DebatJLDPlanifie[];
  notesPerso: NotePersoInstruction[];
  verifications: VerificationPeriodique[];

  // État règlement & orientation
  etatReglement: EtatReglement;
  orientationPrevisible?: OrientationPrevisible;

  // Compteurs incrémentables
  cotesTomes?: number;

  // Suivis transversaux (drapeaux)
  suiviJIRS?: boolean;
  suiviPG?: boolean;

  // Métadonnées
  dateCreation: string;
  dateMiseAJour: string;
}

// ──────────────────────────────────────────────
// HELPERS DE TYPES (utiles pour les composants)
// ──────────────────────────────────────────────

/** Données nécessaires à la création d'un dossier (sans ID ni dates auto) */
export type NewDossierInstructionData = Omit<
  DossierInstruction,
  'id' | 'dateCreation' | 'dateMiseAJour'
>;
