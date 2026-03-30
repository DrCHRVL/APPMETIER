// Types pour la gestion des tags
export interface Tag {
  id: string;
  value: string;
  category: 'services' | 'infractions' | 'suivi' | 'duree' | 'statut' | 'juge';
}

// Interface pour les comptes rendus
export interface CompteRendu {
  id: number;
  date: string;
  enqueteur: string;
  description: string;
  createdBy?: string; // Identifiant système de l'auteur (Windows username)
}

// Interface pour les tâches à faire
export interface ToDoItem {
  id: number;
  text: string;
  status: 'active' | 'completed';
  dateCreation: string;
  dateCompletion?: string;
}

export type ActeStatus =
  | 'en_cours'
  | 'termine'
  | 'a_renouveler'
  | 'prolongation_pending'
  | 'pose_pending'
  | 'autorisation_pending'
  | 'refuse';

// Interface de base pour tous les actes
interface BaseActe {
  id: number;
  dateDebut: string;
  dateFin: string;
  duree: string;
  dureeUnit?: 'jours' | 'mois'; // Si absent = 'jours' (rétrocompatibilité)
  maxProlongations?: number;     // Nb max de prolongations légales (undefined = pas de limite fixe)
  datePose?: string;
  statut: ActeStatus;
  prolongationData?: {
    dateDebut: string;
    duree: string;
  };
  prolongationDate?: string;
  prolongationsHistory?: ProlongationHistoryEntry[];
}

// Interface pour les données de géolocalisation
export interface GeolocData extends BaseActe {
  objet: string;
  description?: string;
}

// Interface pour les données d'écoute
export interface EcouteData extends BaseActe {
  numero: string;
  cible?: string;
  description?: string;
}

// Interface pour les autres actes
export interface AutreActe extends BaseActe {
  type: string;
  description: string;
}

// Nouvelle interface pour l'historique des prolongations
export interface ProlongationHistoryEntry {
  date: string;              // Date de la prolongation
  dureeAjoutee: string;      // Durée ajoutée (valeur dans l'unité ci-dessous)
  dureeInitiale: string;     // Durée avant cette prolongation
  dureeUnit?: 'jours' | 'mois'; // Unité de la prolongation (si absent = 'jours')
  dureeInitialeUnit?: 'jours' | 'mois'; // Unité de la durée initiale (si absent = celle de l'acte)
}

// Interface pour les documents attachés à une enquête
export interface DocumentEnquete {
  id: number;
  nom: string;
  nomOriginal: string;
  extension: string;
  taille: number;
  dateAjout: string;
  cheminRelatif: string; // Chemin relatif depuis le dossier de l'enquête
  type: 'pdf' | 'doc' | 'docx' | 'odt' | 'image' | 'html' | 'msg' | 'txt' | 'autre';
}

// Interface pour les résultats d'analyse de documents
export interface DocumentAnalysisResult {
  fileName: string;
  enqueteId: number;
  category: 
    | 'prolongation_ecoute' 
    | 'nouvelle_ecoute' 
    | 'prolongation_geolocalisation'
    | 'nouvelle_geolocalisation'
    | 'prolongation_captation_images'
    | 'nouvelle_captation_images'
    | 'devis'
    | 'soit_transmis'
    | 'autre';
  confidence: number; // Entre 0 et 1
  extractedData: {
    // Données pour écoutes
    numero?: string;
    cible?: string;
    ligne?: string;
    
    // Données pour géolocalisation
    vehicule?: string;
    plaques?: string[];
    objet?: string;
    
    // Données communes
    dateDebut?: string;
    dateFin?: string;
    duree?: string;
    description?: string;
    
    // Métadonnées
    tribunal?: string;
    procureur?: string;
    numeroParquet?: string;
  };
  suggestedAction: string;
  priority: 'high' | 'medium' | 'low';
  createdAt: string;
}

// Interface pour les mis en cause
export interface MisEnCause {
  id: number;
  nom: string;
  role?: string;
  statut: string;
}

// Pour le suivi des dossiers d'instruction
export interface SuiviEntry {
  id: number;
  date: string;
  contenu: string;
  type: 'note' | 'demande' | 'requisitoire';
}

// Pour les communications avec le juge d'instruction
export interface Communication {
  id: number;
  date: string;
  contenu: string;
  statut: 'en_attente' | 'accepte' | 'refuse';
}

