// types/electron.d.ts
import { DocumentEnquete } from './interfaces';

// Interface pour les résultats de synchronisation
export interface SyncResult {
  totalInternal: number;
  totalExternal: number;
  addedToInternal: string[];
  addedToExternal: string[];
  errors: string[];
  externalAccessible: boolean;
}

// Interface pour les résultats de scan
export interface ScanResult {
  newDocuments: DocumentEnquete[];
  errors: string[];
}

interface ElectronAPI {
  // API de base pour le stockage de données
  getData: <T>(key: string, defaultValue?: T) => Promise<T>;
  setData: <T>(key: string, value: T) => Promise<boolean>;
  clearData: (key: string) => Promise<boolean>;
  getAllKeys: () => Promise<string[]>;
  
  openFileDialog: (options: any) => Promise<string | null>;
  openExternalFile: (filePath: string) => Promise<boolean>;
  
  // API pour la gestion des fichiers de sauvegarde
  saveFile: (folder: string, filename: string, content: string) => Promise<boolean>;
  readFile: (folder: string, filename: string) => Promise<string | null>;
  listFiles: (folder: string) => Promise<string[]>;
  deleteFile: (folder: string, filename: string) => Promise<boolean>;
  saveFileDialog: (defaultName: string, content: string) => Promise<boolean>;
  
  // APIS POUR DATA.JSON
  copyDataJson: (backupFileName: string) => Promise<boolean>;
  restoreDataJson: (backupFileName: string) => Promise<boolean>;
  getDataJsonInfo: () => Promise<{
    size: number;
    lastModified: string;
    path: string;
  } | null>;
  compareWithDataJson: (backupFileName: string) => Promise<{
    dataJsonExists: boolean;
    backupExists: boolean;
    dataJsonSize: number;
    backupSize: number;
    sizeDifference: number;
  } | null>;
  listDataJsonBackups: () => Promise<string[]>;
  getBackupStats: () => Promise<{
    dataJsonExists: boolean;
    dataJsonSize: number;
    dataJsonLastModified: string | null;
    totalBackups: number;
    dataJsonBackups: number;
    selectiveBackups: number;
    totalBackupSize: number;
  } | null>;
  cleanOldBackups: (keepCount?: number) => Promise<{
    success: boolean;
    removed?: number;
    error?: string;
  }>;
  
  // API POUR DOCUMENTS AVEC CATÉGORIES
  saveDocuments: (
    enqueteNumero: string,
    files: Array<{name: string, arrayBuffer: ArrayBuffer}>,
    category: string
  ) => Promise<DocumentEnquete[]>;
  
  // API POUR GESTION EXTERNE AVEC SUPPORT USESUBFOLDER
  copyToExternalPath: (
    enqueteNumero: string,
    externalPath: string,
    files: DocumentEnquete[],
    category: string,
    useSubfolder?: boolean
  ) => Promise<boolean>;
  
  validatePath: (pathToValidate: string) => Promise<boolean>;
  selectFolder: () => Promise<string | null>;
  
  openExternalFolder: (
    externalPath: string,
    enqueteNumero: string,
    useSubfolder?: boolean
  ) => Promise<boolean>;
  
  // API POUR SYNCHRONISATION DES DONNÉES (DataSyncManager)
  // Note : ces méthodes ne sont pas exposées par toutes les versions du preload.
  // Elles sont toujours appelées avec optional chaining (?.).
  dataSync_checkAccess?: () => Promise<boolean>;
  dataSync_pull?: () => Promise<{ data: import('./dataSyncTypes').SyncData; metadata: import('./dataSyncTypes').SyncMetadata } | null>;
  dataSync_push?: (data: import('./dataSyncTypes').SyncData, metadata: import('./dataSyncTypes').SyncMetadata) => Promise<boolean>;
  /** Copie le fichier sync serveur actuel vers un fichier backup (écrase le backup précédent). */
  dataSync_backupServer?: () => Promise<boolean>;
  getCurrentUser?: () => Promise<{ displayName: string; computerName: string }>;

  // NOUVELLES API POUR SYNCHRONISATION
  syncDocuments: (
    enqueteNumero: string,
    externalPath: string,
    useSubfolder?: boolean
  ) => Promise<SyncResult>;
  
  scanForNewDocuments: (
    enqueteNumero: string,
    existingDocumentPaths: string[]
  ) => Promise<ScanResult>;
  
  // API DOCUMENTS EXISTANTES
  deleteFromExternalPath: (
    externalPath: string,
    enqueteNumero: string,
    cheminRelatif: string
  ) => Promise<boolean>;
  
  deleteDocument: (
    enqueteNumero: string,
    cheminRelatif: string,
    externalPath?: string | null,
    useSubfolder?: boolean
  ) => Promise<boolean>;
  
  openDocument: (enqueteNumero: string, cheminRelatif: string) => Promise<boolean>;
  documentExists: (enqueteNumero: string, cheminRelatif: string) => Promise<boolean>;
  getDocumentSize: (enqueteNumero: string, cheminRelatif: string) => Promise<number>;
  
  // API pour l'extraction de texte PDF - CORRIGÉE
  extractPDFText: (buffer: Uint8Array) => Promise<string>;

  // Extraction de texte PDF par chemin relatif (utilisé pour la recherche dans les documents)
  extractPdfText?: (cheminRelatif: string) => Promise<string | null>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};