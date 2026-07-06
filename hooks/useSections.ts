import { useCallback } from 'react';
import { useUserServiceOrganization } from './useUserServiceOrganization';

interface UseSectionsReturn {
  sections: string[];
  isLoading: boolean;
  addSection: (name: string) => Promise<boolean>;
  removeSection: (name: string) => Promise<boolean>;
  reorderSection: (name: string, direction: 'up' | 'down') => Promise<boolean>;
  /** Persiste l'ordre complet des sections en une seule écriture. À préférer au
   *  réordonnancement pas-à-pas (`reorderSection`), qui, appelé en boucle,
   *  souffrait de closures figées (un déplacement de N crans n'en faisait qu'un). */
  setSectionsOrder: (order: string[]) => Promise<void>;
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

  const setSectionsOrder = useCallback(async (order: string[]): Promise<void> => {
    // Dédupliquer en conservant le premier emplacement, et ne pas perdre une
    // section connue absente de `order` (on l'ajoute en fin par sécurité).
    const seen = new Set<string>();
    const cleaned: string[] = [];
    for (const s of order) {
      const t = s.trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      cleaned.push(t);
    }
    for (const s of sections) {
      if (!seen.has(s)) { seen.add(s); cleaned.push(s); }
    }
    await setSections(cleaned);
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
    setSectionsOrder,
    getSectionOrder,
  };
};