// Pour la checklist procédurale
export interface Checklist {
  qualification?: boolean;
  prescription?: boolean;
  competence?: boolean;
  expertises?: boolean;
  confrontations?: boolean;
  temoins?: boolean;
  elementsCharge?: boolean;
  elementsDecharge?: boolean;
  qualificationFinale?: boolean;
}

// Interface pour les données d'une nouvelle enquête
export interface NewEnqueteData {
  numero: string;
  dateDebut: string;
  services: string[];
  description?: string;
  directeurEnquete?: string;
  numeroParquet?: string;
  dateOP?: string;          // Date de l'opération d'interpellation
  misEnCause: MisEnCause[];
  geolocalisations?: GeolocData[];
  ecoutes?: EcouteData[];
  actes: AutreActe[];
  comptesRendus: CompteRendu[];
  notes: string;
  tags: Tag[];
  cheminBase?: string;
  documents?: DocumentEnquete[];
  cheminExterne?: string;
  useSubfolderForExternal?: boolean;
}

// Interface principale pour une enquête
export interface Enquete extends NewEnqueteData {
  id: number;
  dateCreation: string;
  dateMiseAJour: string;
  statut: 'en_cours' | 'archive' | 'instruction';
  dateArchivage?: string; // Timestamp de la dernière opération d'archivage (pour résolution des conflits de sync)
  dateAudience?: string;
  // Champs pour le suivi d'instruction
  suivi?: SuiviEntry[];
  communications?: Communication[];
  checklist?: Checklist;
  documents: DocumentEnquete[];
  toDos?: ToDoItem[];
  // Multi-utilisateurs : épingles Overboard (PRA/VP/Admin)
  overboardPins?: import('@/types/userTypes').OverboardPin[];
}

// Configuration de la récurrence
export interface RecurrenceConfig {
  enabled: boolean;
  interval: number; // Intervalle en jours
  maxOccurrences?: number; // Nombre maximal d'occurrences, optionnel
  currentOccurrence?: number; // Nombre actuel d'occurrences
}

// Interface pour les alertes
export interface Alert {
  id: number;
  enqueteId: number;
  type: string;
  message: string;
  createdAt: string;
  status: 'active' | 'validated'| 'snoozed';
  deadline?: string;
  acteId?: number;
  prolongationData?: {
    dateDebut: string;
    duree: string;
  };
  snoozedUntil?: string;           // Date jusqu'à laquelle l'alerte est reportée
  snoozedCount?: number;           // Nombre de fois que l'alerte a été reportée
  validatedForEnquete?: boolean;   // Si true, ne plus jamais montrer cette alerte pour cette enquête
  recurrence?: RecurrenceConfig;   // Configuration de récurrence
  lastRecurred?: string;           // Date de la dernière récurrence
  // Champs spécifiques pour les alertes AIR
  isAIRAlert?: boolean;            // Indique s'il s'agit d'une alerte AIR
  airIdentite?: string;            // Identité de la personne concernée par la mesure AIR
  airNumeroParquet?: string;       // Numéro de parquet de la mesure AIR
}

export interface AlertValidation {
  validatedAt: string;
  acteId?: number;
  type: string;
}

export interface AlertValidations {
  [key: string]: AlertValidation;
}

// Configuration du récapitulatif hebdomadaire
export interface WeeklyPopupConfig {
  enabled: boolean;
  dayOfWeek: number;   // 0=Dimanche, 1=Lundi ... 6=Samedi, 7=Chaque jour
  hour: number;        // 0–23
  lastShownDate?: string; // ISO date, pour éviter d'afficher plusieurs fois le même jour
}

// Types pour les alertes visuelles sur EnquetePreview
export type VisualAlertTrigger =
  | 'op_active'            // OP date dépassée
  | 'op_proche'            // OP dans X jours
  | 'acte_critique'        // Acte expire dans X jours
  | 'cr_retard'            // CR en retard depuis X jours
  | 'prolongation_pending' // Prolongation en attente depuis X jours
  | 'autorisation_pending' // Autorisation JLD initiale en attente depuis X jours
  | 'jld_pending';         // JLD en attente : autorisation OU prolongation depuis X jours

export type VisualAlertMode = 'fond' | 'bordure' | 'fond_bordure';

