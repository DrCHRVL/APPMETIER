// types/instructionTypes.ts
//
// Modèle de données du module Instruction (refonte complète).
// Ce fichier est la source de vérité pour tout ce qui concerne les dossiers
// d'instruction. Les anciens types (EnqueteInstruction, etc.) ont été retirés.

import type { Tag } from './interfaces';
import type { NatinfRef } from './natinf';

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

/**
 * Type d'événement timeline configurable. Vient enrichir la liste des
 * événements de base (lancement_cr, retour_cr, expertise, ipc, apc,
 * interrogatoire_fond, phase_interpellation).
 */
export interface CustomEvenementType {
  /** Identifiant stable (slug, distinct des types de base) */
  id: string;
  label: string;
  /** Couleur tailwind (ex: "bg-emerald-500") ou hex */
  color?: string;
}

/** Catégorie d'expertise configurable (en plus des catégories de base). */
export interface CustomCategorieExpertise {
  id: string;
  label: string;
}

/** Configuration globale du module instruction (côté serveur partagé) */
export interface InstructionModuleConfig {
  cabinets: Cabinet[];
  /** Types d'événement personnalisés ajoutés par l'utilisateur (en plus des types système). */
  customEvenementTypes?: CustomEvenementType[];
  /** Catégories d'expertise personnalisées (en plus des catégories système). */
  customCategoriesExpertise?: CustomCategorieExpertise[];
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

/** Une infraction reprochée à un mis en examen (chef de mise en examen) */
export interface InfractionReproche {
  id: number;
  /** Qualification pénale (ex: "Trafic de stupéfiants en bande organisée").
   *  Reste la source d'affichage, y compris pour les saisies libres historiques. */
  qualification: string;
  /** Code NATINF rattaché (optionnel, enrichissement du référentiel) */
  natinfCode?: string;
  /** Snapshot dénormalisé du NATINF au moment de la saisie (libellé/nature) */
  natinfRef?: NatinfRef;
  /** Date des faits (ISO) */
  dateInfraction?: string;
  /** Lieu des faits */
  lieuInfraction?: string;
  /** Explication / contexte des faits */
  explication?: string;
}

/** Acte de saisine d'un juge d'instruction */
export type ActeSaisine = 'introductif' | 'suppletif';

/**
 * Un chef de la saisine in rem : le juge d'instruction est saisi des FAITS,
 * qualifiés par le réquisitoire introductif (et étendus par les réquisitoires
 * supplétifs). Distinct des chefs de mise en examen (saisine in personam),
 * qui doivent s'inscrire dans le périmètre de la saisine in rem.
 */
export interface SaisineItem {
  id: number;
  /** Qualification des faits (source d'affichage) */
  qualification: string;
  /** Code NATINF rattaché (optionnel) */
  natinfCode?: string;
  /** Snapshot dénormalisé du NATINF */
  natinfRef?: NatinfRef;
  /** Acte par lequel le juge est saisi de ces faits */
  acte: ActeSaisine;
  /** Date de l'acte de saisine (réquisitoire introductif ou supplétif) */
  dateActe?: string;
  /** Exposé / contexte des faits visés */
  faits?: string;
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
      /**
       * Identifiant du cas légal applicable (cf. config/dpRegimes.ts).
       * Détermine la durée initiale, la durée max et la tranche de prolongation.
       */
      casDPId?: string;
      /** Liste chronologique des périodes (placement initial + prolongations) */
      periodes: PeriodeDetentionProvisoire[];
      /** Compteur des prolongations exceptionnelles CHINS déjà accordées */
      nbProlongationsExceptionnelles?: number;
      notes?: string;
    };

/** Suspect / futur mis en examen — suivi avant la mise en examen formelle */
export interface Suspect {
  id: number;
  nom: string;
  /** Rôle présumé dans l'affaire (optionnel) */
  role?: string;
}

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
  /** Faire apparaître la victime sur le module cartographie (rattachée au dossier,
   *  comme un mis en cause, avec la mention « (Victime) »). */
  surCarto?: boolean;
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
// ÉVÉNEMENTS RICHES DE TIMELINE
// (CR enquêteur, expertises, IPC/APC, interrogatoires, interpellations…)
// ──────────────────────────────────────────────

/**
 * Catégorie d'expertise judiciaire.
 * Les valeurs de base sont listées dans BASE_CATEGORIES_EXPERTISE
 * (config/dpRegimes ou utils). Le type est élargi à `string` pour
 * accepter les catégories personnalisées ajoutées via l'admin.
 */
export type CategorieExpertise =
  | 'psychologique'
  | 'psychiatrique'
  | 'balistique'
  | 'adn'
  | 'papillaire'
  | 'medico_legale'
  | 'autopsie'
  | 'autre'
  | (string & {});

/**
 * Type d'événement libre saisissable dans la timeline.
 * Élargi à `string` pour accepter les types personnalisés ajoutés via l'admin.
 */
export type EvenementInstructionType =
  | 'lancement_cr'
  | 'retour_cr'
  | 'expertise'
  | 'ipc'
  | 'apc'
  | 'interrogatoire_fond'
  | 'phase_interpellation'
  | '175_rendu'
  | (string & {});

/**
 * Événement libre dans la timeline du dossier.
 * Enrichit la chronologie au-delà des éléments structurés (DP, DML, OP, JLD…).
 */
export interface EvenementInstruction {
  id: number;
  type: EvenementInstructionType;
  /** Date de l'événement (ISO) */
  date: string;
  /** Titre court (ex : "CR investigations Brigadier X") */
  titre?: string;
  /** Description / contenu (HTML autorisé) */
  description?: string;
  /** MEX concerné (IPC, expertise psy/psy, interrogatoire au fond…) */
  misEnExamenId?: number;
  /** Victime/partie civile concernée (expertise psy, APC) */
  victimeId?: number;
  /** Référence à une OP existante (phase d'interpellation) */
  opId?: number;
  /** Lien vers le lancement de CR associé (sur retour_cr) */
  lancementCrId?: number;
  /** Catégorie pour les expertises */
  categorieExpertise?: CategorieExpertise;
  /** Libellé libre pour expertise "autre" */
  expertiseLibelle?: string;
}

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
  /**
   * Lien optionnel vers la fiche NPP (intranet justice). Si renseigné, le
   * n° de parquet devient cliquable dans le header et ouvre l'URL dans le
   * navigateur par défaut via shell.openExternal.
   */
  lienNpp?: string;
  /** Référence au cabinet (Cabinet.id) */
  cabinetId: string;
  /** Magistrat instructeur en charge */
  magistratInstructeur?: string;

