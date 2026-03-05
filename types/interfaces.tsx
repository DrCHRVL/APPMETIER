// Types pour la gestion des documents dans l'application
export interface DocumentEnquete {
  id: number;
  nom: string;
  type: string;
  dateCreation: string;
  dateModification: string;
  taille: number;
  cheminComplet: string;
  categorie: string;
  metadata?: {
    auteur?: string;
    description?: string;
    tags?: string[];
  };
}

// Interface pour les alertes système
export interface Alert {
  type: 'warning' | 'urgent';
  message: string;
}

// Interface pour les comptes rendus
export interface CompteRendu {
  id: number;
  date: string;
  enqueteur: string;
  description: string;
}

// Interface pour les données de géolocalisation
export interface GeolocData {
  id: number;
  objet: string;
  dateDebut: string;
  dateFin: string;
  duree: string;
  datePose: string;
  statut: 'en_cours' | 'termine' | 'a_renouveler';
}

// Interface pour les données d'écoute
export interface EcouteData {
  id: number;
  numero: string;
  cible: string;
  dateDebut: string;
  dateFin: string;
  duree: string;
  datePose?: string;
  statut: 'en_cours' | 'termine' | 'a_renouveler';
}

// Interface pour les autres actes
export interface AutreActe {
  id: number;
  type: string;
  description: string;
  dateDebut: string;
  dateFin: string;
  duree: string;
  datePose?: string;
  statut: 'en_cours' | 'termine' | 'a_renouveler';
}

// Interface pour les mis en cause
export interface MisEnCause {
  id: number;
  nom: string;
  role?: string;
  statut: string;
}

// Interface pour les données d'une nouvelle enquête
export interface NewEnqueteData {
  numero: string;
  dateDebut: string;
  services: string[];
  description?: string;
  misEnCause: MisEnCause[];
  geolocalisations?: GeolocData[];
  ecoutes?: EcouteData[];
  actes: AutreActe[];
  comptesRendus: CompteRendu[];
  documents: DocumentEnquete[]; 
  notes: string;
  tags: string[];
  cheminBase?: string;
}

// Interface principale pour une enquête
export interface Enquete extends NewEnqueteData {
  id: number;
  dateCreation: string;
  dateMiseAJour: string;
  statut: 'en_cours' | 'termine' | 'archive';
  peinePrison?: number;
  argentConfisque?: number;
  vehiculesConfisques?: string[];
}

// Interface pour la gestion des dates
export interface DateManagerData {
  dateDebut: string;
  dateFin: string;
  datePose: string | null | undefined;
  duree: string;
}

// Interface pour l'état de téléchargement des fichiers
export interface FileUploadState {
  file: File | null;
  progress: number;
  error?: string;
  uploading: boolean;
}

// Interface pour la gestion des fichiers
export interface FileManagerState {
  currentDirectory: string;
  files: DocumentEnquete[];
  uploads: { [key: string]: FileUploadState };
  error?: string;
  loading: boolean;
}