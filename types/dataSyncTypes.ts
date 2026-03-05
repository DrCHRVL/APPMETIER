// types/dataSyncTypes.ts

import { Enquete } from './interfaces';
import { ResultatAudience } from './audienceTypes';

/**
 * Structure des données synchronisées entre le serveur et les clients
 */
export interface SyncData {
  enquetes: Enquete[];
  audienceResultats: Record<string, ResultatAudience>;
  customTags: Record<string, any>;
  alertRules: any[];
  version: number;
}

/**
 * Métadonnées de synchronisation
 */
export interface SyncMetadata {
  lastModified: string;           // ISO timestamp
  modifiedBy: string;              // Nom de l'utilisateur
  computerName: string;            // Nom de l'ordinateur
  version: number;                 // Version des données
  appVersion?: string;             // Version de l'application
}

/**
 * Statut de la synchronisation
 */
export interface SyncStatus {
  isOnline: boolean;               // Serveur accessible ?
  isSync: boolean;                 // Sync en cours ?
  lastSyncAttempt: string | null;  // Dernière tentative
  lastSuccessfulSync: string | null; // Dernier succès
  currentUser: string;             // Utilisateur actuel
  hasPendingChanges?: boolean;     // Changements non synchronisés
}

/**
 * Types de conflits détectés
 */
export type ConflictType = 
  | 'enquete_modified'    // Enquête modifiée des 2 côtés
  | 'enquete_deleted'     // Enquête supprimée d'un côté
  | 'enquete_new'         // Nouvelle enquête des 2 côtés avec même ID
  | 'audience_modified'   // Résultat audience modifié
  | 'tags_modified'       // Tags modifiés
  | 'rules_modified';     // Règles d'alertes modifiées

/**
 * Détails d'un conflit
 */
export interface SyncConflict {
  type: ConflictType;
  enqueteNumero?: string;
  enqueteId?: number;
  details: string[];                // Liste des modifications conflictuelles
  localData?: any;                  // Données locales
  serverData?: any;                 // Données serveur
  localTimestamp?: string;
  serverTimestamp?: string;
}

/**
 * Résultat d'une tentative de synchronisation
 */
export interface SyncResult {
  success: boolean;
  timestamp: string;
  action: 'first_sync' | 'no_conflicts' | 'conflicts_detected' | 'error';
  conflicts?: SyncConflict[];
  serverData?: SyncData;
  localData?: SyncData;
  error?: string;
  changesApplied?: {
    enquetesAdded: number;
    enquetesUpdated: number;
    audienceResultsAdded: number;
    tagsUpdated: boolean;
  };
}

/**
 * Action choisie pour un conflit individuel
 */
export type ConflictAction = 'merge' | 'skip' | 'keep_local' | 'keep_server';

/**
 * Options de résolution de conflit
 */
export type ConflictResolution =
  | 'keep_local'      // Garder les données locales
  | 'keep_server'     // Garder les données serveur
  | 'merge'           // Fusionner intelligemment
  | 'cancel';         // Annuler la synchronisation

/**
 * Notification de changement détecté
 */
export interface ChangeNotification {
  id: string;
  type: 'enquete_added' | 'enquete_updated' | 'enquete_deleted' | 'audience_added' | 'tags_updated';
  enqueteId?: number;
  enqueteNumero?: string;
  timestamp: string;
  modifiedBy: string;
  description: string;
}

/**
 * Configuration de la synchronisation
 */
export interface SyncConfig {
  serverPath: string;              // Chemin du serveur commun
  syncInterval: number;            // Intervalle en ms (défaut: 5 min)
  autoSync: boolean;               // Sync auto activée ?
  conflictStrategy: 'ask' | 'auto_merge' | 'keep_local'; // Stratégie par défaut
  maxRetries: number;              // Nombre max de tentatives
  retryDelay: number;              // Délai entre tentatives (ms)
}

/**
 * Statistiques de synchronisation
 */
export interface SyncStats {
  totalSyncs: number;
  successfulSyncs: number;
  failedSyncs: number;
  lastSyncDuration?: number;       // En ms
  averageSyncDuration?: number;    // En ms
  conflictsResolved: number;
  dataTransferred?: number;        // En bytes
}
