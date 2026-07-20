// utils/dataSync/DataMergeService.ts

import { Enquete } from '@/types/interfaces';
import { ResultatAudience } from '@/types/audienceTypes';
import { SyncData, SyncConflict } from '@/types/dataSyncTypes';
import { TagRequest } from '@/utils/tagRequestManager';
import { mergeModifications, mergeLastViewedBy } from '@/utils/modificationLogger';

/**
 * Service de fusion des données pour la synchronisation
 *
 * PRINCIPE UNIQUE : "le plus récent gagne"
 * - Les sous-éléments (CR, MEC, actes…) sont unis par ID (rien ne se perd)
 * - Pour un même ID modifié des deux côtés, la version issue de l'enquête la plus récente l'emporte
 * - Seul conflit restant : suppression d'une enquête par un collègue (choix irréversible → demande à l'utilisateur)
 */
export class DataMergeService {

  // ─── POINT D'ENTRÉE PRINCIPAL ─────────────────────────────────────────────

  static intelligentMerge(localData: SyncData, serverData: SyncData): {
    merged: SyncData;
    conflicts: SyncConflict[];
    stats: { newFromServer: number; newFromLocal: number; merged: number; newActesFromServer: number; newCRsFromServer: number; newMECsFromServer: number; acteChanges: Array<{ enqueteNumero: string; count: number }> };
    hasLocalChanges: boolean;   // local a des données plus récentes → push nécessaire
    hasServerChanges: boolean;  // serveur a des données plus récentes → saveLocal nécessaire
  } {
    const conflicts: SyncConflict[] = [];
    const stats = { newFromServer: 0, newFromLocal: 0, merged: 0, newActesFromServer: 0, newCRsFromServer: 0, newMECsFromServer: 0, acteChanges: [] as Array<{ enqueteNumero: string; count: number }> };

    // Union des IDs supprimés
    const localDeletedIds = new Set<number>(localData.deletedIds || []);
    const serverDeletedIds = new Set<number>(serverData.deletedIds || []);
    const mergedDeletedIds = Array.from(new Set([...localDeletedIds, ...serverDeletedIds]));

    const localDeletedActeIds = new Set<number>(localData.deletedActeIds || []);
    const serverDeletedActeIds = new Set<number>(serverData.deletedActeIds || []);
    const mergedDeletedActeIds = Array.from(new Set([...localDeletedActeIds, ...serverDeletedActeIds]));

    const localDeletedCRIds = new Set<number>(localData.deletedCRIds || []);
    const serverDeletedCRIds = new Set<number>(serverData.deletedCRIds || []);
    const mergedDeletedCRIds = Array.from(new Set([...localDeletedCRIds, ...serverDeletedCRIds]));

    const localDeletedMECIds = new Set<number>(localData.deletedMECIds || []);
    const serverDeletedMECIds = new Set<number>(serverData.deletedMECIds || []);
    const mergedDeletedMECIds = Array.from(new Set([...localDeletedMECIds, ...serverDeletedMECIds]));

    // 1. Fusionner les enquêtes
    const {
      merged: mergedEnquetes,
      conflicts: enqueteConflicts,
      stats: enqueteStats
    } = this.mergeEnquetes(
      localData.enquetes || [],
      serverData.enquetes || [],
      localDeletedIds,
      serverDeletedIds,
      // Union local+serveur : une suppression d'acte/CR/MEC effectuée UNIQUEMENT
      // côté serveur (tombstone pas encore propagé en local) doit aussi filtrer
      // le sous-élément, sinon il ressuscite jusqu'au cycle de sync suivant.
      new Set(mergedDeletedActeIds),
      new Set(mergedDeletedCRIds),
      new Set(mergedDeletedMECIds)
    );

    conflicts.push(...enqueteConflicts);
    stats.newFromServer += enqueteStats.newFromServer;
    stats.newFromLocal += enqueteStats.newFromLocal;
    stats.merged += enqueteStats.merged;
    stats.newActesFromServer += enqueteStats.newActesFromServer;
    stats.newCRsFromServer += enqueteStats.newCRsFromServer;
    stats.newMECsFromServer += enqueteStats.newMECsFromServer;
    stats.acteChanges.push(...enqueteStats.acteChanges);

    // Détecter si des changements réels existent dans chaque direction
    const serverDeletedSet = new Set([
      ...(serverData.deletedIds || []),
      ...(serverData.deletedActeIds || []),
      ...(serverData.deletedCRIds || []),
      ...(serverData.deletedMECIds || []),
    ]);
    const localDeletedHasNew = [
      ...(localData.deletedIds || []),
      ...(localData.deletedActeIds || []),
      ...(localData.deletedCRIds || []),
      ...(localData.deletedMECIds || []),
    ].some(id => !serverDeletedSet.has(id));

    const hasLocalChanges =
      enqueteStats.newFromLocal > 0 ||
      enqueteStats.localHasNewer ||
      localDeletedHasNew;

    // Un CR, un mis en cause ou un acte AJOUTÉ côté serveur (typiquement par
    // l'attaché, qui écrit dans le coffre) doit toujours être rapatrié en local,
    // même si l'enquête locale porte un `dateMiseAJour` égal ou plus récent
    // (décalage d'horloge entre le conteneur attaché et le poste, ou édition
    // locale concomitante). Sans ces deltas, le sous-élément survit dans `merged`
    // (union par id) mais `saveLocalData` était sauté : il restait dans le coffre
    // — visible en chronologie probatoire — sans jamais atteindre la liste des
    // comptes rendus / des mis en cause. Les actes disposaient déjà de ce filet
    // (newActesFromServer) ; on l'étend aux CR et aux mis en cause.
    const hasServerChanges =
      enqueteStats.newFromServer > 0 ||
      enqueteStats.serverHasNewer ||
      enqueteStats.newActesFromServer > 0 ||
      enqueteStats.newCRsFromServer > 0 ||
      enqueteStats.newMECsFromServer > 0;

    // 2. Fusionner les résultats d'audience (timestamp-based)
    const mergedAudience = this.mergeByTimestamp(
      localData.audienceResultats || {},
      serverData.audienceResultats || {},
      r => r.modifiedAt
    );

    // 3. Tags (union par ID, local prioritaire)
    const localTags  = Array.isArray(localData.customTags)  ? localData.customTags  : [];
    const serverTags = Array.isArray(serverData.customTags) ? serverData.customTags : [];
    const mergedTags = this.mergeArrayById(localTags, serverTags);

    // 4. Règles d'alertes (union par ID, local prioritaire)
    const mergedRules = this.mergeArrayById(localData.alertRules || [], serverData.alertRules || []);

    // 5. Validations d'alertes (union, le plus récent gagne)
    const mergedValidations = this.mergeByTimestamp(
      localData.alertValidations || {},
      serverData.alertValidations || {},
      v => v.validatedAt
    );

    // 6. Demandes de tags (union par id, reviewedAt le plus récent gagne)
    const mergedTagRequests = this.mergeTagRequestsById(
      localData.tagRequests || [],
      serverData.tagRequests || []
    );

    return {
      merged: {
        enquetes: mergedEnquetes,
        audienceResultats: mergedAudience,
        customTags: mergedTags,
        alertRules: mergedRules,
        alertValidations: mergedValidations,
        tagRequests: mergedTagRequests,
        deletedIds: mergedDeletedIds,
        deletedActeIds: mergedDeletedActeIds,
        deletedCRIds: mergedDeletedCRIds,
        deletedMECIds: mergedDeletedMECIds,
        version: Math.max(localData.version || 0, serverData.version || 0) + 1
      },
      conflicts,
      stats,
      hasLocalChanges,
      hasServerChanges
    };
  }

