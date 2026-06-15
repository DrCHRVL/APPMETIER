// types/airSyncTypes.ts
//
// Types pour la synchronisation réseau du module AIR (mesures AIR).
// Sauvegarde PRIVÉE par utilisateur : un coffre par utilisateur
// (`air-<safeUser>`), avec partage RÉCIPROQUE optionnel entre utilisateurs
// (même modèle que le module instruction). La fusion se fait par `refAEM`
// (clé naturelle de la mesure), la `dateMiseAJour` la plus récente gagne,
// complétée de tombstones pour propager les suppressions.

import type { AIRImportData } from './interfaces';

/** Tombstone de suppression d'une mesure AIR (clé = refAEM). */
export interface AIRTombstone {
  refAEM: string;
  deletedAt: string; // ISO date
}

/** Fichier réseau des mesures AIR d'un utilisateur. */
export interface AIRSyncFile {
  version: number;
  updatedAt: string;   // ISO date
  updatedBy: string;   // displayName
  computerName: string;
  windowsUsername: string;
  mesures: AIRImportData[];
  deletedRefs: AIRTombstone[];
  /**
   * Partage du module : usernames (windowsUsername) avec qui cet utilisateur
   * accepte de fusionner ses mesures AIR. Le partage n'est effectif que s'il
   * est RÉCIPROQUE (double consentement) : A et B doivent chacun citer l'autre.
   * Sert aussi d'« invitation » — un partenaire qui me cite sans que je le cite
   * est une invitation en attente, que je peux accepter ou refuser.
   */
  shareWith?: string[];
}
