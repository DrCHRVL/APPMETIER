import { useState, useEffect, useCallback, useRef } from 'react';
import { ElectronBridge } from '@/utils/electronBridge';

interface UseSectionsReturn {
  sections: string[];
  isLoading: boolean;
  addSection: (name: string) => Promise<boolean>;
  removeSection: (name: string) => Promise<boolean>;
  reorderSection: (name: string, direction: 'up' | 'down') => Promise<boolean>;
  getSectionOrder: (sectionName: string) => number;
}

const STORAGE_KEY = 'sectionsOrder';

export const useSections = (): UseSectionsReturn => {
  const [sections, setSections] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const saveTimeoutRef = useRef<NodeJS.Timeout>();

  // Initialisation
  useEffect(() => {
    const initialize = async () => {
      try {
        setIsLoading(true);
        const data = await ElectronBridge.getData(STORAGE_KEY, []);
        setSections(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error('Error loading sections:', error);
        setSections([]);
      } finally {
        setIsLoading(false);
      }
    };
    initialize();
  }, []);

  // Sauvegarde avec debounce
  const debouncedSave = useCallback(async (sectionsToSave: string[]) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await ElectronBridge.setData(STORAGE_KEY, sectionsToSave);
      } catch (error) {
        console.error('Error saving sections:', error);
      }
    }, 300);
  }, []);

  useEffect(() => {
    if (!isLoading) {
      debouncedSave(sections);
    }
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [sections, isLoading, debouncedSave]);

  const addSection = useCallback(async (name: string): Promise<boolean> => {
    const trimmed = name.trim();
    if (!trimmed) return false;

    setSections(prev => {
      if (prev.includes(trimmed)) return prev;
      return [...prev, trimmed];
    });
    return true;
  }, []);

  const removeSection = useCallback(async (name: string): Promise<boolean> => {
    setSections(prev => prev.filter(s => s !== name));
    return true;
  }, []);

  const reorderSection = useCallback(async (name: string, direction: 'up' | 'down'): Promise<boolean> => {
    setSections(prev => {
      const index = prev.indexOf(name);
      if (index === -1) return prev;

      const newIndex = direction === 'up' ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= prev.length) return prev;

      const updated = [...prev];
      [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
      return updated;
    });
    return true;
  }, []);

  const getSectionOrder = useCallback((sectionName: string): number => {
    const index = sections.indexOf(sectionName);
    if (index !== -1) return index;
    if (sectionName === 'NON ORGANISÉS' || sectionName === 'AUTRES SERVICES') return 9999;
    return sections.length; // Unknown sections after known ones
  }, [sections]);

  return {
    sections,
    isLoading,
    addSection,
    removeSection,
    reorderSection,
    getSectionOrder
  };
};
