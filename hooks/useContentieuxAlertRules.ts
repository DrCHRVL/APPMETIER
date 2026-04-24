// hooks/useContentieuxAlertRules.ts
//
// Lecture/écriture des règles d'alertes PARTAGÉES d'un contentieux (pipe
// ContentieuxAlertsSyncService ↔ `contentieux-alerts/{id}.json`). Le hook
// est consommé par la page de config : chaque « bulle contentieux »
// instancie son propre hook. Les mutations écrivent le serveur et
// rafraîchissent le cache local.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertRule } from '@/types/interfaces';
import { APP_CONFIG } from '@/config/constants';
import { ElectronBridge } from '@/utils/electronBridge';
import { ContentieuxId } from '@/types/userTypes';
import { contentieuxAlertsSyncService } from '@/utils/dataSync/ContentieuxAlertsSyncService';

export function useContentieuxAlertRules(contentieuxId: ContentieuxId) {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const seedTriedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    seedTriedRef.current = false;

    const load = async () => {
      setIsLoading(true);
      try {
        await contentieuxAlertsSyncService.sync(contentieuxId);
        let current = await contentieuxAlertsSyncService.getRules(contentieuxId);

        if (current.length === 0 && !seedTriedRef.current) {
          seedTriedRef.current = true;
          const legacyCtx = await ElectronBridge.getData<AlertRule[]>(
            `ctx_${contentieuxId}_alertRules`,
            [],
          );
          const legacyGlobal = await ElectronBridge.getData<AlertRule[]>(
            APP_CONFIG.STORAGE_KEYS.ALERT_RULES,
            [],
          );
          const seedRules = (Array.isArray(legacyCtx) && legacyCtx.length > 0)
            ? legacyCtx
            : (Array.isArray(legacyGlobal) && legacyGlobal.length > 0)
              ? legacyGlobal
              : APP_CONFIG.DEFAULT_ALERT_RULES;
          const ok = await contentieuxAlertsSyncService.seedFromLegacy(contentieuxId, seedRules);
          current = ok ? seedRules : APP_CONFIG.DEFAULT_ALERT_RULES;
        } else if (current.length === 0) {
          current = APP_CONFIG.DEFAULT_ALERT_RULES;
        }

        if (!cancelled) setRules(current);
      } catch (error) {
        console.error(`useContentieuxAlertRules[${contentieuxId}] échec chargement:`, error);
        if (!cancelled) setRules(APP_CONFIG.DEFAULT_ALERT_RULES);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    load();
    contentieuxAlertsSyncService.startPeriodic(contentieuxId);

    const handler = async (e: Event) => {
      const custom = e as CustomEvent<{ scope?: string }>;
      if (custom.detail?.scope === `contentieuxAlerts:${contentieuxId}`) {
        const next = await contentieuxAlertsSyncService.getRules(contentieuxId);
        if (!cancelled) setRules(next.length > 0 ? next : APP_CONFIG.DEFAULT_ALERT_RULES);
      }
    };
    window.addEventListener('global-sync-completed', handler);

    return () => {
      cancelled = true;
      window.removeEventListener('global-sync-completed', handler);
      contentieuxAlertsSyncService.stopPeriodic(contentieuxId);
    };
  }, [contentieuxId]);

  const persist = useCallback(async (next: AlertRule[]) => {
    setRules(next);
    await contentieuxAlertsSyncService.saveRules(contentieuxId, next);
  }, [contentieuxId]);

  const updateRule = useCallback(async (updated: AlertRule) => {
    const exists = rules.find(r => r.id === updated.id);
    const next = exists
      ? rules.map(r => r.id === updated.id ? updated : r)
      : [...rules, updated];
    await persist(next);
  }, [rules, persist]);

  const deleteRule = useCallback(async (ruleId: number) => {
    await persist(rules.filter(r => r.id !== ruleId));
  }, [rules, persist]);

  const duplicateRule = useCallback(async (rule: AlertRule) => {
    const copy: AlertRule = {
      ...rule,
      id: Date.now(),
      name: `${rule.name || ''} (copie)`,
      enabled: true,
      isSystemRule: false,
    };
    await persist([...rules, copy]);
  }, [rules, persist]);

  return { rules, isLoading, updateRule, deleteRule, duplicateRule };
}
