import { useCallback } from 'react';
import { useUserServiceOrganization } from './useUserServiceOrganization';

interface UseSectionsReturn {
  sections: string[];
  isLoading: boolean;
  addSection: (name: string) => Promise<boolean>;
  removeSection: (name: string) => Promise<boolean>;
  reorderSection: (name: string, direction: 'up' | 'down') => Promise<boolean>;
  getSectionOrder: (sectionName: string) => number;
}

export const useSections = (): UseSectionsReturn => {
  const { sections, isLoading, setSections } = useUserServiceOrganization();

  const addSection = useCallback(async (name: string): Promise<boolean> => {
    const trimmed = name.trim();
    if (!trimmed) return false;
    if (sections.includes(trimmed)) return false;
    await setSections([...sections, trimmed]);
    return true;
  }, [sections, setSections]);

  const removeSection = useCallback(async (name: string): Promise<boolean> => {
    if (!sections.includes(name)) return false;
    await setSections(sections.filter(s => s !== name));
    return true;
  }, [sections, setSections]);

  const reorderSection = useCallback(async (name: string, direction: 'up' | 'down'): Promise<boolean> => {
    const index = sections.indexOf(name);
    if (index === -1) return false;
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= sections.length) return false;
    const updated = [...sections];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    await setSections(updated);
    return true;
  }, [sections, setSections]);

  const getSectionOrder = useCallback((sectionName: string): number => {
    const index = sections.indexOf(sectionName);
    if (index !== -1) return index;
    if (sectionName === 'NON ORGANISÉS' || sectionName === 'AUTRES SERVICES') return 9999;
    return sections.length;
  }, [sections]);

  return {
    sections,
    isLoading,
    addSection,
    removeSection,
    reorderSection,
    getSectionOrder,
  };
};