  /**
   * Contentieux principal du dossier (crimorg, ecofi, enviro, …). Utilisé
   * pour le filtrage cartographie : sans ce champ, toutes les instructions
   * tombent sous une étiquette unique "instructions" et on ne peut pas
   * isoler un domaine. Optionnel pour rétrocompat ; les fiches existantes
   * sans valeur tombent en "instructions" générique.
   */
  contentieuxId?: string;

  // Données générales
  description?: string;
  /**
   * Saisine in rem : qualifications des faits dont le juge est saisi (RI +
   * supplétifs). Remplace la saisie en texte libre dans `description`, qui
   * reste disponible pour le narratif. Optionnel (rétrocompat).
   */
  saisine?: SaisineItem[];
  origine?: OrigineDossier;
  /**
   * Rattachement à l'enquête préliminaire d'origine (résultat = OI).
   * Quand il est renseigné, la cartographie n'affiche plus la préliminaire
   * archivée comme un nœud distinct : le dossier d'instruction la représente
   * (suppression du doublon). L'enquête préliminaire reste intacte dans son
   * module — CR, actes et notes ne sont jamais perdus.
   */
  enquetePreliminaireId?: number;
  /**
   * Contentieux de l'enquête préliminaire liée. Les ids d'enquête peuvent
   * collisionner entre contentieux : on conserve le contentieux pour lever
   * l'ambiguïté côté cartographie (suppression du bon nœud) et ouverture de
   * la fiche d'origine.
   */
  enquetePreliminaireContentieuxId?: string;
  /** N° de l'enquête préliminaire liée, dénormalisé pour l'affichage. */
  enquetePreliminaireNumero?: string;
  serviceEnqueteur?: string;
  /** Tags (notamment infractions) */
  tags?: Tag[];

