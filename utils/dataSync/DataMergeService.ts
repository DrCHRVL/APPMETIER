// utils/dataSync/DataMergeService.ts

import { Enquete, CompteRendu, MisEnCause } from '@/types/interfaces';
import { ResultatAudience } from '@/types/audienceTypes';
import { SyncData, SyncConflict, ConflictType } from '@/types/dataSyncTypes';

/**
 * Service de fusion intelligente et détection de conflits pour la synchronisation des données
 * 
 * LOGIQUE DE FUSION INTELLIGENTE :
 * ✅ Ajouts automatiques (nouveaux CR, MEC, actes) → pas de conflit
 * ✅ Changements de statut normaux (prolongations, poses) → pas de conflit
 * ✅ Nouvelles enquêtes → fusion automatique
 * ⚠️ Modifications contradictoires → conflit
 * ⚠️ TOUTE suppression d'enquête → conflit obligatoire
 */
export class DataMergeService {
  
  /**
   * 🆕 FUSION INTELLIGENTE - Fusionne automatiquement ce qui peut l'être
   * Retourne uniquement les vrais conflits nécessitant intervention utilisateur
   */
  static intelligentMerge(localData: SyncData, serverData: SyncData): {
    merged: SyncData;
    conflicts: SyncConflict[];
    stats: { newFromServer: number; newFromLocal: number; merged: number; newActesFromServer: number; acteChanges: Array<{ enqueteNumero: string; count: number }> };
  } {
    const conflicts: SyncConflict[] = [];
    const stats = { newFromServer: 0, newFromLocal: 0, merged: 0, newActesFromServer: 0, acteChanges: [] as Array<{ enqueteNumero: string; count: number }> };

    // Calculer l'union des IDs supprimés des deux côtés
    const localDeletedIds = new Set<number>(localData.deletedIds || []);
    const serverDeletedIds = new Set<number>(serverData.deletedIds || []);
    const mergedDeletedIds = Array.from(new Set([...localDeletedIds, ...serverDeletedIds]));

    // 1. Fusionner les enquêtes intelligemment (en tenant compte des suppressions)
    const {
      merged: mergedEnquetes,
      conflicts: enqueteConflicts,
      stats: enqueteStats
    } = this.intelligentMergeEnquetes(
      localData.enquetes || [],
      serverData.enquetes || [],
      localDeletedIds,
      serverDeletedIds
    );

    conflicts.push(...enqueteConflicts);
    stats.newFromServer += enqueteStats.newFromServer;
    stats.newFromLocal += enqueteStats.newFromLocal;
    stats.merged += enqueteStats.merged;
    stats.newActesFromServer += enqueteStats.newActesFromServer;
    stats.acteChanges.push(...enqueteStats.acteChanges);

    // 2. Fusionner les résultats d'audience
    const {
      merged: mergedAudience,
      conflicts: audienceConflicts
    } = this.intelligentMergeAudienceResults(
      localData.audienceResultats || {},
      serverData.audienceResultats || {}
    );
    conflicts.push(...audienceConflicts);

    // 3. Fusionner les tags (union simple, local prioritaire)
    const mergedTags = { ...serverData.customTags, ...localData.customTags };

    // 4. Fusionner les règles d'alertes (union par ID, local prioritaire)
    const mergedRules = this.mergeAlertRules(localData.alertRules || [], serverData.alertRules || []);

    // 5. Fusionner les validations d'alertes (union, la plus récente gagne en cas de conflit sur la même clé)
    const mergedValidations = this.mergeAlertValidations(
      localData.alertValidations || {},
      serverData.alertValidations || {}
    );

    return {
      merged: {
        enquetes: mergedEnquetes,
        audienceResultats: mergedAudience,
        customTags: mergedTags,
        alertRules: mergedRules,
        alertValidations: mergedValidations,
        deletedIds: mergedDeletedIds,
        version: Math.max(localData.version || 0, serverData.version || 0) + 1
      },
      conflicts,
      stats
    };
  }