  // ─── ENQUÊTES ─────────────────────────────────────────────────────────────

  private static mergeEnquetes(
    localEnquetes: Enquete[],
    serverEnquetes: Enquete[],
    localDeletedIds: Set<number>,
    serverDeletedIds: Set<number>,
    localDeletedActeIds: Set<number>,
    localDeletedCRIds: Set<number> = new Set(),
    localDeletedMECIds: Set<number> = new Set()
  ): {
    merged: Enquete[];
    conflicts: SyncConflict[];
    stats: { newFromServer: number; newFromLocal: number; merged: number; newActesFromServer: number; newCRsFromServer: number; newMECsFromServer: number; acteChanges: Array<{ enqueteNumero: string; count: number }>; localHasNewer: boolean; serverHasNewer: boolean };
  } {
    const conflicts: SyncConflict[] = [];
    const merged = new Map<number, Enquete>();
    const stats = { newFromServer: 0, newFromLocal: 0, merged: 0, newActesFromServer: 0, newCRsFromServer: 0, newMECsFromServer: 0, acteChanges: [] as Array<{ enqueteNumero: string; count: number }>, localHasNewer: false, serverHasNewer: false };

    const localMap = new Map(localEnquetes.map(e => [e.id, e]));
    const serverMap = new Map(serverEnquetes.map(e => [e.id, e]));

    // 1. Enquêtes serveur
    for (const [id, serverEnquete] of serverMap) {
      const localEnquete = localMap.get(id);

      if (!localEnquete) {
        if (localDeletedIds.has(id)) {
          // Supprimée localement → ne pas re-ajouter
          continue;
        }
        // Nouvelle enquête serveur
        merged.set(id, serverEnquete);
        stats.newFromServer++;
        continue;
      }

      // Existe des deux côtés → fusion automatique
      const mergeResult = this.mergeEnquete(localEnquete, serverEnquete, localDeletedActeIds, localDeletedCRIds, localDeletedMECIds);
      merged.set(id, mergeResult.merged);
      stats.merged++;

      const localTs  = new Date(localEnquete.dateMiseAJour).getTime();
      const serverTs = new Date(serverEnquete.dateMiseAJour).getTime();
      if (localTs  > serverTs) stats.localHasNewer  = true;
      if (serverTs > localTs)  stats.serverHasNewer = true;
      // La fusion a fait avancer la description au-delà de la version locale
      // (actualisation attaché adoptée sans divergence) → forcer l'écriture locale.
      if (mergeResult.merged.description !== localEnquete.description) stats.serverHasNewer = true;

      // Compter les nouveaux actes récupérés
      const localActeCount = (localEnquete.actes?.length ?? 0) + (localEnquete.ecoutes?.length ?? 0) + (localEnquete.geolocalisations?.length ?? 0);
      const mergedActeCount = (mergeResult.merged.actes?.length ?? 0) + (mergeResult.merged.ecoutes?.length ?? 0) + (mergeResult.merged.geolocalisations?.length ?? 0);
      const delta = mergedActeCount - localActeCount;
      if (delta > 0) {
        stats.newActesFromServer += delta;
        stats.acteChanges.push({ enqueteNumero: serverEnquete.numero, count: delta });
      }

      // Même filet pour les CR et les mis en cause : un ajout côté serveur
      // (l'attaché signe au nom du magistrat) doit forcer l'écriture locale,
      // sans quoi il reste invisible dans la liste des comptes rendus / MEC
      // tant que le `dateMiseAJour` local n'est pas dépassé (cf. hasServerChanges).
      const localCRCount = localEnquete.comptesRendus?.length ?? 0;
      const mergedCRCount = mergeResult.merged.comptesRendus?.length ?? 0;
      if (mergedCRCount > localCRCount) stats.newCRsFromServer += mergedCRCount - localCRCount;

      const localMECCount = localEnquete.misEnCause?.length ?? 0;
      const mergedMECCount = mergeResult.merged.misEnCause?.length ?? 0;
      if (mergedMECCount > localMECCount) stats.newMECsFromServer += mergedMECCount - localMECCount;
    }

    // 2. Enquêtes locales uniquement
    for (const [id, localEnquete] of localMap) {
      if (!serverMap.has(id)) {
        if (serverDeletedIds.has(id)) {
          // Supprimée par un collègue → CONFLIT (seul cas restant)
          conflicts.push({
            type: 'enquete_deleted',
            enqueteId: id,
            enqueteNumero: localEnquete.numero,
            details: ['Enquête présente localement mais supprimée sur le serveur par un collègue'],
            localData: localEnquete,
            serverData: null,
            localTimestamp: localEnquete.dateMiseAJour
          });
          merged.set(id, localEnquete);
          continue;
        }
        // Nouvelle enquête locale
        merged.set(id, localEnquete);
        stats.newFromLocal++;
      }
    }

    return { merged: Array.from(merged.values()), conflicts, stats };
  }

