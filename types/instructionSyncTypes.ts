// types/instructionSyncTypes.ts
//
// Types pour la synchronisation réseau du module instruction.
// Sauvegarde PRIVÉE par utilisateur : un fichier par magistrat
// (<safeUser>-instructions.json) dans le dossier réseau qu'il a choisi.
// Aucune fusion inter-utilisateurs — seulement entre les postes d'un même
// utilisateur, d'où une stratégie de fusion par dossier (date la plus
// récente) complétée de tombstones pour propager les suppressions.

import type { DossierInstruction } from './instructionTypes';

/** Tombstone de suppression d'un dossier d'instruction (id numérique). */
export interface InstructionTombstone {
  id: number;
  deletedAt: string; // ISO date
}

/** Fichier réseau des dossiers d'instruction d'un utilisateur. */
export interface InstructionSyncFile {
  version: number;
  updatedAt: string;   // ISO date
  updatedBy: string;   // displayName
  computerName: string;
  windowsUsername: string;
  dossiers: DossierInstruction[];
  deletedIds: InstructionTombstone[];
  /**
   * Partage du module : usernames (windowsUsername) avec qui ce magistrat
   * accepte de fusionner ses dossiers d'instruction. Le partage n'est effectif
   * que s'il est RÉCIPROQUE (double consentement) : A et B doivent chacun citer
   * l'autre. Sert aussi d'« invitation » — un partenaire qui me cite sans que je
   * le cite est une invitation en attente, que je peux accepter ou refuser.
   */
  shareWith?: string[];
}
