import { useState, useEffect, useCallback } from 'react';
import { VisualAlertRule } from '@/types/interfaces';
import { APP_CONFIG, DEFAULT_VISUAL_ALERT_RULES } from '@/config/constants';
import { ElectronBridge } from '@/utils/electronBridge';

const STORAGE_KEY = APP_CONFIG.STORAGE_KEYS.VISUAL_ALERT_RULES;

export const useVisualAlerts = () => {
  const [rules, setRules] = useState<VisualAlertRule[]>(DEFAULT_VISUAL_ALERT_RULES);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    ElectronBridge.getData<VisualAlertRule[]>(STORAGE_KEY, DEFAULT_VISUAL_ALERT_RULES)
      .then(saved => {
        // Fusionner : garder les règles sauvegardées + ajouter les nouvelles règles système par défaut
        const defaultById = new Map(DEFAULT_VISUAL_ALERT_RULES.map(d => [d.id, d]));
        const savedIds = new Set(saved.map(r => r.id));
        const missingDefaults = DEFAULT_VISUAL_ALERT_RULES.filter(d => !savedIds.has(d.id));

        // Pour les règles système sauvegardées, s'assurer que les champs ajoutés ultérieurement
        // (ex: seuil) sont présents - sinon les comparaisons comme `daysLeft <= undefined` échouent
        const mergedSaved = saved.map(savedRule => {
          const defaultRule = defaultById.get(savedRule.id);
          if (!defaultRule?.isSystemRule) return savedRule;
          // Appliquer les valeurs par défaut pour tout champ manquant (undefined)
          const withDefaults = { ...defaultRule };
          for (const key of Object.keys(savedRule) as (keyof VisualAlertRule)[]) {
            if (savedRule[key] !== undefined) (withDefaults as any)[key] = savedRule[key];
          }
          return withDefaults;
        });

        setRules([...mergedSaved, ...missingDefaults]);
        setIsLoading(false);
      });
  }, []);

  const saveRules = useCallback((newRules: VisualAlertRule[]) => {
    setRules(newRules);
    ElectronBridge.setData(STORAGE_KEY, newRules);
  }, []);

  const updateRule = useCallback((updatedRule: VisualAlertRule) => {
    setRules(prev => {
      const exists = prev.some(r => r.id === updatedRule.id);
      const newRules = exists
        ? prev.map(r => r.id === updatedRule.id ? updatedRule : r)
        : [...prev, updatedRule];
      ElectronBridge.setData(STORAGE_KEY, newRules);
      return newRules;
    });
  }, []);

  const deleteRule = useCallback((ruleId: number) => {
    setRules(prev => {
      const newRules = prev.filter(r => r.id !== ruleId);
      ElectronBridge.setData(STORAGE_KEY, newRules);
      return newRules;
    });
  }, []);

  const reorderRules = useCallback((reorderedRules: VisualAlertRule[]) => {
    // Recalcule les priorités selon l'ordre
    const withPriority = reorderedRules.map((r, i) => ({ ...r, priority: i + 1 }));
    setRules(withPriority);
    ElectronBridge.setData(STORAGE_KEY, withPriority);
  }, []);

  return {
    visualAlertRules: rules,
    isLoading,
    updateVisualAlertRule: updateRule,
    deleteVisualAlertRule: deleteRule,
    reorderVisualAlertRules: reorderRules,
  };
};
