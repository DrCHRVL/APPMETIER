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
