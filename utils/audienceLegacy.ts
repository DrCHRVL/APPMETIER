// Helpers de migration des résultats d'audience.
//
// Vit dans son propre module pour casser le cycle d'import entre
// `stores/useAudienceStore` (qui consomme la fonction) et
// `utils/dataSync/AudienceSyncService` (qui en a besoin pour dédoublonner les
// merges avant écriture).

import { ResultatAudience } from '@/types/audienceTypes';

// Contentieux par défaut affecté aux résultats legacy (clé numérique nue dans
// le stockage avant l'introduction du namespace par contentieux). Avant le
// refactor, seul crimorg utilisait correctement ce flux : tous les résultats
// existants en base sont donc rattachés à ce contentieux.
export const LEGACY_CONTENTIEUX_ID = 'crimorg';

// Construit la clé composite stockée dans `audience_resultats`.
// Format : `${contentieuxId}__${enqueteId}` — double underscore pour éviter
// toute collision avec un id de contentieux contenant un underscore.
export const buildResultatKey = (contentieuxId: string, enqueteId: number): string =>
  `${contentieuxId}__${enqueteId}`;

// Migre un dictionnaire de résultats : ré-encode toutes les clés purement
// numériques (legacy) en clés composites `crimorg__N` et y écrit aussi le
// champ `contentieuxId` sur le résultat lui-même.
//
// Quand une clé legacy `123` ET sa version préfixée `crimorg__123` coexistent,
// la version préfixée gagne d'office (la clé nue est le vestige d'un ancien
// pending qui n'avait jamais été nettoyé après saisie du résultat). Sans cette
// règle, l'ordre d'itération pouvait écraser un résultat NEW par l'ANCIEN
// pending et faire ressusciter l'enquête dans la liste « audiences en attente ».
export const migrateLegacyResultats = (
  data: Record<string, ResultatAudience>
): { migrated: Record<string, ResultatAudience>; changed: boolean } => {
  let changed = false;
  const migrated: Record<string, ResultatAudience> = {};

  // Étape 1 : copier les clés composites en premier — elles sont la source de
  // vérité. On normalise au passage le champ `contentieuxId` manquant.
  for (const [key, value] of Object.entries(data)) {
    if (/^\d+$/.test(key)) continue;
    if (!value.contentieuxId) {
      const [ctxFromKey] = key.split('__');
      migrated[key] = { ...value, contentieuxId: ctxFromKey || LEGACY_CONTENTIEUX_ID };
      changed = true;
    } else {
      migrated[key] = value;
    }
  }

  // Étape 2 : ré-écrire les clés legacy nues sous forme composite, MAIS
  // seulement si aucune entrée préfixée n'existe déjà pour la même enquête.
  // Dans tous les cas la clé nue disparaît du résultat (`changed = true`).
  for (const [key, value] of Object.entries(data)) {
    if (!/^\d+$/.test(key)) continue;
    const newKey = buildResultatKey(LEGACY_CONTENTIEUX_ID, value.enqueteId);
    if (!migrated[newKey]) {
      migrated[newKey] = { ...value, contentieuxId: value.contentieuxId || LEGACY_CONTENTIEUX_ID };
    }
    changed = true;
  }

  return { migrated, changed };
};