  /**
   * 🆕 Fusion intelligente des enquêtes
   * @param localDeletedIds IDs supprimés localement — ne doivent pas être rajoutés depuis le serveur
   * @param serverDeletedIds IDs supprimés par un collègue sur le serveur — ne doivent pas être re-poussés depuis le local
   */
  private static intelligentMergeEnquetes(
    localEnquetes: Enquete[],
    serverEnquetes: Enquete[],
    localDeletedIds: Set<number> = new Set(),
    serverDeletedIds: Set<number> = new Set()
  ): {
    merged: Enquete[];
    conflicts: SyncConflict[];
    stats: { newFromServer: number; newFromLocal: number; merged: number; newActesFromServer: number; acteChanges: Array<{ enqueteNumero: string; count: number }> };
  } {
    const conflicts: SyncConflict[] = [];
    const merged = new Map<number, Enquete>();
    const stats = { newFromServer: 0, newFromLocal: 0, merged: 0, newActesFromServer: 0, acteChanges: [] as Array<{ enqueteNumero: string; count: number }> };

    const localMap = new Map(localEnquetes.map(e => [e.id, e]));
    const serverMap = new Map(serverEnquetes.map(e => [e.id, e]));

    // 1. Traiter les enquêtes serveur
    for (const [id, serverEnquete] of serverMap) {
      const localEnquete = localMap.get(id);

      if (!localEnquete) {
        // Vérifier si cet ID a été supprimé intentionnellement en local
        if (localDeletedIds.has(id)) {
          // ⛔ Supprimée localement → ne pas la rajouter depuis le serveur
          console.log(`🗑️ DataMerge: Enquête ${id} ignorée (supprimée localement)`);
          continue;
        }
        // ✅ Nouvelle enquête serveur → ajout automatique
        merged.set(id, serverEnquete);
        stats.newFromServer++;
        continue;
      }

      // Enquête existe des deux côtés → tenter fusion intelligente
      const mergeResult = this.tryMergeEnquete(localEnquete, serverEnquete);

      if (mergeResult.hasConflict) {
        // ⚠️ Conflit détecté → nécessite intervention
        conflicts.push({
          type: 'enquete_modified',
          enqueteId: id,
          enqueteNumero: serverEnquete.numero,
          details: mergeResult.conflicts,
          localData: localEnquete,
          serverData: serverEnquete,
          localTimestamp: localEnquete.dateMiseAJour,
          serverTimestamp: serverEnquete.dateMiseAJour
        });
        // En attendant résolution, garder version locale
        merged.set(id, localEnquete);
      } else {
        // ✅ Fusion automatique réussie
        merged.set(id, mergeResult.merged!);
        stats.merged++;

        // Détecter les nouveaux actes/écoutes/géolocs récupérés depuis le serveur
        const localActeCount = (localEnquete.actes?.length ?? 0) + (localEnquete.ecoutes?.length ?? 0) + (localEnquete.geolocalisations?.length ?? 0);
        const mergedActeCount = (mergeResult.merged!.actes?.length ?? 0) + (mergeResult.merged!.ecoutes?.length ?? 0) + (mergeResult.merged!.geolocalisations?.length ?? 0);
        const delta = mergedActeCount - localActeCount;
        if (delta > 0) {
          stats.newActesFromServer += delta;
          stats.acteChanges.push({ enqueteNumero: serverEnquete.numero, count: delta });
        }
      }
    }

    // 2. Traiter les enquêtes locales uniquement
    for (const [id, localEnquete] of localMap) {
      if (!serverMap.has(id)) {
        // Vérifier si un collègue a supprimé cette enquête sur le serveur
        if (serverDeletedIds.has(id)) {
          // ⚠️ Supprimée par un collègue MAIS présente localement
          // → CONFLIT OBLIGATOIRE (ne jamais supprimer silencieusement des données locales)
          console.warn(`⚠️ DataMerge: Conflit suppression enquête ${id} (présente en local, supprimée sur serveur)`);
          conflicts.push({
            type: 'enquete_deleted',
            enqueteId: id,
            enqueteNumero: localEnquete.numero,
            details: ['Enquête présente localement mais supprimée sur le serveur par un collègue'],
            localData: localEnquete,
            serverData: null,
            localTimestamp: localEnquete.dateMiseAJour
          });
          // En attendant la résolution, conserver la version locale
          merged.set(id, localEnquete);
          continue;
        }
        // ✅ Nouvelle enquête locale → push vers serveur
        merged.set(id, localEnquete);
        stats.newFromLocal++;
      }
    }

    return { merged: Array.from(merged.values()), conflicts, stats };
  }

