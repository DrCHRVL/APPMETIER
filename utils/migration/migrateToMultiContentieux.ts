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

// Suffixes (clés legacy → clés ctx_) contenant des tableaux d'éléments métier
// récupérables. Si la clé ctx_ est vide alors que la clé legacy contient des
// données, c'est le symptôme d'une migration partielle/perdue : on récupère.
const RECOVERABLE: Array<{ legacyKey: string; suffix: string }> = [
  { legacyKey: APP_CONFIG.STORAGE_KEYS.ENQUETES,     suffix: 'enquetes' },
  { legacyKey: APP_CONFIG.STORAGE_KEYS.INSTRUCTIONS, suffix: 'instructions' },
];

/**
 * Récupération auto-réparatrice (s'exécute à CHAQUE démarrage, indépendamment
 * du drapeau de migration).
 *
 * Symptôme corrigé : la vue d'un contentieux est vide alors que les données
 * existent encore sous l'ANCIENNE clé non préfixée (`enquetes`, `instructions`)
 * — typiquement quand le drapeau `migration_multi_contentieux_done` a été posé
 * avant que la copie vers `ctx_<contentieux>_*` ait pu aboutir, ou sur un
 * portable fraîchement réextrait.
 *
 * Règle stricte anti-perte / anti-résurrection :
 *   on ne copie QUE si `ctx_<defaut>_<suffix>` est vide/absent ET que la clé
 *   legacy contient un tableau non vide. Dès que la clé ctx_ contient des
 *   données, on n'y touche plus jamais — une suppression ultérieure ne peut
 *   donc pas être ré-annulée par cette récupération.
 *
 * Retourne le nombre de clés effectivement récupérées.
 */
export async function recoverDefaultContentieuxFromLegacy(): Promise<number> {
  let recovered = 0;

  for (const { legacyKey, suffix } of RECOVERABLE) {
    try {
      const ctxKey = newKey(DEFAULT_CONTENTIEUX, suffix);
      const ctxData = await ElectronBridge.getData<unknown>(ctxKey, null);
      const ctxIsEmpty = ctxData === null || (Array.isArray(ctxData) && ctxData.length === 0);
      if (!ctxIsEmpty) continue; // la clé ctx_ contient déjà des données → ne pas toucher

      const legacyData = await ElectronBridge.getData<unknown>(legacyKey, null);
      if (!Array.isArray(legacyData) || legacyData.length === 0) continue; // rien à récupérer

      await ElectronBridge.setData(ctxKey, legacyData);
      recovered++;
      console.warn(
        `🛟 Récupération : ${legacyData.length} élément(s) restauré(s) ${legacyKey} → ${ctxKey}`
      );
    } catch (error) {
      console.error(`❌ Récupération : erreur pour ${legacyKey}:`, error);
    }
  }

  return recovered;
}

/**
 * Effectue la migration des données vers la structure multi-contentieux.
 * Retourne true si la migration a été effectuée, false si déjà faite.
 */
export async function migrateToMultiContentieux(): Promise<boolean> {
  // Récupération auto-réparatrice — TOUJOURS, même si la migration one-shot est
  // déjà marquée comme faite. Rebranche les données legacy restées orphelines
  // sur les clés ctx_ quand celles-ci sont vides (cause d'une vue vide).
  try {
    await recoverDefaultContentieuxFromLegacy();
  } catch (recErr) {
    console.error('Migration : récupération legacy échouée (non bloquante)', recErr);
  }

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