  /**
   * Fusionne deux versions d'une même enquête.
   * Principe : union des sous-éléments par ID, le plus récent gagne pour les doublons.
   * Ne retourne jamais de conflit.
   */
  public static mergeEnquete(
    local: Enquete,
    server: Enquete,
    deletedActeIds?: Set<number>,
    deletedCRIds?: Set<number>,
    deletedMECIds?: Set<number>
  ): { merged: Enquete; } {
    const deletedIds    = deletedActeIds || new Set<number>();
    const deletedCRs    = deletedCRIds   || new Set<number>();
    const deletedMECs   = deletedMECIds  || new Set<number>();
    const localTs  = new Date(local.dateMiseAJour).getTime();
    const serverTs = new Date(server.dateMiseAJour).getTime();
    const localIsNewer = localTs >= serverTs;
    const newer = localIsNewer ? local : server;
    const older = localIsNewer ? server : local;

    // Résolution du conflit d'archivage :
    // Si dateArchivage d'un côté est plus récente que le dateMiseAJour de l'autre côté (qui était en_cours),
    // l'archivage gagne. Cela évite qu'une mise à jour anodine (CR, MEC…) sur une machine non synchronisée
    // n'écrase un archivage effectué sur une autre machine.
    const localArchiveTs  = local.dateArchivage  ? new Date(local.dateArchivage).getTime()  : 0;
    const serverArchiveTs = server.dateArchivage ? new Date(server.dateArchivage).getTime() : 0;
    let mergedStatut: Enquete['statut'] = newer.statut;
    let mergedDateArchivage: string | undefined = newer.dateArchivage;
    if (localArchiveTs > 0 && localArchiveTs >= serverTs) {
      // L'archivage local est postérieur à la dernière modif serveur → archive l'emporte
      mergedStatut = 'archive';
      mergedDateArchivage = local.dateArchivage;
    } else if (serverArchiveTs > 0 && serverArchiveTs >= localTs) {
      // L'archivage serveur est postérieur à la dernière modif locale → archive l'emporte
      mergedStatut = 'archive';
      mergedDateArchivage = server.dateArchivage;
    }

    // Actualisation de la description par l'attaché (synthèse des faits qui
    // s'enrichit à chaque élément nouveau). La description est un champ scalaire :
    // le spread `...newer` la fige sur la version la plus récente par horodatage,
    // si bien qu'une actualisation côté serveur était perdue dès que l'enquête
    // locale portait un `dateMiseAJour` égal ou plus récent (décalage d'horloge,
    // édition locale). `actualiser_description` archivant l'ancien texte dans
    // `descriptionHistory`, on peut avancer SANS RISQUE sur la description du
    // serveur uniquement quand le local affiche encore EXACTEMENT le texte que
    // l'attaché a remplacé (dernière entrée d'historique) — preuve que le
    // magistrat n'a pas fait d'édition manuelle divergente entre-temps.
    type DescHist = Array<{ description?: string }>;
    const localHist  = Array.isArray((local  as { descriptionHistory?: DescHist }).descriptionHistory)  ? (local  as { descriptionHistory?: DescHist }).descriptionHistory! : [];
    const serverHist = Array.isArray((server as { descriptionHistory?: DescHist }).descriptionHistory) ? (server as { descriptionHistory?: DescHist }).descriptionHistory! : [];
    let descOverride: { description: Enquete['description']; descriptionHistory: DescHist } | null = null;
    if (serverHist.length > localHist.length) {
      const dernierTexteRemplace = String(serverHist[serverHist.length - 1]?.description ?? '');
      if (String(local.description ?? '') === dernierTexteRemplace) {
        descOverride = { description: server.description, descriptionHistory: serverHist };
      }
    }

    return {
      merged: {
        ...newer,
        ...(descOverride || {}),
        statut: mergedStatut,
        dateArchivage: mergedDateArchivage,
        // Union des sous-éléments par ID (on ne perd rien, les suppressions intentionnelles sont respectées)
        comptesRendus: this.unionById(
          local.comptesRendus.filter(cr => !deletedCRs.has(cr.id)),
          server.comptesRendus.filter(cr => !deletedCRs.has(cr.id)),
          localIsNewer
        ),
        misEnCause: this.unionById(
          local.misEnCause.filter(m => !deletedMECs.has(m.id)),
          server.misEnCause.filter(m => !deletedMECs.has(m.id)),
          localIsNewer
        ),
        actes: this.unionById(
          (local.actes || []).filter(a => !deletedIds.has(a.id)),
          (server.actes || []).filter(a => !deletedIds.has(a.id)),
          localIsNewer
        ),
        ecoutes: this.unionById(
          (local.ecoutes || []).filter(a => !deletedIds.has(a.id)),
          (server.ecoutes || []).filter(a => !deletedIds.has(a.id)),
          localIsNewer
        ),
        geolocalisations: this.unionById(
          (local.geolocalisations || []).filter(a => !deletedIds.has(a.id)),
          (server.geolocalisations || []).filter(a => !deletedIds.has(a.id)),
          localIsNewer
        ),
        tags: this.unionById(local.tags || [], server.tags || [], localIsNewer),
        // Suivi, communications, etc. : prendre la version la plus récente
        suivi: newer.suivi || older.suivi,
        communications: newer.communications || older.communications,
        checklist: newer.checklist || older.checklist,
        documents: this.unionById(newer.documents || [], older.documents || [], true),
        toDos: newer.toDos || older.toDos,
        // Suivi des modifications inter-utilisateurs : union par id (pas de perte
        // sur écritures concurrentes), max-par-utilisateur pour `lastViewedBy`.
        modifications: mergeModifications(local.modifications, server.modifications),
        lastViewedBy: mergeLastViewedBy(local.lastViewedBy, server.lastViewedBy),
        // Timestamp : garder le réel (ne pas gonfler)
        dateMiseAJour: newer.dateMiseAJour
      }
    };
  }

