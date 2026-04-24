// hooks/useVisualAlerts.ts
//
// Règles d'alertes visuelles personnelles (badges colorés sur la grille).
// Auparavant locales par machine via la clé `visual_alert_rules`. Désormais
// stockées dans la prefs utilisateur, donc partagées entre les postes mais
// isolées entre utilisateurs. Seed initial depuis l'ancienne clé locale.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { VisualAlertRule } from '@/types/interfaces';
import { APP_CONFIG, DEFAULT_VISUAL_ALERT_RULES } from '@/config/constants';
import { ElectronBridge } from '@/utils/electronBridge';
import { useUserPreferences } from './useUserPreferences';

const LEGACY_STORAGE_KEY = APP_CONFIG.STORAGE_KEYS.VISUAL_ALERT_RULES;

export const useVisualAlerts = () => {
  const {
    visualAlertRules: visualPrefs,
    isLoading: prefsLoading,
    setVisualAlertRules,
    seedVisualAlertRules,
  } = useUserPreferences();

  const seedAttemptedRef = useRef(false);

  useEffect(() => {
    if (prefsLoading) return;
    if (visualPrefs?.seeded) return;
    if (seedAttemptedRef.current) return;
    seedAttemptedRef.current = true;
    (async () => {
      try {
        const legacy = await ElectronBridge.getData<VisualAlertRule[]>(
          LEGACY_STORAGE_KEY,
          DEFAULT_VISUAL_ALERT_RULES,
        );
        const arr = Array.isArray(legacy) && legacy.length > 0
          ? legacy
          : DEFAULT_VISUAL_ALERT_RULES;
        await seedVisualAlertRules(arr);
      } catch (error) {
        console.error('Seed visualAlertRules échoué:', error);
        seedAttemptedRef.current = false;
      }
    })();
  }, [prefsLoading, visualPrefs?.seeded, seedVisualAlertRules]);

  // Fusion : règles utilisateur + règles système par défaut manquantes (pour
  // qu'une nouvelle règle système livrée par mise à jour apparaisse même
  // chez les utilisateurs déjà seedés).
  const rules = useMemo<VisualAlertRule[]>(() => {
    const saved = visualPrefs?.rules || [];
    const defaultById = new Map(DEFAULT_VISUAL_ALERT_RULES.map(d => [d.id, d]));
    const savedIds = new Set(saved.map(r => r.id));
    const missingDefaults = DEFAULT_VISUAL_ALERT_RULES.filter(d => !savedIds.has(d.id));

    const mergedSaved = saved.map(savedRule => {
      const defaultRule = defaultById.get(savedRule.id);
      if (!defaultRule?.isSystemRule) return savedRule;
      const withDefaults = { ...defaultRule };
      for (const key of Object.keys(savedRule) as (keyof VisualAlertRule)[]) {
        if (savedRule[key] !== undefined) (withDefaults as any)[key] = savedRule[key];
      }
      return withDefaults;
    });

    return [...mergedSaved, ...missingDefaults];
  }, [visualPrefs?.rules]);

  const updateRule = useCallback((updatedRule: VisualAlertRule) => {
    const exists = rules.some(r => r.id === updatedRule.id);
    const newRules = exists
      ? rules.map(r => r.id === updatedRule.id ? updatedRule : r)
      : [...rules, updatedRule];
    setVisualAlertRules(newRules);
  }, [rules, setVisualAlertRules]);

  const deleteRule = useCallback((ruleId: number) => {
    const newRules = rules.filter(r => r.id !== ruleId);
    setVisualAlertRules(newRules);
  }, [rules, setVisualAlertRules]);

  const reorderRules = useCallback((reorderedRules: VisualAlertRule[]) => {
    const withPriority = reorderedRules.map((r, i) => ({ ...r, priority: i + 1 }));
    setVisualAlertRules(withPriority);
  }, [setVisualAlertRules]);

  return {
    visualAlertRules: rules,
    isLoading: prefsLoading,
    updateVisualAlertRule: updateRule,
    deleteVisualAlertRule: deleteRule,
    reorderVisualAlertRules: reorderRules,
  };
};
