// Helpers de migration des résultats d'audience.
//
// Vit dans son propre module pour casser le cycle d'import entre
// `stores/useAudienceStore` (qui consomme la fonction) et
// `utils/dataSync/AudienceSyncService` (qui en a besoin pour dédoublonner les
// merges avant écriture).
//
// La LOGIQUE vit dans `lib/audience/resultatsCles.mjs` — source unique,
// également utilisée par le service attaché, qui lit le même coffre
// `audience` que l'application. Ce fichier n'apporte que le typage.

import { ResultatAudience } from '@/types/audienceTypes';
import {
  LEGACY_CONTENTIEUX_ID as LEGACY_ID,
  buildResultatKey as buildKey,
  migrateLegacyResultats as migrateCore,
} from '@/lib/audience/resultatsCles.mjs';

export const LEGACY_CONTENTIEUX_ID: string = LEGACY_ID;

export const buildResultatKey = (contentieuxId: string, enqueteId: number): string =>
  buildKey(contentieuxId, enqueteId);

export const migrateLegacyResultats = (
  data: Record<string, ResultatAudience>
): { migrated: Record<string, ResultatAudience>; changed: boolean } =>
  migrateCore(data) as { migrated: Record<string, ResultatAudience>; changed: boolean };