  /**
   * 🆕 Tente de fusionner deux versions d'une même enquête intelligemment
   * (PUBLIQUE pour usage dans DataSyncManager)
   */
  public static tryMergeEnquete(local: Enquete, server: Enquete): {
    merged?: Enquete;
    hasConflict: boolean;
    conflicts: string[];
  } {
    const conflicts: string[] = [];

    // 1. Fusionner les comptes-rendus (union par ID)
    const { merged: mergedCRs, conflicts: crConflicts } = this.mergeCRs(
      local.comptesRendus,
      server.comptesRendus
    );
    conflicts.push(...crConflicts);

    // 2. Fusionner les mis en cause (union par ID)
    const { merged: mergedMECs, conflicts: mecConflicts } = this.mergeMECs(
      local.misEnCause,
      server.misEnCause
    );
    conflicts.push(...mecConflicts);

    // 3. Fusionner les actes (intelligent avec timestamps enquête)
    const localDate = new Date(local.dateMiseAJour).getTime();
    const serverDate = new Date(server.dateMiseAJour).getTime();
    
    const { merged: mergedActes, conflicts: actesConflicts } = this.mergeActes(
      local.actes || [],
      server.actes || [],
      localDate,
      serverDate
    );
    conflicts.push(...actesConflicts.map(c => `Actes: ${c}`));

    const { merged: mergedEcoutes, conflicts: ecoutesConflicts } = this.mergeActes(
      local.ecoutes || [],
      server.ecoutes || [],
      localDate,
      serverDate
    );
    conflicts.push(...ecoutesConflicts.map(c => `Écoutes: ${c}`));

    const { merged: mergedGeoloc, conflicts: geolocConflicts } = this.mergeActes(
      local.geolocalisations || [],
      server.geolocalisations || [],
      localDate,
      serverDate
    );
    conflicts.push(...geolocConflicts.map(c => `Géolocalisations: ${c}`));

    // Si aucun conflit → fusion réussie
    if (conflicts.length === 0) {
      return {
        merged: {
          ...local,
          comptesRendus: mergedCRs,
          misEnCause: mergedMECs,
          actes: mergedActes,
          ecoutes: mergedEcoutes,
          geolocalisations: mergedGeoloc,
          // Prendre les champs du plus récent (timestamp)
          numero: serverDate > localDate ? server.numero : local.numero,
          description: serverDate > localDate ? server.description : local.description,
          services: serverDate > localDate ? server.services : local.services,
          tags: this.mergeTags(local.tags, server.tags),
          // Conserver le timestamp réel de la dernière modification (ne pas gonfler à l'heure actuelle)
          dateMiseAJour: serverDate > localDate ? server.dateMiseAJour : local.dateMiseAJour
        },
        hasConflict: false,
        conflicts: []
      };
    }

    // Sinon, retourner les conflits
    return {
      hasConflict: true,
      conflicts
    };
  }

  /**
   * 🆕 Fusionne les comptes-rendus intelligemment
   */
  private static mergeCRs(local: CompteRendu[], server: CompteRendu[]): {
    merged: CompteRendu[];
    conflicts: string[];
  } {
    const conflicts: string[] = [];
    const merged = new Map<number, CompteRendu>();

    // Ajouter tous les CR locaux
    local.forEach(cr => merged.set(cr.id, cr));

    // Ajouter les CR serveur
    server.forEach(serverCR => {
      const localCR = merged.get(serverCR.id);

      if (!localCR) {
        // ✅ Nouveau CR serveur → ajout
        merged.set(serverCR.id, serverCR);
      } else {
        // CR existe des deux côtés
        if (
          localCR.date !== serverCR.date ||
          localCR.description !== serverCR.description ||
          localCR.enqueteur !== serverCR.enqueteur
        ) {
          // ⚠️ Même CR modifié différemment → CONFLIT
          conflicts.push(`CR du ${localCR.date} modifié des deux côtés`);
        }
        // Garder version locale en attendant
      }
    });

    return { merged: Array.from(merged.values()), conflicts };
  }

