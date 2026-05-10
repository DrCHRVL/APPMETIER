// hooks/useInstructionCustomTypes.ts
//
// Hook qui expose les types d'événement timeline et les catégories
// d'expertise personnalisés (en plus des types système).

import { useCallback, useEffect, useState } from 'react';
import { InstructionConfigManager } from '@/utils/instructionConfigManager';
import type {
  CustomEvenementType,
  CustomCategorieExpertise,
} from '@/types/instructionTypes';

export const useInstructionCustomTypes = () => {
  const [evenementTypes, setEvenementTypes] = useState<CustomEvenementType[]>([]);
  const [categoriesExpertise, setCategoriesExpertise] = useState<CustomCategorieExpertise[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const [evts, cats] = await Promise.all([
        InstructionConfigManager.getCustomEvenementTypes(),
        InstructionConfigManager.getCustomCategoriesExpertise(),
      ]);
      setEvenementTypes(evts);
      setCategoriesExpertise(cats);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const addEvenementType = useCallback(async (input: CustomEvenementType) => {
    const r = await InstructionConfigManager.addCustomEvenementType(input);
    if (r.ok) await refresh();
    return r;
  }, [refresh]);

  const updateEvenementType = useCallback(
    async (id: string, updates: Partial<Omit<CustomEvenementType, 'id'>>) => {
      const ok = await InstructionConfigManager.updateCustomEvenementType(id, updates);
      if (ok) await refresh();
      return ok;
    },
    [refresh],
  );

  const removeEvenementType = useCallback(async (id: string) => {
    const ok = await InstructionConfigManager.removeCustomEvenementType(id);
    if (ok) await refresh();
    return ok;
  }, [refresh]);

  const addCategorieExpertise = useCallback(
    async (input: CustomCategorieExpertise) => {
      const r = await InstructionConfigManager.addCustomCategorieExpertise(input);
      if (r.ok) await refresh();
      return r;
    },
    [refresh],
  );

  const removeCategorieExpertise = useCallback(async (id: string) => {
    const ok = await InstructionConfigManager.removeCustomCategorieExpertise(id);
    if (ok) await refresh();
    return ok;
  }, [refresh]);

  return {
    evenementTypes,
    categoriesExpertise,
    isLoading,
    refresh,
    addEvenementType,
    updateEvenementType,
    removeEvenementType,
    addCategorieExpertise,
    removeCategorieExpertise,
  };
};