  // Dates clés
  /** Date d'ouverture du dossier (souvent = date du RI) */
  dateOuverture: string;
  /** Date du réquisitoire introductif */
  dateRI: string;

  // Personnes
  suspects?: Suspect[];
  misEnExamen: MisEnExamen[];
  victimes?: Victime[];

  // Suivi & échéances
  ops: OPInstruction[];
  debatsJLD: DebatJLDPlanifie[];
  notesPerso: NotePersoInstruction[];
  /**
   * Vérifications périodiques (legacy — l'onglet a été retiré de l'UI mais
   * les données existantes sont conservées pour rétrocompat).
   */
  verifications: VerificationPeriodique[];
  /** Événements libres : CR enquêteur, expertises, IPC/APC, interrogatoires… */
  evenements?: EvenementInstruction[];
  /**
   * Bloc-notes libre (HTML) affiché en colonne droite de la timeline :
   * « Actes à faire ou à demander à la JI ». Saisie au kilomètre, sans
   * workflow ni statuts.
   */
  notesActesJI?: string;
  /**
   * Pré-rédactions de synthèses par acte de timeline (HTML).
   * Clé = identifiant de l'événement (item.key dans DossierTimelineSection),
   * valeur = synthèse rédigée pour le réquisitoire définitif.
   */
  acteSyntheses?: Record<string, string>;

  // État règlement & orientation
  etatReglement: EtatReglement;
  orientationPrevisible?: OrientationPrevisible;

  // Compteurs incrémentables
  cotesTomes?: number;

  // Suivis transversaux (drapeaux)
  suiviJIRS?: boolean;
  suiviPG?: boolean;

  // ── Archivage / résultat ──────────────────────────────────────
  /** Vrai = dossier archivé (sorti de la liste des informations en cours) */
  archived?: boolean;
  /** Date à laquelle le dossier a été archivé (ISO) */
  dateArchivage?: string;

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

// ──────────────────────────────────────────────
// RÈGLES D'ALERTES INSTRUCTION (tweakables)
// ──────────────────────────────────────────────

/** Déclencheurs d'alertes du module instruction */
export type InstructionAlertTrigger =
  | 'dp_fin_proche'             // fin de période DP dans X jours
  | 'dp_fin_echue'              // fin de période DP dépassée
  | 'dp_max_proche'             // durée légale max DP dans X jours
  | 'debat_jld_proche'          // débat JLD planifié dans X jours
  | 'dml_echeance_proche'       // échéance DML dans X jours
  | 'dml_retard'                // DML en retard (échéance dépassée, statut en_attente)
  | 'op_ji_proche'              // OP du JI programmée dans X jours
  | 'dossier_dormant'           // pas d'activité (CR/note/vérif) depuis X jours
  | 'verif_periodique_due'      // pas de vérification depuis X jours
  | 'motivation_renforcee_due'  // DP correctionnelle > 8 mois cumulés
  | 'dp_max_legal_atteinte';    // durée légale max de DP atteinte

/** Règle d'alerte instruction tweakable (seuil + activation + couleur) */
export interface InstructionAlertRule {
  id: number;
  trigger: InstructionAlertTrigger;
  label: string;
  /** Seuil en jours (sens dépend du trigger : avant échéance, après dernier événement…) */
  seuil: number;
  enabled: boolean;
  /** Priorité d'affichage (1 = plus important) */
  priority: number;
  /** Couleur d'identification (clé de palette ou hex) */
  color?: string;
  /** Règle système (livrée par défaut, non supprimable mais éditable) */
  isSystemRule?: boolean;
}