  /**
   * 🆕 Fusionne les mis en cause intelligemment
   */
  private static mergeMECs(local: MisEnCause[], server: MisEnCause[]): {
    merged: MisEnCause[];
    conflicts: string[];
  } {
    const conflicts: string[] = [];
    const merged = new Map<number, MisEnCause>();

    local.forEach(mec => merged.set(mec.id, mec));

    server.forEach(serverMEC => {
      const localMEC = merged.get(serverMEC.id);

      if (!localMEC) {
        // ✅ Nouveau MEC serveur → ajout
        merged.set(serverMEC.id, serverMEC);
      } else {
        // MEC existe des deux côtés
        if (
          localMEC.nom !== serverMEC.nom ||
          localMEC.role !== serverMEC.role ||
          localMEC.statut !== serverMEC.statut
        ) {
          // ⚠️ Même MEC modifié différemment → CONFLIT
          conflicts.push(`MEC "${localMEC.nom}" modifié des deux côtés`);
        }
        // Garder version locale en attendant
      }
    });

    return { merged: Array.from(merged.values()), conflicts };
  }

  /**
   * 🆕 Fusionne les actes intelligemment (logique spéciale prolongations/poses)
   */
  private static mergeActes(
    local: any[], 
    server: any[],
    localEnqueteTimestamp: number,
    serverEnqueteTimestamp: number
  ): {
    merged: any[];
    conflicts: string[];
  } {
    const conflicts: string[] = [];
    const merged = new Map<number, any>();

    local.forEach(acte => merged.set(acte.id, acte));

    server.forEach(serverActe => {
      const localActe = merged.get(serverActe.id);

      if (!localActe) {
        // ✅ Nouvel acte serveur → ajout
        merged.set(serverActe.id, serverActe);
        return;
      }

      // Acte existe des deux côtés → vérifier si c'est une progression normale
      const progressionCheck = this.checkActeProgression(localActe, serverActe);

      if (progressionCheck.isProgression) {
        // ✅ Progression normale détectée → prendre la version indiquée
        merged.set(serverActe.id, progressionCheck.takeServer ? serverActe : localActe);
      } else {
        // Pas de progression workflow → vérifier les conflits de champs
        const fieldConflicts = this.compareActeForConflict(localActe, serverActe);
        if (fieldConflicts.length > 0) {
          // ⚠️ Modifications contradictoires détectées → signaler le conflit
          conflicts.push(...fieldConflicts);
        }
        // Utiliser timestamp de l'enquête parente pour déterminer la version par défaut
        if (serverEnqueteTimestamp > localEnqueteTimestamp) {
          merged.set(serverActe.id, serverActe);
        }
        // Sinon garder local (déjà dans merged)
      }
    });

    return { merged: Array.from(merged.values()), conflicts };
  }

