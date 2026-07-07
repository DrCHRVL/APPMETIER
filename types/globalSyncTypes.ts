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
import type { InstructionAlertRule } from './instructionTypes';
import type { AgendaUrls, AgendaDisplaySettings } from '@/lib/web/agenda';

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
 * Tombstone string-id pour les overlays cartographie (les ids y sont des
 * chaînes : ids canoniques de MEC, dexn_xxx, lien_xxx, cluster_xxx).
 */
export interface CartographieTombstone {
  id: string;
  deletedAt: string;
}

/**
 * Fichier serveur des overlays cartographie partagés par tous les utilisateurs.
 * Une copie du PersistedOverlay du store + des tombstones par catégorie pour
 * que les suppressions survivent à un re-push depuis un poste désynchronisé.
 *
 * Stratégie de merge (cf. CartographieOverlaySyncService) :
 *   - chaque entité porte un updatedAt → "le plus récent gagne par id"
 *   - tombstone pour un id → l'entité est supprimée des deux côtés
 *   - pinnedMecIds : union des deux côtés moins les tombstones
 *     (deletedPinnedMecIds), pour qu'un désépinglage se propage entre postes
 */
export interface CartographieOverlaySyncFile extends GlobalSyncMetadata {
  // Données effectives — voir useCartographieOverlayStore pour les types.
  pinnedMecIds: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mecsExNihilo: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dossiersExNihilo: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  liensRenseignement: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clusterAnnotations: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mecScoreBoosts: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tagZones?: any[];
  // Tombstones de suppression
  deletedMecExNihiloIds?: CartographieTombstone[];
  deletedDossierExNihiloIds?: CartographieTombstone[];
  deletedLienIds?: CartographieTombstone[];
  deletedClusterAnnotationIds?: CartographieTombstone[];
  deletedMecScoreBoostIds?: CartographieTombstone[];
  // Tombstones d'épinglage (clé = id canonique du MEC). Sans ça, le merge
  // par union ressuscitait une épingle retirée localement dès qu'un poste
  // avait encore l'entrée côté serveur.
  deletedPinnedMecIds?: CartographieTombstone[];
  // Tombstones tag → zone (clé = tag). Sans ça, supprimer une assignation
  // côté local était silencieusement annulé par le re-push d'un poste qui
  // avait encore l'entrée.
  deletedTagZones?: CartographieTombstone[];
}

/**
 * Projection MINIMALE d'un dossier (enquête ou instruction) publiée sur la
 * cartographie commune. On ne transporte QUE ce dont le moteur de graphe a
 * besoin (cf. utils/mindmapGraph.buildMindmapGraph) — jamais les notes perso,
 * OPP, débats JLD ou pièces. Confidentialité + poids réseau maîtrisés.
 */
export interface CartoContributionMec {
  /** Id d'origine (facultatif, purement informatif). */
  id?: string | number;
  nom: string;
  statut?: string;
  isVictime?: boolean;
  isSuspect?: boolean;
  suspectRole?: string;
}

export interface CartoContributionInfraction {
  /** Code NATINF (source de pondération cible). */
  natinfCode?: string;
  /** Qualification libre (legacy, best-effort pour l'ancien matching par tag). */
  qualification?: string;
}

export interface CartoContributionMisEnExamen {
  nom: string;
  infractions?: CartoContributionInfraction[];
}

export interface CartoContributionSource {
  contentieuxId: string;
  /** Id numérique du dossier source (clé de dédup : `${contentieuxId}_${id}`). */
  enqueteId: number;
  numero: string;
  /** Statut du dossier (en_cours / archive / instruction…). */
  statut: string;
  dateCreation: string;
  dateMiseAJour?: string;
  /** Services d'enquête (ancrage zonal optionnel). */
  services?: string[];
  misEnCause: CartoContributionMec[];
  /** Présent uniquement pour les dossiers d'instruction (chefs + NATINF). */
  misEnExamen?: CartoContributionMisEnExamen[];
}