export type VisualAlertColorKey = 'red' | 'red-dark' | 'orange' | 'amber' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray';

export interface VisualAlertRule {
  id: number;
  trigger: VisualAlertTrigger;
  label: string;
  seuil: number;            // nombre de jours (0 pour op_active = dépassée)
  mode: VisualAlertMode;
  fondColor: VisualAlertColorKey;
  bordureColor: VisualAlertColorKey;
  enabled: boolean;
  priority: number;         // ordre de priorité (1 = plus important)
  isSystemRule?: boolean;
}

// Interface pour les règles d'alerte
export interface AlertRule {
  id: number;
  type: string;
  name: string;
  description?: string;
  threshold: number;
  enabled: boolean;
  acteType?: string;
  isSystemRule?: boolean;
  // Nouveaux champs pour la récurrence
  recurrence?: {
    enabled: boolean;
    defaultInterval: number; // Intervalle par défaut en jours
    maxOccurrences?: number; // Nombre maximal d'occurrences, optionnel
  };
}

// Interface pour les données du gestionnaire de dates
export interface DateManagerData {
  dateDebut: string;
  dateFin?: string;
  datePose?: string;
  duree: string;
  dureeUnit?: 'jours' | 'mois';
  maxProlongations?: number;
  updatedStatut?: ActeStatus;
}

// --- INTERFACES POUR AIR ---

export interface AIRImportData {
  // Données procédurales
  refAEM: string;                    // Réf. AEM (colonne B)
  dateReception: string;             // Date réception (colonne C)
  faits: string;                     // Fusion de Faits 1 + Faits 2 (colonnes H + I)
  origine?: string;                  // Origine - CP/CSC/CJ/Autre
  
  // Données personnelles/bénéficiaires
  nomPrenom: string;                 // Concernant Nom - Prénom (colonne J)
  adresse?: string;                  // Adresse (non utilisé)
  telephone?: string;                // N° de Téléphone + Mail (non utilisé)
  dateNaissance?: string;            // Date de naissance (colonne M)
  lieuNaissance?: string;            // Lieu de naissance (colonne N)
  secteurGeographique?: string;      // Secteur géographique du suivi (colonne O)
  commentaires?: string;             // Commentaires / Observations
  
  // Données suivi AIR
  referent?: string;                 // En charge de (colonne R)
  nombreEntretiensAIR: number;       // ENTRETIENS AIR (colonne U)
  nombreRencontresPR?: number;       // Rencontre Proc. (colonne V)
  nombreCarences?: number;           // Nb. De carences (colonne V)
  lieuConvocation?: string;          // Lieu Convoc
  nombreVAD?: number;                // Nombre de V.A.D
  accompagnementExterieur?: string;  // Accompagnement extérieur
  
  // Données fin de mesure
  dateFinPriseEnCharge?: string;     // Date fin de prise en charge
  natureFinAIR?: string;             // Nature fin AIR
  resultatMesure?: string;           // Résultat de mesure Réussite / echec (colonne AM)
  orientationFinMesure?: string;     // Orientation en fin de mesure (colonne AO)
  dateCloture?: string;              // Date Clôture (colonne AP)
  dureeEnMois?: number;              // DUREE DE LA MESURE En mois
  
  // Données additionnelles
  typesAddiction?: string;           // Types d'addiction (colonne AA)
  suiviAddictologique?: string;      // Suivi addictologique (colonne AC)
  suiviPsychologique?: string;       // Suivi psychologique (colonne AF)
  suiviPsychiatrique?: string;       // Suivi psychiatrique (colonne AG)
  hebergementDebut?: string;         // Hébergement en début de mesure (colonne BA)
  hebergementFin?: string;           // Hébergement en fin de mesure (colonne BB)
  activiteProfessionnelleDebut?: string; // Activité professionnelle début (colonne BD)
  activiteProfessionnelleFin?: string;   // Activité professionnelle fin (colonne BE)
  permisDeConduireDebut?: string;    // Permis de conduire début (colonne BH)
  permisDeConduireFin?: string;      // Permis de conduire fin (colonne BI)
  
  // Numéro de parquet (ajouté depuis greffe ou AEM)
  numeroParquet?: string;
  
  // Statut calculé automatiquement
  statut?: AIRStatus;

