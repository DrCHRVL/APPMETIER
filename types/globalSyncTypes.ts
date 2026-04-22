// types/globalSyncTypes.ts
//
// Types pour les fichiers globaux partagés sur le serveur commun.
// Chaque catégorie transverse aux contentieux (tags, résultats d'audience)
// possède son propre fichier à la racine du serveur, avec sa propre
// sérialisation. Ce découplage remplace le vieux pipeline app-data.json
// racine (DataSyncManager) qui ne détectait plus les changements depuis
// la bascule en multi-contentieux.

import { TagDefinition } from '@/config/tags';
import { TagRequest } from '@/utils/tagRequestManager';
import { ResultatAudience } from './audienceTypes';
import { AlertRule, AlertValidations } from './interfaces';

export interface GlobalSyncMetadata {
  version: number;
  updatedAt: string;  // ISO timestamp
  updatedBy: string;  // displayName
  computerName: string;
}

export interface TagSyncFile extends GlobalSyncMetadata {
  customTags: TagDefinition[];
  tagRequests: TagRequest[];
}

export interface AudienceSyncFile extends GlobalSyncMetadata {
  audienceResultats: Record<string, ResultatAudience>;
}

export interface AlertSyncFile extends GlobalSyncMetadata {
  alertRules: AlertRule[];
  alertValidations: AlertValidations;
}

/**
 * Tombstones des éléments supprimés (enquêtes + actes/écoutes/géolocs +
 * comptes-rendus + mis en cause). Empêche la résurrection d'un élément
 * quand une machine avec un cache plus ancien pousserait son état vers
 * le serveur.
 */
export interface DeletedTombstone {
  id: number;
  deletedAt: string;
}

export interface DeletedIdsSyncFile extends GlobalSyncMetadata {
  enqueteIds: DeletedTombstone[];
  acteIds: DeletedTombstone[];
  crIds: DeletedTombstone[];
  mecIds: DeletedTombstone[];
}
