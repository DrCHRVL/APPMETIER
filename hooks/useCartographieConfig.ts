// hooks/useCartographieConfig.ts
//
// Hook React pour exposer la configuration du module Cartographie
// (pondérations + table d'infraction). Tous les composants qui consomment
// la config s'abonnent ici → les changements depuis l'écran Paramètres
// sont propagés en temps réel sans avoir à recharger l'app.

import { useCallback, useEffect, useState } from 'react';
import { CartographieConfigManager } from '@/utils/cartographieConfigManager';
import {
  DEFAULT_CARTO_CONFIG,
  type CartographieLayoutConfig,
  type CartographieModuleConfig,
  type CartographieScoreWeights,
} from '@/types/cartographieTypes';

export const useCartographieConfig = () => {
  const [config, setConfig] = useState<CartographieModuleConfig>(DEFAULT_CARTO_CONFIG);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    CartographieConfigManager.load()
      .then(c => { if (mounted) { setConfig(c); setIsLoading(false); } })
      .catch(() => { if (mounted) setIsLoading(false); });
    const unsubscribe = CartographieConfigManager.subscribe(c => {
      if (mounted) setConfig(c);
    });
    return () => { mounted = false; unsubscribe(); };
  }, []);

  const updateWeights = useCallback(
    async (patch: Partial<CartographieScoreWeights>) => {
      return CartographieConfigManager.updateWeights(patch);
    },
    [],
  );

  const setTagInfractionWeight = useCallback(
    async (tagId: string, weight: number) => {
      return CartographieConfigManager.setTagInfractionWeight(tagId, weight);
    },
    [],
  );

  const setCategoryWeight = useCallback(
    async (categoryCode: string, weight: number) => {
      return CartographieConfigManager.setCategoryWeight(categoryCode, weight);
    },
    [],
  );

  const setNatinfWeight = useCallback(
    async (code: string, weight: number) => {
      return CartographieConfigManager.setNatinfWeight(code, weight);
    },
    [],
  );

  const setGroupByService = useCallback(async (enabled: boolean) => {
    return CartographieConfigManager.setGroupByService(enabled);
  }, []);

  const updateLayout = useCallback(
    async (patch: Partial<CartographieLayoutConfig>) => {
      return CartographieConfigManager.updateLayout(patch);
    },
    [],
  );

  const reset = useCallback(async () => {
    return CartographieConfigManager.reset();
  }, []);

  return {
    config,
    isLoading,
    updateWeights,
    setTagInfractionWeight,
    setCategoryWeight,
    setNatinfWeight,
    setGroupByService,
    updateLayout,
    reset,
  };
};
