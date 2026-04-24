// hooks/useUserServiceOrganization.ts
//
// Organisation des services (sections ordonnées + rattachement tag→section)
// par utilisateur. Les données vivent dans user-preferences/{user}.json ;
// ce hook s'occupe aussi du seed initial depuis l'ancienne organisation
// globale (clé locale `sectionsOrder` + champ `tag.organization.section`
// porté par chaque tag) — une seule fois par utilisateur.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useUserPreferences } from './useUserPreferences';
import { useTags } from './useTags';
import { ElectronBridge } from '@/utils/electronBridge';

const LEGACY_GLOBAL_SECTIONS_KEY = 'sectionsOrder';

interface UseUserServiceOrganizationReturn {
  sections: string[];
  tagSections: Record<string, string>;
  isLoading: boolean;
  isReady: boolean;
  getTagSection: (tagId: string) => string | undefined;
  setSections: (sections: string[]) => Promise<void>;
  setTagSection: (tagId: string, section: string | null) => Promise<void>;
}

export function useUserServiceOrganization(): UseUserServiceOrganizationReturn {
  const {
    prefs,
    isLoading: prefsLoading,
    serviceOrganization,
    setServiceOrganizationSections,
    setServiceOrganizationTagSection,
    seedServiceOrganization,
  } = useUserPreferences();
  const { tags, isLoading: tagsLoading } = useTags();
  const seedAttemptedRef = useRef(false);

  useEffect(() => {
    if (prefsLoading || tagsLoading) return;
    if (!prefs) return;
    if (serviceOrganization?.seeded) return;
    if (seedAttemptedRef.current) return;
    seedAttemptedRef.current = true;

    (async () => {
      try {
        const globalSections = await ElectronBridge.getData<string[]>(
          LEGACY_GLOBAL_SECTIONS_KEY,
          [],
        );
        const tagSections: Record<string, string> = {};
        for (const tag of tags) {
          if (tag.category === 'services' && tag.organization?.section) {
            tagSections[tag.id] = tag.organization.section;
          }
        }
        await seedServiceOrganization(
          Array.isArray(globalSections) ? globalSections : [],
          tagSections,
        );
      } catch (error) {
        console.error('Seed initial service-organization échoué:', error);
        seedAttemptedRef.current = false;
      }
    })();
  }, [prefs, prefsLoading, tags, tagsLoading, serviceOrganization?.seeded, seedServiceOrganization]);

  const sections = useMemo(
    () => serviceOrganization?.sections ?? [],
    [serviceOrganization],
  );
  const tagSections = useMemo(
    () => serviceOrganization?.tagSections ?? {},
    [serviceOrganization],
  );

  const getTagSection = useCallback(
    (tagId: string): string | undefined => tagSections[tagId],
    [tagSections],
  );

  const isReady = !prefsLoading && !tagsLoading && !!serviceOrganization?.seeded;
  const isLoading = prefsLoading || tagsLoading;

  return {
    sections,
    tagSections,
    isLoading,
    isReady,
    getTagSection,
    setSections: setServiceOrganizationSections,
    setTagSection: setServiceOrganizationTagSection,
  };
}
