import { useEffect, useState } from 'react';
import { NetworkStatusManager, NetworkStatus } from '@/utils/networkStatusManager';

/**
 * Hook qui expose l'état réseau courant et se met à jour automatiquement.
 * Le moniteur doit être démarré une fois au login (cf. app/page.tsx).
 */
export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>(() => NetworkStatusManager.getStatus());

  useEffect(() => {
    const unsubscribe = NetworkStatusManager.on(setStatus);
    return unsubscribe;
  }, []);

  return status;
}
