// hooks/useUserPreferences.ts
//
// Hook d'accès aux préférences de l'utilisateur courant.
// S'abonne aux événements `global-sync-completed` pour se re-hydrater quand
// un autre poste pousse une modif.

import { useCallback, useEffect, useState } from 'react';
import { useUser } from '@/contexts/UserContext';
import { userPreferencesSyncService } from '@/utils/dataSync/UserPreferencesSyncService';
import type { UserPreferencesFile } from '@/types/globalSyncTypes';
import type { AlertValidation, AlertValidations, VisualAlertRule, AlerteInstruction } from '@/types/interfaces';
import type { ContentieuxId } from '@/types/userTypes';
import type { InstructionAlertRule } from '@/types/instructionTypes';

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

  const setContentieuxAlertsSubscriptions = useCallback(async (ids: ContentieuxId[]) => {
    await userPreferencesSyncService.setContentieuxAlertsSubscriptions(ids);
    await refresh();
  }, [refresh]);

  const setCrDelayHighlight = useCallback(async (enabled: boolean) => {
    await userPreferencesSyncService.setCrDelayHighlight(enabled);
    await refresh();
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

  const setInstructionAlertRules = useCallback(async (rules: InstructionAlertRule[]) => {
    await userPreferencesSyncService.setInstructionAlertRules(rules);
    await refresh();
  }, [refresh]);

  const seedInstructionAlertRules = useCallback(async (rules: InstructionAlertRule[]) => {
    const seeded = await userPreferencesSyncService.seedInstructionAlertRules(rules);
    if (seeded) await refresh();
    return seeded;
  }, [refresh]);

  const setInstructionWeeklyRecapSubscribed = useCallback(async (subscribed: boolean) => {
    await userPreferencesSyncService.setInstructionWeeklyRecapSubscribed(subscribed);
    await refresh();
  }, [refresh]);

  const subscribedContentieux: string[] = prefs?.weeklyRecap?.subscribedContentieux || [];
  const serviceOrganization = prefs?.serviceOrganization;
  const subscribedContentieuxAlerts = prefs?.subscribedContentieuxAlerts;
  const crDelayHighlight = prefs?.crDelayHighlight ?? true;
  const alertValidations = prefs?.alertValidations;
  const visualAlertRules = prefs?.visualAlertRules;
  const instructionAlerts = prefs?.instructionAlerts;
  const instructionAlertRules = prefs?.instructionAlertRules;
  const instructionWeeklyRecapSubscribed = prefs?.instructionWeeklyRecapSubscribed ?? false;

  return {
    prefs,
    isLoading,
    subscribedContentieux,
    setWeeklyRecapSubscriptions,
    serviceOrganization,
    setServiceOrganizationSections,
    setServiceOrganizationTagSection,
    seedServiceOrganization,
    subscribedContentieuxAlerts,
    setContentieuxAlertsSubscriptions,
    crDelayHighlight,
    setCrDelayHighlight,
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
    instructionAlertRules,
    setInstructionAlertRules,
    seedInstructionAlertRules,
    instructionWeeklyRecapSubscribed,
    setInstructionWeeklyRecapSubscribed,
    refresh,
  };
}