/**
 * Contribution d'UN utilisateur à la cartographie commune : la projection de
 * tout ce qu'il voit (ses enquêtes des contentieux accessibles + ses dossiers
 * d'instruction rattachés à un contentieux). Chaque utilisateur n'écrit que sa
 * propre entrée, identifiée par `windowsUsername` → pas de conflit par entité,
 * fusion par "plus récent par utilisateur".
 */
export interface CartoContributorEntry {
  windowsUsername: string;
  /** Nom affichable de l'auteur (pour debug / futur affichage). */
  displayName?: string;
  /** Horodatage ms de la dernière mise à jour de CETTE entrée. */
  updatedAt: number;
  enquetes: CartoContributionSource[];
  instructions: CartoContributionSource[];
}

/**
 * Fichier serveur agrégeant les contributions cartographie de TOUTE l'équipe.
 * Rend le module « commun à tous » : un collègue qui ajoute des dossiers /
 * mis en examen rattachés à un contentieux les voit apparaître chez tout le
 * monde, et la carte couvre tous les contentieux (pas seulement ceux auxquels
 * l'utilisateur courant a accès). Fichier : `cartographie-contributions`.
 *
 * Fusion : chaque entrée est possédée par un seul auteur (clé windowsUsername),
 * donc « le plus récent par auteur gagne ». Les entrées plus vieilles que le
 * TTL (cf. service) sont élaguées pour borner la taille du fichier.
 */
export interface CartographieContributionsSyncFile extends GlobalSyncMetadata {
  contributors: CartoContributorEntry[];
}

/**
 * Fichier serveur de la configuration du module Cartographie, PARTAGÉE par
 * toute l'équipe : pondérations du score Top 10, coefficients par tag
 * d'infraction, regroupement par service. Fichier : `cartographie-config`
 * à la racine du serveur commun.
 *
 * Objet unique (pas une collection d'entités) → fusion simple last-write-wins
 * par `updatedAt` (le plus récent gagne en entier), sans tombstones ni merge
 * par champ. Concrètement, deux éditions quasi simultanées sur des champs
 * différents : le dernier à enregistrer l'emporte sur tout l'objet, comme
 * pour les préférences utilisateur.
 */
export type CartographieConfigSyncFile =
  import('@/types/cartographieTypes').CartographieModuleConfig;

/**
 * Configuration des délais du module AIR (seuils d'alertes de convocation +
 * « mesures anciennes »), partagée par toute l'équipe. Fichier : `air-config`
 * à la racine du serveur commun. Objet unique → fusion last-write-wins par
 * `updatedAt`, comme la config cartographie.
 */
export type AIRConfigSyncFile =
  import('@/types/airConfigTypes').AIRConvocationConfig;

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
  /**
   * Règles d'alertes du module instruction (tweakables par utilisateur :
   * seuils en jours, activation, priorité, couleur). Un seed initial est
   * fait à partir de DEFAULT_INSTRUCTION_ALERT_RULES.
   */
  instructionAlertRules?: {
    seeded?: boolean;
    rules?: InstructionAlertRule[];
  };
  /**
   * Subscription au rappel hebdomadaire pour le module instruction.
   * true = inclure les instructions dans le récap hebdo.
   */
  instructionWeeklyRecapSubscribed?: boolean;
  /**
   * Dossier réseau choisi par l'utilisateur pour la sauvegarde / synchro
   * de ses dossiers d'instruction (module instruction). Vide ou absent =
   * sauvegarde locale uniquement. Propre à chaque utilisateur ; les
   * dossiers ne sont jamais partagés avec d'autres magistrats.
   */
  instructionNetworkPath?: string;
  /**
   * Agendas externes (Google / Outlook / iCloud) connectés en lecture seule
   * via leur adresse secrète iCal, plus les préférences d'affichage du
   * calendrier (taille des événements, couleurs par fournisseur).
   * Synchronisés PAR UTILISATEUR pour suivre le compte entre les différents
   * appareils. `seeded` passe à true après migration unique depuis l'ancien
   * stockage local de l'appareil (clés `agenda_ical_urls` /
   * `agenda_display_settings`).
   */
  agenda?: {
    seeded?: boolean;
    urls?: AgendaUrls;
    display?: AgendaDisplaySettings;
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
