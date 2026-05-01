// hooks/useInstructionAlertRules.ts
//
// Règles d'alertes du module instruction (tweakables) — stockées dans les
// préférences utilisateur, avec seed initial depuis DEFAULT_INSTRUCTION_ALERT_RULES.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useUserPreferences } from './useUserPreferences';
import { DEFAULT_INSTRUCTION_ALERT_RULES } from '@/config/instructionConfig';
import type { InstructionAlertRule } from '@/types/instructionTypes';

export const useInstructionAlertRules = () => {
  const {
    instructionAlertRules: prefs,
    isLoading,
    setInstructionAlertRules,
    seedInstructionAlertRules,
  } = useUserPreferences();

  const seededRef = useRef(false);

  // Seed initial à partir des règles système
  useEffect(() => {
    if (isLoading) return;
    if (prefs?.seeded) return;
    if (seededRef.current) return;
    seededRef.current = true;
    seedInstructionAlertRules(DEFAULT_INSTRUCTION_ALERT_RULES).catch(err => {
      console.error('Seed instructionAlertRules échoué:', err);
      seededRef.current = false;
    });
  }, [isLoading, prefs?.seeded, seedInstructionAlertRules]);

  const rules = useMemo<InstructionAlertRule[]>(
    () => prefs?.rules || DEFAULT_INSTRUCTION_ALERT_RULES,
    [prefs?.rules],
  );

  const updateRule = useCallback(
    async (id: number, updates: Partial<InstructionAlertRule>) => {
      const next = rules.map(r => (r.id === id ? { ...r, ...updates, id: r.id } : r));
      await setInstructionAlertRules(next);
    },
    [rules, setInstructionAlertRules],
  );

  const resetToDefaults = useCallback(async () => {
    await setInstructionAlertRules(DEFAULT_INSTRUCTION_ALERT_RULES);
  }, [setInstructionAlertRules]);

  return {
    rules,
    isLoading,
    updateRule,
    resetToDefaults,
  };
};
