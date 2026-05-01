// hooks/useInstructionCabinets.ts
//
// Hook React pour exposer la liste des cabinets configurables et leurs
// opérations CRUD côté UI.

import { useCallback, useEffect, useState } from 'react';
import { InstructionConfigManager } from '@/utils/instructionConfigManager';
import { FALLBACK_CABINET_COLOR } from '@/config/instructionConfig';
import type { Cabinet } from '@/types/instructionTypes';

export const useInstructionCabinets = () => {
  const [cabinets, setCabinets] = useState<Cabinet[]>([]);
  const [allCabinets, setAllCabinets] = useState<Cabinet[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const [enabled, all] = await Promise.all([
        InstructionConfigManager.getEnabledCabinets(),
        InstructionConfigManager.getAllCabinets(),
      ]);
      setCabinets(enabled);
      setAllCabinets(all);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const getCabinetById = useCallback(
    (id: string | undefined): Cabinet | undefined =>
      id ? allCabinets.find(c => c.id === id) : undefined,
    [allCabinets],
  );

  const getCabinetColor = useCallback(
    (id: string | undefined): string =>
      getCabinetById(id)?.color || FALLBACK_CABINET_COLOR,
    [getCabinetById],
  );

  const getCabinetLabel = useCallback(
    (id: string | undefined): string =>
      getCabinetById(id)?.label || 'Cabinet inconnu',
    [getCabinetById],
  );

  const addCabinet = useCallback(
    async (input: Parameters<typeof InstructionConfigManager.addCabinet>[0]) => {
      const result = await InstructionConfigManager.addCabinet(input);
      if (result.ok) await refresh();
      return result;
    },
    [refresh],
  );

  const updateCabinet = useCallback(
    async (id: string, updates: Partial<Omit<Cabinet, 'id'>>) => {
      const ok = await InstructionConfigManager.updateCabinet(id, updates);
      if (ok) await refresh();
      return ok;
    },
    [refresh],
  );

  const removeCabinet = useCallback(
    async (id: string) => {
      const result = await InstructionConfigManager.removeCabinet(id);
      if (result.ok) await refresh();
      return result;
    },
    [refresh],
  );

  const toggleCabinet = useCallback(
    async (id: string, enabled: boolean) => {
      const result = await InstructionConfigManager.toggleCabinet(id, enabled);
      if (result.ok) await refresh();
      return result;
    },
    [refresh],
  );

  return {
    cabinets,           // uniquement activés (UI normale)
    allCabinets,        // tous (admin)
    isLoading,
    refresh,
    getCabinetById,
    getCabinetColor,
    getCabinetLabel,
    addCabinet,
    updateCabinet,
    removeCabinet,
    toggleCabinet,
  };
};