  /**
   * 🆕 Vérifie si c'est une progression normale d'un acte et indique quelle version prendre
   */
  private static checkActeProgression(local: any, server: any): {
    isProgression: boolean;
    takeServer: boolean;
  } {
    // Cas 1a: Prolongation demandée → prolongation validée (serveur plus récent)
    if (
      local.statut === 'prolongation_pending' &&
      server.statut === 'en_cours' &&
      server.prolongationDate &&
      !local.prolongationDate
    ) {
      return { isProgression: true, takeServer: true }; // Prendre serveur (validé)
    }

    // Cas 1b: En cours → Prolongation demandée (local plus récent)
    if (
      server.statut === 'en_cours' &&
      local.statut === 'prolongation_pending' &&
      !server.prolongationDate &&
      !local.prolongationDate
    ) {
      return { isProgression: true, takeServer: false }; // Prendre local (demande)
    }

    // Cas 2a: Pose en attente → pose effectuée (serveur plus récent)
    if (
      local.statut === 'pose_pending' &&
      server.statut === 'en_cours' &&
      server.datePose &&
      !local.datePose
    ) {
      return { isProgression: true, takeServer: true }; // Prendre serveur (posé)
    }

    // Cas 2b: En cours → Pose en attente (local plus récent)
    if (
      server.statut === 'en_cours' &&
      local.statut === 'pose_pending' &&
      !local.datePose
    ) {
      return { isProgression: true, takeServer: false }; // Prendre local (demande pose)
    }

    // Cas 2c: Pose demandée par un collègue sur le serveur → prendre serveur
    if (
      server.statut === 'pose_pending' &&
      local.statut === 'en_cours'
    ) {
      return { isProgression: true, takeServer: true }; // Prendre serveur (demande collègue)
    }

    // Cas 3a: Autorisation demandée en local, serveur pas encore au courant → garder local
    if (
      local.statut === 'autorisation_pending' &&
      server.statut === 'en_cours'
    ) {
      return { isProgression: true, takeServer: false }; // Prendre local (demande d'autorisation)
    }

    // Cas 3b: Autorisation demandée sur le serveur (par un collègue), local encore en cours → prendre serveur
    if (
      server.statut === 'autorisation_pending' &&
      local.statut === 'en_cours'
    ) {
      return { isProgression: true, takeServer: true }; // Prendre serveur (demande collègue)
    }

    // Cas 4: Ajout de prolongation (durée augmentée)
    if (
      !local.prolongationDate &&
      server.prolongationDate &&
      parseInt(server.duree) > parseInt(local.duree)
    ) {
      return { isProgression: true, takeServer: true }; // Prendre serveur (prolongé)
    }

    return { isProgression: false, takeServer: false };
  }

  /**
   * 🆕 Compare deux actes pour détecter conflits réels
   */
  private static compareActeForConflict(local: any, server: any): string[] {
    const diffs: string[] = [];

    // Dates de début différentes (hors ajout de pose)
    if (local.dateDebut !== server.dateDebut) {
      diffs.push('date début différente');
    }

    // Dates de fin contradictoires (pas juste prolongation)
    if (local.dateFin !== server.dateFin) {
      const localDuree = parseInt(local.duree);
      const serverDuree = parseInt(server.duree);
      
      // Si les durées sont identiques mais dates fin différentes → conflit
      if (localDuree === serverDuree) {
        diffs.push('date fin différente');
      }
    }

    // Statuts contradictoires (hors progressions normales)
    if (local.statut !== server.statut) {
      const isContradictory = !(
        // Local a une demande en attente, serveur pas encore au courant
        (local.statut === 'prolongation_pending' && server.statut === 'en_cours') ||
        (local.statut === 'pose_pending'          && server.statut === 'en_cours') ||
        (local.statut === 'autorisation_pending'  && server.statut === 'en_cours') ||
        // Serveur a une demande en attente (collègue), local pas encore au courant
        (local.statut === 'en_cours' && server.statut === 'prolongation_pending') ||
        (local.statut === 'en_cours' && server.statut === 'pose_pending')          ||
        (local.statut === 'en_cours' && server.statut === 'autorisation_pending')
      );

      if (isContradictory) {
        diffs.push(`statut: ${local.statut} vs ${server.statut}`);
      }
    }

    return diffs;
  }

  /**
   * Fusionne les tags (union simple)
   */
  private static mergeTags(local: any[], server: any[]): any[] {
    const merged = new Map();
    
    server.forEach(tag => merged.set(tag.id, tag));
    local.forEach(tag => merged.set(tag.id, tag));
    
    return Array.from(merged.values());
  }

  /**
   * Fusionne les résultats d'audience
   */
  private static intelligentMergeAudienceResults(
    local: Record<string, ResultatAudience>,
    server: Record<string, ResultatAudience>
  ): { merged: Record<string, ResultatAudience>; conflicts: SyncConflict[] } {
    const conflicts: SyncConflict[] = [];
    const merged: Record<string, ResultatAudience> = { ...server };

    // Pour chaque résultat local
    for (const [enqueteId, localResult] of Object.entries(local)) {
      const serverResult = server[enqueteId];

      if (!serverResult) {
        // ✅ Nouveau résultat local → ajout
        merged[enqueteId] = localResult;
      } else {
        // Résultat existe des deux côtés
        if (JSON.stringify(localResult) !== JSON.stringify(serverResult)) {
          // ⚠️ Résultats différents → CONFLIT
          conflicts.push({
            type: 'audience_modified',
            enqueteId: parseInt(enqueteId),
            details: ['Résultat d\'audience modifié des deux côtés'],
            localData: localResult,
            serverData: serverResult
          });
          // Garder version locale en attendant
          merged[enqueteId] = localResult;
        }
      }
    }

    return { merged, conflicts };
  }

