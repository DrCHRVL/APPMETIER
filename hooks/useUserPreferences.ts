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
import { AgendaUrls, AgendaDisplaySettings, DEFAULT_DISPLAY } from '@/lib/web/agenda';

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
      // Déconnexion : arrêter la synchro périodique (service singleton, startPeriodic
      // est idempotent — inutile d'arrêter au démontage d'une instance parmi d'autres).
      userPreferencesSyncService.stopPeriodic();
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

  const apply = useCallback(async (fn: () => Promise<void>) => {
    await fn();
    await refresh();
  }, [refresh]);

  const seed = useCallback(async (fn: () => Promise<boolean>) => {
    const seeded = await fn();
    if (seeded) await refresh();
    return seeded;
  }, [refresh]);

  const setWeeklyRecapSubscriptions = useCallback(
    (contentieux: string[]) => apply(() => userPreferencesSyncService.setWeeklyRecapSubscriptions(contentieux)),
    [apply]);

  const setServiceOrganizationSections = useCallback(
    (sections: string[]) => apply(() => userPreferencesSyncService.setServiceOrganizationSections(sections)),
    [apply]);

  const setServiceOrganizationTagSection = useCallback(
    (tagId: string, section: string | null) => apply(() => userPreferencesSyncService.setServiceOrganizationTagSection(tagId, section)),
    [apply]);

  const seedServiceOrganization = useCallback(
    (sections: string[], tagSections: Record<string, string>) => seed(() => userPreferencesSyncService.seedServiceOrganization(sections, tagSections)),
    [seed]);

  const setContentieuxAlertsSubscriptions = useCallback(
    (ids: ContentieuxId[]) => apply(() => userPreferencesSyncService.setContentieuxAlertsSubscriptions(ids)),
    [apply]);

  const setCrDelayHighlight = useCallback(
    (enabled: boolean) => apply(() => userPreferencesSyncService.setCrDelayHighlight(enabled)),
    [apply]);

  const setAlertValidation = useCallback(
    (key: string, validation: AlertValidation) => apply(() => userPreferencesSyncService.setAlertValidation(key, validation)),
    [apply]);

  const setAlertValidations = useCallback(
    (entries: AlertValidations) => apply(() => userPreferencesSyncService.setAlertValidations(entries)),
    [apply]);

  const seedAlertValidations = useCallback(
    (entries: AlertValidations) => seed(() => userPreferencesSyncService.seedAlertValidations(entries)),
    [seed]);

  const setVisualAlertRules = useCallback(
    (rules: VisualAlertRule[]) => apply(() => userPreferencesSyncService.setVisualAlertRules(rules)),
    [apply]);

  const seedVisualAlertRules = useCallback(
    (rules: VisualAlertRule[]) => seed(() => userPreferencesSyncService.seedVisualAlertRules(rules)),
    [seed]);

  const setInstructionAlerts = useCallback(
    (alerts: AlerteInstruction[]) => apply(() => userPreferencesSyncService.setInstructionAlerts(alerts)),
    [apply]);

  const seedInstructionAlerts = useCallback(
    (alerts: AlerteInstruction[]) => seed(() => userPreferencesSyncService.seedInstructionAlerts(alerts)),
    [seed]);

  const setInstructionAlertRules = useCallback(
    (rules: InstructionAlertRule[]) => apply(() => userPreferencesSyncService.setInstructionAlertRules(rules)),
    [apply]);

  const seedInstructionAlertRules = useCallback(
    (rules: InstructionAlertRule[]) => seed(() => userPreferencesSyncService.seedInstructionAlertRules(rules)),
    [seed]);

  const setInstructionWeeklyRecapSubscribed = useCallback(
    (subscribed: boolean) => apply(() => userPreferencesSyncService.setInstructionWeeklyRecapSubscribed(subscribed)),
    [apply]);

  const setInstructionNetworkPath = useCallback(
    (networkPath: string) => apply(() => userPreferencesSyncService.setInstructionNetworkPath(networkPath)),
    [apply]);

  const setAgendaUrls = useCallback(
    (urls: AgendaUrls) => apply(() => userPreferencesSyncService.setAgendaUrls(urls)),
    [apply]);

  const setAgendaDisplay = useCallback(
    (display: AgendaDisplaySettings) => apply(() => userPreferencesSyncService.setAgendaDisplay(display)),
    [apply]);

  const seedAgenda = useCallback(
    () => seed(() => userPreferencesSyncService.seedAgenda()),
    [seed]);

  const subscribedContentieux: string[] = prefs?.weeklyRecap?.subscribedContentieux || [];
  const serviceOrganization = prefs?.serviceOrganization;
  const subscribedContentieuxAlerts = prefs?.subscribedContentieuxAlerts;
  const crDelayHighlight = prefs?.crDelayHighlight ?? true;
  const alertValidations = prefs?.alertValidations;
  const visualAlertRules = prefs?.visualAlertRules;
  const instructionAlerts = prefs?.instructionAlerts;
  const instructionAlertRules = prefs?.instructionAlertRules;
  const instructionWeeklyRecapSubscribed = prefs?.instructionWeeklyRecapSubscribed ?? false;
  const instructionNetworkPath = prefs?.instructionNetworkPath ?? '';
  const agendaUrls: AgendaUrls = prefs?.agenda?.urls ?? {};
  const agendaDisplay: AgendaDisplaySettings = {
    ...DEFAULT_DISPLAY,
    ...(prefs?.agenda?.display ?? {}),
    colors: { ...DEFAULT_DISPLAY.colors, ...(prefs?.agenda?.display?.colors ?? {}) },
  };

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
    instructionNetworkPath,
    setInstructionNetworkPath,
    agendaUrls,
    agendaDisplay,
    setAgendaUrls,
    setAgendaDisplay,
    seedAgenda,
    refresh,
  };
}