  // Métadonnées sur l'origine des données
  sourceGreffe?: boolean;            // Indique si la mesure provient du greffe (pour coloration)
  updatedFromAEM?: boolean;          // Indique si mise à jour depuis AEM
}

export type AIRStatus = 'en_cours' | 'termine' | 'echec' | 'reussite';

/** Alias pour AIRImportData - utilisé dans les hooks d'alertes */
export type AIRMesure = AIRImportData;

// 🆕 TYPES POUR LE GREFFE
export interface GreffeData {
  numeroParquet: string;
  nomPrenom: string;
  dateConvocation?: string;
}

export interface GreffeValidationResult {
  isValid: boolean;
  confidence: 'high' | 'medium' | 'low';
  message: string;
  foundHeaders: boolean;
  dataRowsCount: number;
  headerRowIndex?: number;
}

export interface GreffeMappingResult {
  mapping: Record<string, number>;
  confidence: 'high' | 'medium' | 'low';
  method: 'fixed' | 'dynamic';
  foundFields: string[];
  missingFields: string[];
}

export interface ComparisonMatch {
  greffe: GreffeData;
  air: AIRImportData;
  similarity: number;
  confidence: 'exact' | 'high' | 'medium' | 'low';
  matchType: 'numero' | 'nom' | 'nom_date';
}

export interface ComparisonResult {
  // Correspondances sûres (>90%)
  matches: ComparisonMatch[];
  
  // Correspondances probables (70-90%) - section doute
  probables: ComparisonMatch[];
  
  // Présents dans le greffe mais pas dans l'AEM
  onlyInGreffe: GreffeData[];
  
  // Présents dans l'AEM mais pas dans le greffe
  onlyInAir: AIRImportData[];
  
  // Statistiques
  stats: {
    totalGreffe: number;
    totalAir: number;
    matches: number;
    probables: number;
    onlyGreffe: number;
    onlyAir: number;
  };
}

// 🆕 TYPES POUR LE FLUX BIDIRECTIONNEL
export interface SyncResult {
  greffeToAir: {
    updated: number;
    created: number;
  };
  airToGreffe: {
    updated: number;
    statusUpdated: number;
  };
  conflicts: {
    numeroParquet: ComparisonMatch[];
    status: ComparisonMatch[];
  };
}

export interface SyncOptions {
  updateNumeroParquet: boolean;
  createFromGreffe: boolean;
  updateStatusFromAir: boolean;
  conflictResolution: 'manual' | 'air_priority' | 'greffe_priority';
}

// Interface pour les DML (nouvelles loi : 10 jours)
export interface DML {
  id: number;
  dateDepot: string;
  dateEcheance: string; // Auto: +10 jours ouvrables (nouvelle loi)
  statut: 'en_attente' | 'rejetee' | 'accordee';
  notes?: string;
  concernedDetenus?: number[]; // IDs des détenus concernés
}

// Interface pour les OP (phases interpellation) - VERSION CORRIGÉE
export interface OP {
  id: number;
  date: string;
  dureeJours?: number;
  description?: string;
  
  // Interpellations dans cette phase
  interpellations?: {
    id: number;
    nomPersonne: string;
    misEnExamenId?: number; // Lien vers le mis en examen si applicable
    dateInterpellation: string;
    debatParquetId?: number; // Lien vers le débat si placement DP
  }[];
  
  // Compteurs automatiques
  nbInterpellations?: number; // Calculé depuis interpellations.length
  nbDebats?: number; // Calculé depuis les débats générés par cette OP
}

// Interface pour les mis en examen (VERSION CORRIGÉE)
export interface MisEnExamen {
  id: number;
  nom: string;
  dateExamen: string;
  chefs: string[]; // Chefs d'inculpation
  role?: 'libre' | 'detenu'; // Statut du mis en examen (pour compatibilité)
  statut?: 'libre' | 'cj' | 'detenu' | 'arse'; // Statut étendu
  description?: string; // Observations optionnelles
  
  // Gestion détention provisoire
  datePlacementDP?: string;     // Date de placement en DP
  dureeInitialeDP?: number;     // Durée initiale en mois
  dateFinDP?: string;           // Date de fin calculée automatiquement
  dateRenouvellementDP?: string; // Date du renouvellement s'il y en a eu
  dureeRenouvellementDP?: number; // Durée du renouvellement en mois
  dateFinRenouvellementDP?: string; // Date de fin après renouvellement
  