  /**
   * Fusionne les règles d'alertes (union par ID, local prioritaire)
   */
  private static mergeAlertRules(local: any[], server: any[]): any[] {
    const merged = new Map();

    server.forEach(rule => merged.set(rule.id, rule));
    local.forEach(rule => merged.set(rule.id, rule));

    return Array.from(merged.values());
  }

  /**
   * Fusionne les validations d'alertes (union, la plus récente gagne en cas de conflit sur la même clé)
   * Cela permet de propager les actions "reporter/valider" entre tous les postes.
   */
  private static mergeAlertValidations(
    local: Record<string, any>,
    server: Record<string, any>
  ): Record<string, any> {
    const merged: Record<string, any> = { ...server };

    for (const [key, localVal] of Object.entries(local)) {
      if (!merged[key]) {
        merged[key] = localVal;
      } else {
        // Les deux côtés ont une validation pour cette clé → garder la plus récente
        const serverDate = new Date(merged[key].validatedAt ?? 0).getTime();
        const localDate = new Date(localVal.validatedAt ?? 0).getTime();
        if (localDate > serverDate) {
          merged[key] = localVal;
        }
      }
    }

    return merged;
  }

  /**
   * Applique la résolution "keep_local" - garde les données locales
   */
  static resolveKeepLocal(localData: SyncData, serverData: SyncData): SyncData {
    const localEnqueteIds = new Set((localData.enquetes || []).map(e => e.id));
    const mergedDeletedIds = Array.from(new Set([
      ...(localData.deletedIds || []),
      ...(serverData.deletedIds || [])
    ]));

    const newServerEnquetes = (serverData.enquetes || []).filter(
      e => !localEnqueteIds.has(e.id) && !mergedDeletedIds.includes(e.id)
    );

    return {
      enquetes: [...localData.enquetes, ...newServerEnquetes],
      audienceResultats: { ...serverData.audienceResultats, ...localData.audienceResultats },
      customTags: localData.customTags,
      alertRules: localData.alertRules,
      alertValidations: this.mergeAlertValidations(localData.alertValidations || {}, serverData.alertValidations || {}),
      deletedIds: mergedDeletedIds,
      version: localData.version + 1
    };
  }

  /**
   * Applique la résolution "keep_server" - garde les données serveur
   */
  static resolveKeepServer(localData: SyncData, serverData: SyncData): SyncData {
    const serverEnqueteIds = new Set((serverData.enquetes || []).map(e => e.id));
    const mergedDeletedIds = Array.from(new Set([
      ...(localData.deletedIds || []),
      ...(serverData.deletedIds || [])
    ]));

    const newLocalEnquetes = (localData.enquetes || []).filter(
      e => !serverEnqueteIds.has(e.id) && !mergedDeletedIds.includes(e.id)
    );

    return {
      enquetes: [...serverData.enquetes, ...newLocalEnquetes],
      audienceResultats: { ...localData.audienceResultats, ...serverData.audienceResultats },
      customTags: serverData.customTags,
      alertRules: serverData.alertRules,
      alertValidations: this.mergeAlertValidations(localData.alertValidations || {}, serverData.alertValidations || {}),
      deletedIds: mergedDeletedIds,
      version: serverData.version + 1
    };
  }

  /**
   * Retourne le libellé d'un type de conflit
   */
  static getConflictTypeLabel(type: ConflictType): string {
    const labels: Record<ConflictType, string> = {
      'enquete_modified': 'Enquête modifiée',
      'enquete_deleted': 'Enquête supprimée sur le serveur',
      'enquete_new': 'Nouvelle enquête',
      'audience_modified': 'Résultat d\'audience modifié',
      'tags_modified': 'Tags modifiés',
      'rules_modified': 'Règles d\'alertes modifiées'
    };

    return labels[type] || 'Conflit';
  }
}