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

// Interface pour la gestion du chargement des documents
export interface DocumentUploadStatus {
  status: 'idle' | 'uploading' | 'success' | 'error';
  progress: number;
  error?: string;
}

// Type pour les réponses de l'API de documents
export type DocumentApiResponse = {
  success: boolean;
  data?: DocumentEnquete;
  error?: string;
};