// hooks/useUserPreferences.ts
//
// Hook d'accès aux préférences de l'utilisateur courant.
// S'abonne aux événements `global-sync-completed` pour se re-hydrater quand
// un autre poste pousse une modif.

import { useCallback, useEffect, useState } from 'react';
import { useUser } from '@/contexts/UserContext';
import { userPreferencesSyncService } from '@/utils/dataSync/UserPreferencesSyncService';
import type { UserPreferencesFile } from '@/types/globalSyncTypes';

export interface WeeklyRecapPrefs {
  subscribedContentieux: string[];
}

export function useUserPreferences() {
  const { user } = useUser();
  const username = user?.windowsUsername || null;
  const [prefs, setPrefs] = useState<UserPreferencesFile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!username) {
      setPrefs(null);
      setIsLoading(false);
      return;
    }
    const p = await userPreferencesSyncService.getPreferences();
    setPrefs(p);
    setIsLoading(false);
  }, [username]);

  // Init + changement d'utilisateur connecté
  useEffect(() => {
    userPreferencesSyncService.setCurrentUser(username);
    if (username) {
      setIsLoading(true);
      userPreferencesSyncService.sync().finally(() => { refresh(); });
      userPreferencesSyncService.startPeriodic();
    } else {
      setPrefs(null);
      setIsLoading(false);
    }
  }, [username, refresh]);

  // Ré-hydratation quand un autre poste pousse des prefs
  useEffect(() => {
    const onSync = (event: Event) => {
      const custom = event as CustomEvent<{ scope?: string }>;
      if (custom.detail?.scope && custom.detail.scope !== 'userPreferences') return;
      refresh();
    };
    window.addEventListener('global-sync-completed', onSync);
    return () => window.removeEventListener('global-sync-completed', onSync);
  }, [refresh]);

  const setWeeklyRecapSubscriptions = useCallback(async (contentieux: string[]) => {
    await userPreferencesSyncService.setWeeklyRecapSubscriptions(contentieux);
    await refresh();
  }, [refresh]);

  const subscribedContentieux: string[] = prefs?.weeklyRecap?.subscribedContentieux || [];

  return {
    prefs,
    isLoading,
    subscribedContentieux,
    setWeeklyRecapSubscriptions,
    refresh,
  };
}