  // ─── UTILITAIRES GÉNÉRIQUES ───────────────────────────────────────────────

  /**
   * Union de deux tableaux par ID. Pour les doublons, `localIsNewer` détermine quelle version garder.
   */
  private static unionById<T extends { id: string | number }>(local: T[], server: T[], localIsNewer: boolean): T[] {
    const merged = new Map<string | number, T>();

    // D'abord la version "perdante", puis la "gagnante" qui écrase les doublons
    const first = localIsNewer ? server : local;
    const second = localIsNewer ? local : server;

    first.forEach(item => merged.set(item.id, item));
    second.forEach(item => merged.set(item.id, item));

    return Array.from(merged.values());
  }

  /**
   * Union de deux tableaux par ID (local prioritaire). Utilisé pour les règles d'alertes.
   */
  private static mergeArrayById<T extends { id: number | string }>(local: T[], server: T[]): T[] {
    const merged = new Map<number | string, T>();
    server.forEach(item => merged.set(item.id, item));
    local.forEach(item => merged.set(item.id, item));
    return Array.from(merged.values());
  }

  /**
   * Fusion dédiée aux demandes de tags : union par id, reviewedAt le plus récent gagne.
   * Égalité (typiquement deux 'pending' sans reviewedAt) → version locale conservée.
   */
  private static mergeTagRequestsById(local: TagRequest[], server: TagRequest[]): TagRequest[] {
    const merged = new Map<string, TagRequest>();
    server.forEach(r => merged.set(r.id, r));
    for (const localReq of local) {
      const serverReq = merged.get(localReq.id);
      if (!serverReq) { merged.set(localReq.id, localReq); continue; }
      const localTs  = localReq.reviewedAt  ? new Date(localReq.reviewedAt).getTime()  : 0;
      const serverTs = serverReq.reviewedAt ? new Date(serverReq.reviewedAt).getTime() : 0;
      merged.set(localReq.id, localTs >= serverTs ? localReq : serverReq);
    }
    return Array.from(merged.values());
  }

  /**
   * Fusionne deux Record<string, T> en prenant la version la plus récente pour chaque clé.
   * Si un élément n'a pas de timestamp, la version locale est préférée.
   */
  private static mergeByTimestamp<T>(
    local: Record<string, T>,
    server: Record<string, T>,
    getTimestamp: (item: T) => string | undefined
  ): Record<string, T> {
    const merged: Record<string, T> = { ...server };

    for (const [key, localItem] of Object.entries(local)) {
      const serverItem = merged[key];

      if (!serverItem) {
        merged[key] = localItem;
      } else {
        const localDate = new Date(getTimestamp(localItem) ?? 0).getTime();
        const serverDate = new Date(getTimestamp(serverItem) ?? 0).getTime();
        if (localDate >= serverDate) {
          merged[key] = localItem;
        }
      }
    }

    return merged;
  }

  // ─── LABELS ───────────────────────────────────────────────────────────────

  static getConflictTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      'enquete_deleted': 'Enquête supprimée sur le serveur',
    };
    return labels[type] || 'Conflit';
  }
}
