// utils/archiveStateIO.ts — Accès stockage pour la réparation de l'état
// d'archivage (cf. utils/archiveState.ts, qui reste une logique pure).

import { ResultatAudience } from '@/types/audienceTypes';
import { SiralBridge } from '@/utils/siralBridge';
import { buildResultatKey, migrateLegacyResultats } from '@/utils/audienceLegacy';

// Clé globale des résultats d'audience (partagée par tous les contentieux,
// écrite par useAudienceStore / AudienceSyncService).
const AUDIENCE_RESULTATS_KEY = 'audience_resultats';

/**
 * Prépare l'accès aux résultats d'audience d'un contentieux pour la réparation.
 * Lecture directe du stockage : la réparation tourne au chargement, avant que
 * le store d'audience ne soit forcément initialisé.
 */
export async function buildResultatLookup(
  contentieuxId: string,
): Promise<(enqueteId: number) => ResultatAudience | undefined> {
  let index: Record<string, ResultatAudience> = {};
  try {
    const raw = await SiralBridge.getData<Record<string, ResultatAudience>>(AUDIENCE_RESULTATS_KEY, {});
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      index = migrateLegacyResultats(raw).migrated;
    }
  } catch {
    index = {};
  }
  return (enqueteId: number) => index[buildResultatKey(contentieuxId, enqueteId)];
}
