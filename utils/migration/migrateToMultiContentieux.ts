// utils/migration/migrateToMultiContentieux.ts
//
// Migration one-shot des données existantes (mono-contentieux)
// vers la structure multi-contentieux.
//
// Ce que ça fait :
// 1. Lit les données actuelles (clés "enquetes", "customTags", etc.)
// 2. Les copie sous les clés préfixées du contentieux par défaut (crimorg)
// 3. Marque la migration comme effectuée
// 4. NE SUPPRIME PAS les anciennes clés (fallback de sécurité)
//
// La migration est idempotente : si déjà effectuée, elle ne fait rien.

import { ElectronBridge } from '../electronBridge';
import { APP_CONFIG } from '@/config/constants';
import { ContentieuxId } from '@/types/userTypes';

const MIGRATION_FLAG_KEY = 'migration_multi_contentieux_done';
const DEFAULT_CONTENTIEUX: ContentieuxId = 'crimorg';

// Mapping : ancienne clé → suffixe dans la nouvelle structure
const KEY_MAPPING: Array<{ oldKey: string; suffix: string }> = [
  { oldKey: APP_CONFIG.STORAGE_KEYS.ENQUETES,           suffix: 'enquetes' },
  { oldKey: APP_CONFIG.STORAGE_KEYS.CUSTOM_TAGS,        suffix: 'customTags' },
  { oldKey: APP_CONFIG.STORAGE_KEYS.ALERT_RULES,        suffix: 'alertRules' },
  { oldKey: APP_CONFIG.STORAGE_KEYS.ALERTS,             suffix: 'alerts' },
  { oldKey: APP_CONFIG.STORAGE_KEYS.ALERT_VALIDATIONS,  suffix: 'alertValidations' },
  { oldKey: APP_CONFIG.STORAGE_KEYS.VISUAL_ALERT_RULES, suffix: 'visualAlertRules' },
  { oldKey: APP_CONFIG.STORAGE_KEYS.AUDIENCE_RESULTATS, suffix: 'audienceResultats' },
  { oldKey: APP_CONFIG.STORAGE_KEYS.INSTRUCTIONS,      suffix: 'instructions' },
];

function newKey(contentieuxId: ContentieuxId, suffix: string): string {
  return `ctx_${contentieuxId}_${suffix}`;
}

/**
 * Vérifie si la migration a déjà été effectuée.
 */
export async function isMigrationDone(): Promise<boolean> {
  const flag = await ElectronBridge.getData<boolean>(MIGRATION_FLAG_KEY, false);
  return flag === true;
}

/**
 * Effectue la migration des données vers la structure multi-contentieux.
 * Retourne true si la migration a été effectuée, false si déjà faite.
 */
export async function migrateToMultiContentieux(): Promise<boolean> {
  // Vérifier si déjà migrée
  if (await isMigrationDone()) {
    console.log('✅ Migration multi-contentieux : déjà effectuée');
    return false;
  }

  console.log('🔄 Migration multi-contentieux : démarrage...');

  let migratedCount = 0;

  for (const { oldKey, suffix } of KEY_MAPPING) {
    try {
      // Vérifier si la nouvelle clé existe déjà (reprise après crash)
      const existingNew = await ElectronBridge.getData(newKey(DEFAULT_CONTENTIEUX, suffix), null);
      if (existingNew !== null) {
        console.log(`⏭️ Migration : ${newKey(DEFAULT_CONTENTIEUX, suffix)} existe déjà, skip`);
        continue;
      }

      // Lire l'ancienne clé
      const oldData = await ElectronBridge.getData(oldKey, null);
      if (oldData === null) {
        console.log(`⏭️ Migration : ${oldKey} est vide, skip`);
        continue;
      }

      // Écrire sous la nouvelle clé
      await ElectronBridge.setData(newKey(DEFAULT_CONTENTIEUX, suffix), oldData);
      migratedCount++;
      console.log(`✅ Migration : ${oldKey} → ${newKey(DEFAULT_CONTENTIEUX, suffix)}`);
    } catch (error) {
      console.error(`❌ Migration : erreur pour ${oldKey}:`, error);
      // Continue avec les autres clés — pas de rollback pour ne pas perdre de données
    }
  }

  // Migrer aussi les IDs supprimés (pour la sync)
  const deletedKeys = [
    { old: 'deleted_enquete_ids', suffix: 'deleted_enquete_ids' },
    { old: 'deleted_acte_ids',    suffix: 'deleted_acte_ids' },
    { old: 'deleted_cr_ids',      suffix: 'deleted_cr_ids' },
    { old: 'deleted_mec_ids',     suffix: 'deleted_mec_ids' },
  ];

  for (const { old, suffix } of deletedKeys) {
    try {
      const data = await ElectronBridge.getData(old, null);
      if (data !== null) {
        await ElectronBridge.setData(newKey(DEFAULT_CONTENTIEUX, suffix), data);
        console.log(`✅ Migration : ${old} → ${newKey(DEFAULT_CONTENTIEUX, suffix)}`);
      }
    } catch (error) {
      console.error(`❌ Migration IDs supprimés : erreur pour ${old}:`, error);
    }
  }

  // Marquer la migration comme effectuée
  await ElectronBridge.setData(MIGRATION_FLAG_KEY, true);
  console.log(`✅ Migration multi-contentieux terminée : ${migratedCount} clé(s) migrée(s)`);

  return true;
}

/**
 * Vérifie l'intégrité post-migration : les nouvelles clés contiennent des données.
 */
export async function verifyMigration(): Promise<{
  ok: boolean;
  details: Array<{ key: string; hasData: boolean }>;
}> {
  const details: Array<{ key: string; hasData: boolean }> = [];
  let allOk = true;

  for (const { suffix } of KEY_MAPPING) {
    const key = newKey(DEFAULT_CONTENTIEUX, suffix);
    const data = await ElectronBridge.getData(key, null);
    const hasData = data !== null;
    details.push({ key, hasData });
    // enquetes doit exister (même si tableau vide), les autres sont optionnels
    if (suffix === 'enquetes' && !hasData) {
      allOk = false;
    }
  }

  return { ok: allOk, details };
}
