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
import { AlertRule, AlertValidations, VisualAlertRule, AlerteInstruction } from './interfaces';
import { ContentieuxId } from './userTypes';

export interface GlobalSyncMetadata {
  version: number;
  updatedAt: string;  // ISO timestamp
  updatedBy: string;  // displayName
  computerName: string;
}

/**
 * Tombstone de suppression pour les tags et demandes de tags (IDs string).
 * Empêche la résurrection d'un élément supprimé quand un autre poste
 * encore désynchronisé pousserait son état vers le serveur.
 * Nettoyés après TAG_TOMBSTONE_TTL_DAYS jours.
 */
export interface TagTombstone {
  id: string;
  deletedAt: string;
}

export interface TagSyncFile extends GlobalSyncMetadata {
  customTags: TagDefinition[];
  tagRequests: TagRequest[];
  deletedTagIds?: TagTombstone[];
  deletedTagRequestIds?: TagTombstone[];
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

/**
 * Préférences utilisateur synchronisées sur le serveur commun.
 * Un fichier par utilisateur : user-preferences/{windowsUsername}.json.
 * Structure volontairement ouverte (chaque clé est optionnelle) pour pouvoir
 * accueillir d'autres préférences par utilisateur plus tard sans migration.
 */
export interface UserPreferencesFile extends GlobalSyncMetadata {
  windowsUsername: string;
  weeklyRecap?: {
    subscribedContentieux: string[];
  };
  /**
   * Organisation personnelle des services dans l'onglet
   * "Organisation des services". Chaque utilisateur a sa propre liste
   * ordonnée de sections + ses propres rattachements tag→section.
   * `seeded` passe à true une fois la migration depuis l'organisation
   * globale effectuée pour cet utilisateur, pour éviter d'écraser ses
   * modifications ultérieures.
   */
  serviceOrganization?: {
    seeded?: boolean;
    sections?: string[];
    tagSections?: Record<string, string>;
  };
  /**
   * Abonnements aux alertes partagées par contentieux. Les règles
   * d'alertes (délai CR, expiration acte…) vivent côté serveur dans
   * `contentieux-alerts/{id}.json` (partagées par toute l'équipe) ;
   * chaque utilisateur choisit quels contentieux écouter pour alimenter
   * sa cloche. Si le champ est absent, l'utilisateur est considéré
   * auto-abonné à tous les contentieux auxquels il a accès.
   */
  subscribedContentieuxAlerts?: ContentieuxId[];
  /**
   * Validations d'alertes personnelles. Avant cette refacto, le geste
   * « j'ai validé l'alerte X sur l'enquête Y » était partagé par toute
   * l'équipe. Désormais chaque utilisateur a son propre journal.
   */
  alertValidations?: {
    seeded?: boolean;
    entries?: AlertValidations;
  };
  /** Règles d'alertes visuelles (badges sur la grille) personnelles. */
  visualAlertRules?: {
    seeded?: boolean;
    rules?: VisualAlertRule[];
  };
  /**
   * Surlignage ambre de la ligne « Dernier CR » sur la carte enquête
   * lorsqu'une alerte cr_delay est active. Activé par défaut. Toggle dans
   * la section « Alertes visuelles personnelles ».
   */
  crDelayHighlight?: boolean;
  /**
   * Snapshot des alertes d'instruction (DP, DML, délai 175) personnelles —
   * principalement utile pour conserver l'état "snoozed" entre machines.
   */
  instructionAlerts?: {
    seeded?: boolean;
    alerts?: AlerteInstruction[];
  };
}

/**
 * Règles d'alertes partagées pour un contentieux. Éditables uniquement
 * par un magistrat affecté au contentieux ou par un admin. Chaque user
 * s'abonne via `UserPreferencesFile.subscribedContentieuxAlerts` pour
 * alimenter sa cloche. Fichier serveur : `contentieux-alerts/{id}.json`.
 */
export interface ContentieuxAlertsSyncFile extends GlobalSyncMetadata {
  contentieuxId: ContentieuxId;
  rules: AlertRule[];
}
