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
  const mergedRef = useRef(false);

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

  // Merge des nouvelles règles système ajoutées depuis le dernier seed
  useEffect(() => {
    if (isLoading) return;
    if (!prefs?.seeded) return;
    if (mergedRef.current) return;
    const existing = prefs.rules || [];
    const existingTriggers = new Set(existing.map(r => r.trigger));
    const missing = DEFAULT_INSTRUCTION_ALERT_RULES.filter(
      r => !existingTriggers.has(r.trigger),
    );
    if (missing.length === 0) return;
    mergedRef.current = true;
    setInstructionAlertRules([...existing, ...missing]).catch(err => {
      console.error('Merge instructionAlertRules échoué:', err);
      mergedRef.current = false;
    });
  }, [isLoading, prefs?.seeded, prefs?.rules, setInstructionAlertRules]);

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
