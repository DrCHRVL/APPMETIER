// hooks/useUserPreferences.ts
//
// Hook d'accès aux préférences de l'utilisateur courant.
// S'abonne aux événements `global-sync-completed` pour se re-hydrater quand
// un autre poste pousse une modif.

import { useCallback, useEffect, useState } from 'react';
import { useUser } from '@/contexts/UserContext';
import { userPreferencesSyncService } from '@/utils/dataSync/UserPreferencesSyncService';
import type { UserPreferencesFile } from '@/types/globalSyncTypes';
import type { AlertRule, AlertValidation, AlertValidations, VisualAlertRule, AlerteInstruction } from '@/types/interfaces';

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

  const setServiceOrganizationSections = useCallback(async (sections: string[]) => {
    await userPreferencesSyncService.setServiceOrganizationSections(sections);
    await refresh();
  }, [refresh]);

  const setServiceOrganizationTagSection = useCallback(async (tagId: string, section: string | null) => {
    await userPreferencesSyncService.setServiceOrganizationTagSection(tagId, section);
    await refresh();
  }, [refresh]);

  const seedServiceOrganization = useCallback(async (
    sections: string[],
    tagSections: Record<string, string>,
  ) => {
    const seeded = await userPreferencesSyncService.seedServiceOrganization(sections, tagSections);
    if (seeded) await refresh();
    return seeded;
  }, [refresh]);

  const setAlertRulesGlobal = useCallback(async (rules: AlertRule[]) => {
    await userPreferencesSyncService.setAlertRulesGlobal(rules);
    await refresh();
  }, [refresh]);

  const seedAlertRulesGlobal = useCallback(async (rules: AlertRule[]) => {
    const seeded = await userPreferencesSyncService.seedAlertRulesGlobal(rules);
    if (seeded) await refresh();
    return seeded;
  }, [refresh]);

  const setAlertRulesForContentieux = useCallback(async (contentieuxId: string, rules: AlertRule[]) => {
    await userPreferencesSyncService.setAlertRulesForContentieux(contentieuxId, rules);
    await refresh();
  }, [refresh]);

  const seedAlertRulesForContentieux = useCallback(async (contentieuxId: string, rules: AlertRule[]) => {
    const seeded = await userPreferencesSyncService.seedAlertRulesForContentieux(contentieuxId, rules);
    if (seeded) await refresh();
    return seeded;
  }, [refresh]);

  const setAlertValidation = useCallback(async (key: string, validation: AlertValidation) => {
    await userPreferencesSyncService.setAlertValidation(key, validation);
    await refresh();
  }, [refresh]);

  const setAlertValidations = useCallback(async (entries: AlertValidations) => {
    await userPreferencesSyncService.setAlertValidations(entries);
    await refresh();
  }, [refresh]);

  const seedAlertValidations = useCallback(async (entries: AlertValidations) => {
    const seeded = await userPreferencesSyncService.seedAlertValidations(entries);
    if (seeded) await refresh();
    return seeded;
  }, [refresh]);

  const setVisualAlertRules = useCallback(async (rules: VisualAlertRule[]) => {
    await userPreferencesSyncService.setVisualAlertRules(rules);
    await refresh();
  }, [refresh]);

  const seedVisualAlertRules = useCallback(async (rules: VisualAlertRule[]) => {
    const seeded = await userPreferencesSyncService.seedVisualAlertRules(rules);
    if (seeded) await refresh();
    return seeded;
  }, [refresh]);

  const setInstructionAlerts = useCallback(async (alerts: AlerteInstruction[]) => {
    await userPreferencesSyncService.setInstructionAlerts(alerts);
    await refresh();
  }, [refresh]);

  const seedInstructionAlerts = useCallback(async (alerts: AlerteInstruction[]) => {
    const seeded = await userPreferencesSyncService.seedInstructionAlerts(alerts);
    if (seeded) await refresh();
    return seeded;
  }, [refresh]);

  const subscribedContentieux: string[] = prefs?.weeklyRecap?.subscribedContentieux || [];
  const serviceOrganization = prefs?.serviceOrganization;
  const alertRules = prefs?.alertRules;
  const alertValidations = prefs?.alertValidations;
  const visualAlertRules = prefs?.visualAlertRules;
  const instructionAlerts = prefs?.instructionAlerts;

  return {
    prefs,
    isLoading,
    subscribedContentieux,
    setWeeklyRecapSubscriptions,
    serviceOrganization,
    setServiceOrganizationSections,
    setServiceOrganizationTagSection,
    seedServiceOrganization,
    alertRules,
    setAlertRulesGlobal,
    seedAlertRulesGlobal,
    setAlertRulesForContentieux,
    seedAlertRulesForContentieux,
    alertValidations,
    setAlertValidation,
    setAlertValidations,
    seedAlertValidations,
    visualAlertRules,
    setVisualAlertRules,
    seedVisualAlertRules,
    instructionAlerts,
    setInstructionAlerts,
    seedInstructionAlerts,
    refresh,
  };
}