  // Historique des débats liés à cette personne
  debatsHistory?: {
    debatId: number;
    type: 'placement_dp' | 'prolongation_dp';
    date: string;
    decision: string;
  }[];
}

// Interface pour les débats parquet (VERSION CORRIGÉE)
export interface DebatParquet {
  id: number;
  date: string;
  type: 'placement_dp' | 'prolongation_dp' | 'dml' | 'autre';
  issue?: string;
  notes?: string;
  
  // Liens pour éviter les doubles comptages
  concernedDetenu?: number; // ID du mis en examen concerné
  originatedFromOP?: number; // ID de l'OP qui a généré ce débat (si applicable)
  sourceType?: 'manual' | 'op_generated' | 'renouvellement'; // Source du débat
}

// Interface pour les mesures de sûreté
export interface MesuresSurete {
  dp?: {
    dateDebut: string;
    dateFin: string;
    alerteActive: boolean;
    joursRestants?: number;
  };
  cj?: {
    dateDebut: string;
    dateFin: string;
    obligations: string[];
  };
  arse?: {
    dateDebut: string;
    dateFin: string;
  };
}

// Interface pour RD et rapports
export interface RDData {
  rendu: boolean;
  nbPages?: number;
  dateRendu?: string;
}

export interface RapportAppel {
  rendu: boolean;
  nbPages?: number;
  dateRendu?: string;
}

// Extension de l'interface Enquete pour les instructions
export interface EnqueteInstruction extends Enquete {
  // Champs obligatoires création
  numeroParquet: string;           // "24.139.217"
  numeroInstruction: string;       // "JIRS AC 23/05"
  cabinet: '1' | '2' | '3' | '4';  // Couleurs : rose, crème, vert, bleu
  origineEnquete: 'preliminaire' | 'flagrance';
  serviceEnqueteur: string;        // Réutilise tags services existants
  
  // État règlement avec curseur
  etatReglement: 'instruction' | '175_rendu' | 'rd_fait' | 'ordonnance_rendue';
  
  // Compteurs automatiques (calculés)
  readonly nbDML: number;          // Auto-calculé depuis dmls.length
  readonly nbCotes: number;        // Incrémentable manuellement
  readonly nbDebatsParquet: number; // Auto-calculé
  readonly nbMisEnExamen: number;  // Auto-calculé depuis misEnExamen.length
  readonly nbPagesTotal: number;   // RD + rapport (règle spéciale si même dossier)
  
  // Listes de données
  dmls: DML[];
  ops: OP[];
  misEnExamen: MisEnExamen[];
  debatsParquet: DebatParquet[];
  
  // Mesures de sûreté avec alertes
  mesuresSurete?: MesuresSurete;
  
  // Orientation finale
  orientation?: 'TC' | 'CCD' | 'Assises' | 'TPE' | 'CAM' | 'non_lieu';
  
  // RD et rapports
  rdData?: RDData;
  rapportAppel?: RapportAppel;
  
  // Côtes/tomes incrémentable
  cotesTomes: number;
  
  // Timeline personnalisée
  timeline?: TimelineEvent[];
}

// Interface pour la timeline
export interface TimelineEvent {
  id: number;
  date: string;
  type: 'ouverture' | 'dml' | 'debat' | 'rd' | 'rapport' | 'ordonnance' | 'expertise' | 'cr' | 'audition' | 'interrogatoire' | 'autre';
  title: string;
  description?: string;
  automatic?: boolean;
}

// Couleurs par cabinet - EXPORTÉ
export const CABINET_COLORS = {
  '1': 'bg-rose-50 border-rose-200 hover:bg-rose-100',     // Rose pâle
  '2': 'bg-amber-50 border-amber-200 hover:bg-amber-100',  // Crème
  '3': 'bg-green-50 border-green-200 hover:bg-green-100',  // Vert pâle
  '4': 'bg-blue-50 border-blue-200 hover:bg-blue-100'     // Bleu pâle
} as const;

// Types pour les alertes instruction
export interface AlerteInstruction extends Alert {
  instructionId: number;
  cabinetId: string;
  alerteType: 'dp_expiration' | 'dml_retard' | 'delai_175' | 'expertise_echeance';
}