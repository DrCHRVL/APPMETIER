// utils/enquetesBulkUpdate.ts
// Écriture EN MASSE sur les enquêtes de tous les contentieux chargés.
//
// Certaines données ne vivent pas dans une enquête mais la traversent : un tag
// renommé, une personne renommée. Corriger la valeur à un seul endroit doit
// donc réécrire toutes les enquêtes qui la citent, quel que soit leur
// contentieux — y compris ceux qui ne sont pas affichés à l'écran.
//
// Le contentieux ACTIF est lu depuis le store Zustand (source de vérité de
// l'UI, une édition non encore poussée au manager y est déjà) et rechargé
// après écriture ; les autres passent par le ContentieuxManager. Les
// contentieux en lecture seule sont ignorés : on n'a pas la main dessus.

import type { Enquete } from '@/types/interfaces';
import type { ContentieuxId } from '@/types/userTypes';
import { ContentieuxManager } from '@/utils/contentieuxManager';
import { MultiSyncManager } from '@/utils/dataSync/MultiSyncManager';
import { useEnquetesStore } from '@/stores/useEnquetesStore';

/**
 * Applique `transformEnquete` à chaque enquête de chaque contentieux chargé.
 * La transformation retourne `null` quand l'enquête n'est pas concernée (rien
 * n'est réécrit dans ce cas), l'enquête mise à jour sinon.
 *
 * @returns nombre total d'enquêtes réellement modifiées.
 */
export async function updateEnquetesAcrossContentieux(
  transformEnquete: (enquete: Enquete) => Enquete | null,
): Promise<number> {
  const manager = ContentieuxManager.getInstance();
  const multiSync = MultiSyncManager.getInstance();
  const activeId = useEnquetesStore.getState().contentieuxId;
  let totalModified = 0;

  for (const contentieuxId of manager.getLoadedContentieuxIds()) {
    if (manager.getSyncMode(contentieuxId) === 'read_only') continue;

    // Pour le contentieux actif, on travaille à partir des enquêtes du store
    // (qui est la source de vérité de l'UI) plutôt que de celles du manager
    // qui peuvent être plus anciennes si une édition n'a pas encore été
    // flushée.
    const source: Enquete[] = contentieuxId === activeId
      ? useEnquetesStore.getState().ownEnquetes
      : manager.getEnquetes(contentieuxId);

    let modifiedCount = 0;
    const updated: Enquete[] = source.map(enquete => {
      const next = transformEnquete(enquete);
      if (next) {
        modifiedCount++;
        return next;
      }
      return enquete;
    });

    if (modifiedCount === 0) continue;
    totalModified += modifiedCount;

    await manager.setEnquetes(contentieuxId, updated);

    if (contentieuxId === activeId) {
      // Resynchroniser le store Zustand : ses propres écritures ne passent
      // pas par le manager, donc l'UI ne se rafraîchirait pas autrement.
      await useEnquetesStore.getState().loadEnquetes();
    }

    multiSync.triggerPostSaveSync(contentieuxId);
    console.log(`[${contentieuxId}] ${modifiedCount} enquête(s) mise(s) à jour`);
  }

  return totalModified;
}
