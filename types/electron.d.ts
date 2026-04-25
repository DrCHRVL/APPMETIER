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

  // Fichiers globaux partagés (tag-data.json, audience-data.json)
  globalSync_pullTags?: () => Promise<import('./globalSyncTypes').TagSyncFile | null>;
  globalSync_pushTags?: (payload: import('./globalSyncTypes').TagSyncFile) => Promise<boolean>;
  globalSync_pullAudience?: () => Promise<import('./globalSyncTypes').AudienceSyncFile | null>;
  globalSync_pushAudience?: (payload: import('./globalSyncTypes').AudienceSyncFile) => Promise<boolean>;
  globalSync_pullAlerts?: () => Promise<import('./globalSyncTypes').AlertSyncFile | null>;
  globalSync_pushAlerts?: (payload: import('./globalSyncTypes').AlertSyncFile) => Promise<boolean>;
  globalSync_pullDeletedIds?: () => Promise<import('./globalSyncTypes').DeletedIdsSyncFile | null>;
  globalSync_pushDeletedIds?: (payload: import('./globalSyncTypes').DeletedIdsSyncFile) => Promise<boolean>;
  globalSync_readLegacyAppData?: () => Promise<any | null>;
  globalSync_pullUserPreferences?: (username: string) => Promise<import('./globalSyncTypes').UserPreferencesFile | null>;
  globalSync_pushUserPreferences?: (username: string, payload: import('./globalSyncTypes').UserPreferencesFile) => Promise<boolean>;
  globalSync_pullContentieuxAlerts?: (contentieuxId: string) => Promise<import('./globalSyncTypes').ContentieuxAlertsSyncFile | null>;
  globalSync_pushContentieuxAlerts?: (contentieuxId: string, payload: import('./globalSyncTypes').ContentieuxAlertsSyncFile) => Promise<boolean>;
  /** Liste les fichiers backup admin (admin/backups/) avec parsing du nom. */
  dataSync_listAdminBackups?: () => Promise<Array<{ filename: string; kind: 'user-preferences' | 'contentieux-alerts' | 'tag-data' | 'audience-data' | 'alerts-data' | 'deleted-ids'; identifier: string | null; rawTimestamp: string }>>;
  /** Restaure un backup admin vers son emplacement d'origine. Backup automatique de l'état courant avant écrasement. */
  dataSync_restoreAdminBackup?: (filename: string) => Promise<boolean>;
  /** Copie le fichier sync serveur actuel vers un fichier backup avec le nom fourni (ou écrase l'unique backup si aucun nom). */
  dataSync_backupServer?: (filename?: string) => Promise<boolean>;
  /** Supprime un fichier backup du dossier serveur. */
  dataSync_deleteServerBackup?: (filename: string) => Promise<boolean>;
  /** Lit un fichier backup serveur (.json) et retourne son contenu parsé. */
  dataSync_readServerBackup?: (filename: string) => Promise<{ data: import('./dataSyncTypes').SyncData; metadata: import('./dataSyncTypes').SyncMetadata } | null>;
  /** Liste les fichiers backup présents dans le dossier serveur (app-data-backup-*.json). */
  dataSync_listServerBackups?: () => Promise<string[]>;
  getCurrentUser?: () => Promise<{ displayName: string; computerName: string }>;

  // Heartbeat
  writeHeartbeat?: (username: string, heartbeat: any) => Promise<boolean>;
  removeHeartbeat?: (username: string) => Promise<boolean>;
  readAllHeartbeats?: () => Promise<any[]>;

  // Événements partagés
  writeSharedEvent?: (event: any) => Promise<boolean>;
  cleanupSharedEvents?: (ttlMs: number) => Promise<boolean>;
  startEventsWatcher?: () => Promise<boolean>;
  onSharedEvent?: (callback: (event: any) => void) => void;

  // Journal d'audit
  appendAuditLog?: (entry: any, maxEntries: number) => Promise<boolean>;
  readAuditLog?: () => Promise<any[]>;

  // MISE À JOUR DE L'APPLICATION
  checkAppUpdate?: (forceRefresh?: boolean) => Promise<{
    hasUpdate: boolean;
    commits: number;
    error?: string;
    localSha?: string | null;
    remoteSha?: string | null;
    approvedSha?: string | null;
    approvedBy?: string | null;
    approvedAt?: string | null;
  }>;
  applyAppUpdate?: () => Promise<{ success: boolean; error?: string; needsInstall?: boolean; needsRebuild?: boolean }>;
  getUpdateChangelog?: (localSha: string, remoteSha: string) => Promise<{
    success: boolean;
    error?: string;
    commits: Array<{ sha: string; message: string; author: string; date: string | null; url: string | null }>;
  }>;
  approveAppUpdate?: (sha: string, approvedBy: string) => Promise<{
    success: boolean;
    error?: string;
    approvedSha?: string;
    approvedBy?: string;
    approvedAt?: string;
  }>;
  unapproveAppUpdate?: () => Promise<{ success: boolean; error?: string }>;
  getApprovedAppUpdate?: () => Promise<{ approvedSha: string | null; approvedBy: string | null; approvedAt: string | null }>;

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

  // API pour le scan et analyse des PDFs du chemin externe
  scanExternalPDFs?: (
    externalPath: string,
    enqueteNumero: string,
    useSubfolder?: boolean
  ) => Promise<{
    documents: Array<{
      filePath: string;
      fileName: string;
      sourceFolder: string;
      textContent: string;
    }>;
    errors: string[];
    foldersScanned: string[];
  }>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};