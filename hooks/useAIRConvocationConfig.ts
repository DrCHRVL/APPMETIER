// hooks/useAIRConvocationConfig.ts
//
// Hook React exposant la configuration des délais du module AIR (seuils des
// alertes de convocation Procureur + « mesures anciennes »). Les composants qui
// consomment la config s'abonnent ici → les changements faits depuis l'écran
// Paramètres se propagent en direct.

import { useCallback, useEffect, useState } from 'react';
import { AIRConfigManager } from '@/utils/airConfigManager';
import {
  DEFAULT_AIR_CONVOCATION_CONFIG,
  type AIRConvocationConfig,
} from '@/types/airConfigTypes';

export const useAIRConvocationConfig = () => {
  const [config, setConfig] = useState<AIRConvocationConfig>(DEFAULT_AIR_CONVOCATION_CONFIG);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    AIRConfigManager.load()
      .then(c => { if (mounted) { setConfig(c); setIsLoading(false); } })
      .catch(() => { if (mounted) setIsLoading(false); });
    const unsubscribe = AIRConfigManager.subscribe(c => {
      if (mounted) setConfig(c);
    });
    return () => { mounted = false; unsubscribe(); };
  }, []);

  const update = useCallback(
    (patch: Partial<AIRConvocationConfig>) => AIRConfigManager.save(patch),
    [],
  );

  const reset = useCallback(() => AIRConfigManager.reset(), []);

  return { config, isLoading, update, reset };
};
