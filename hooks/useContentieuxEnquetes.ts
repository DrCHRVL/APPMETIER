// hooks/useContentieuxEnquetes.ts
//
// Hook qui encapsule useEnquetes pour un contentieux spécifique.
// Au lieu de lire/écrire directement dans les clés globales,
// il redirige vers les clés préfixées du contentieux (ctx_<id>_enquetes).
//
// Ce hook est le pont entre l'ancien système (useEnquetes lit "enquetes")
// et le nouveau (ContentieuxManager lit "ctx_crimorg_enquetes").
//
// Stratégie : on ne modifie PAS useEnquetes.ts, on crée un wrapper
// qui change les clés de stockage via un hook de configuration.

import { useState, useEffect, useCallback, useRef } from 'react';
import { Enquete, CompteRendu, NewEnqueteData } from '@/types/interfaces';
import { ElectronBridge } from '@/utils/electronBridge';
import { ContentieuxId } from '@/types/userTypes';
import { MultiSyncManager } from '@/utils/dataSync/MultiSyncManager';
import { useToast } from '@/contexts/ToastContext';
import throttle from 'lodash/throttle';

const SAVE_THROTTLE = 2500;

// Clé de stockage préfixée par contentieux
function storageKey(contentieuxId: ContentieuxId): string {
  return `ctx_${contentieuxId}_enquetes`;
}

// Migration helper
const migrateEnqueteDocuments = (enquete: any): Enquete => {
  if (!enquete.documents || !Array.isArray(enquete.documents)) {
    enquete.documents = [];
  }
  if (!enquete.toDos || !Array.isArray(enquete.toDos)) {
    enquete.toDos = [];
  }
  return enquete as Enquete;
};

/**
 * Hook pour gérer les enquêtes d'un contentieux spécifique.
 * Même API que useEnquetes, mais scopé à un contentieux.
 */
export const useContentieuxEnquetes = (contentieuxId: ContentieuxId) => {
  const [enquetes, setEnquetes] = useState<Enquete[]>([]);
  const [selectedEnquete, setSelectedEnquete] = useState<Enquete | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editingCR, setEditingCR] = useState<CompteRendu | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDataDirty, setIsDataDirty] = useState(false);

  const enquetesRef = useRef<Enquete[]>([]);
  const isInitialized = useRef(false);
  const currentContentieuxRef = useRef(contentieuxId);
  const isDataDirtyRef = useRef(false);
  const isLoadingRef = useRef(true);

  const { showToast } = useToast();

  // Reset quand le contentieux change — flush les données dirty avant de switcher
  useEffect(() => {
    if (currentContentieuxRef.current !== contentieuxId) {
      // Flush synchrone des données en attente pour l'ancien contentieux
      if (isDataDirtyRef.current && !isLoadingRef.current) {
        const oldKey = storageKey(currentContentieuxRef.current);
        ElectronBridge.setData(oldKey, enquetesRef.current).catch(err =>
          console.error('useContentieuxEnquetes: erreur flush avant switch', err)
        );
      }
      currentContentieuxRef.current = contentieuxId;
      isInitialized.current = false;
      setIsDataDirty(false);
      setSelectedEnquete(null);
      setIsEditing(false);
      setEditingCR(null);
    }
  }, [contentieuxId]);

  useEffect(() => {
    enquetesRef.current = enquetes;
  }, [enquetes]);

  useEffect(() => { isDataDirtyRef.current = isDataDirty; }, [isDataDirty]);
  useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);

  // Chargement
  const loadEnquetes = useCallback(async () => {
    try {
      const key = storageKey(contentieuxId);
      const data = await ElectronBridge.getData<Enquete[]>(key, []);
      const validData = Array.isArray(data)
        ? data.filter(item => item.statut !== 'instruction').map(migrateEnqueteDocuments)
        : [];
      setEnquetes(validData);
      enquetesRef.current = validData;
    } catch (error) {
      console.error(`❌ useContentieuxEnquetes[${contentieuxId}]: erreur chargement`, error);
      setEnquetes([]);
      enquetesRef.current = [];
    }
  }, [contentieuxId]);

  useEffect(() => {
    if (isInitialized.current && currentContentieuxRef.current === contentieuxId) return;

    const init = async () => {
      setIsLoading(true);
      await loadEnquetes();
      setIsLoading(false);
      isInitialized.current = true;
    };
    init();
  }, [loadEnquetes, contentieuxId]);

  // Sauvegarde throttled — refs pour éviter de recréer le throttle à chaque state change
  const saveEnquetes = useCallback(
    throttle(async () => {
      if (!isDataDirtyRef.current || isLoadingRef.current) return;
      try {
        await ElectronBridge.setData(storageKey(contentieuxId), enquetesRef.current);
        setIsDataDirty(false);
        MultiSyncManager.getInstance().triggerPostSaveSync(contentieuxId);
      } catch (error) {
        console.error(`❌ useContentieuxEnquetes[${contentieuxId}]: erreur sauvegarde`, error);
      }
    }, SAVE_THROTTLE),
    [contentieuxId]
  );

  const flushPendingSave = useCallback(async () => {
    if (!isDataDirtyRef.current || isLoadingRef.current) return;
    try {
      await ElectronBridge.setData(storageKey(contentieuxId), enquetesRef.current);
      setIsDataDirty(false);
    } catch (error) {
      console.error(`❌ useContentieuxEnquetes[${contentieuxId}]: erreur flush`, error);
    }
  }, [contentieuxId]);

  useEffect(() => {
    if (isDataDirty && !isLoading) saveEnquetes();
    return () => { saveEnquetes.cancel(); };
  }, [saveEnquetes, isDataDirty, isLoading]);

  // Updater helper
  const updateEnquetesList = useCallback((updater: (prev: Enquete[]) => Enquete[]) => {
    setEnquetes(prev => {
      const updated = updater(prev);
      enquetesRef.current = updated;
      setIsDataDirty(true);
      return updated;
    });
  }, []);

  // ── CRUD OPERATIONS ──

  const handleAddEnquete = useCallback(async (data: NewEnqueteData) => {
    const maxId = enquetesRef.current.reduce((max, e) => Math.max(max, e.id || 0), 0);
    const now = new Date().toISOString();
    const newEnquete: Enquete = {
      ...data,
      id: maxId + 1,
      dateCreation: now,
      dateMiseAJour: now,
      statut: 'en_cours',
      documents: data.documents || [],
      toDos: [],
    };
    updateEnquetesList(prev => [...prev, newEnquete]);
    showToast('Enquête créée', 'success');
    return newEnquete;
  }, [updateEnquetesList, showToast]);

  const handleUpdateEnquete = useCallback((id: number, updates: Partial<Enquete>) => {
    updateEnquetesList(prev =>
      prev.map(e =>
        e.id === id ? { ...e, ...updates, dateMiseAJour: new Date().toISOString() } : e
      )
    );
    // Mettre à jour selectedEnquete si c'est celui qu'on édite
    setSelectedEnquete(prev => {
      if (prev && prev.id === id) {
        return { ...prev, ...updates, dateMiseAJour: new Date().toISOString() };
      }
      return prev;
    });
  }, [updateEnquetesList]);

  const handleDeleteEnquete = useCallback((id: number) => {
    updateEnquetesList(prev => prev.filter(e => e.id !== id));
    setSelectedEnquete(null);
    showToast('Enquête supprimée', 'info');
  }, [updateEnquetesList, showToast]);

  const handleArchiveEnquete = useCallback((id: number) => {
    updateEnquetesList(prev =>
      prev.map(e =>
        e.id === id
          ? { ...e, statut: 'archive' as const, dateArchivage: new Date().toISOString(), dateMiseAJour: new Date().toISOString() }
          : e
      )
    );
    setSelectedEnquete(null);
    showToast('Enquête archivée', 'success');
  }, [updateEnquetesList, showToast]);

  const handleStartEnquete = useCallback((id: number, date: string) => {
    updateEnquetesList(prev =>
      prev.map(enquete => {
        if (enquete.id === id) {
          const newTags = enquete.tags.filter(tag => tag.value !== 'enquête à venir');
          return {
            ...enquete,
            dateDebut: date,
            tags: newTags,
            dateMiseAJour: new Date().toISOString(),
          };
        }
        return enquete;
      })
    );
  }, [updateEnquetesList]);

  const handleUnarchiveEnquete = useCallback((id: number) => {
    updateEnquetesList(prev =>
      prev.map(e =>
        e.id === id
          ? { ...e, statut: 'en_cours' as const, dateMiseAJour: new Date().toISOString() }
          : e
      )
    );
    showToast('Enquête réactivée', 'success');
  }, [updateEnquetesList, showToast]);

  // ── CR OPERATIONS ──

  const handleAjoutCR = useCallback((enqueteId: number, cr: CompteRendu) => {
    updateEnquetesList(prev =>
      prev.map(e =>
        e.id === enqueteId
          ? { ...e, comptesRendus: [...e.comptesRendus, cr], dateMiseAJour: new Date().toISOString() }
          : e
      )
    );
  }, [updateEnquetesList]);

  const handleUpdateCR = useCallback((enqueteId: number, crId: number, updates: Partial<CompteRendu>) => {
    updateEnquetesList(prev =>
      prev.map(e =>
        e.id === enqueteId
          ? {
              ...e,
              comptesRendus: e.comptesRendus.map(cr =>
                cr.id === crId ? { ...cr, ...updates } : cr
              ),
              dateMiseAJour: new Date().toISOString(),
            }
          : e
      )
    );
  }, [updateEnquetesList]);

  const handleDeleteCR = useCallback((enqueteId: number, crId: number) => {
    updateEnquetesList(prev =>
      prev.map(e =>
        e.id === enqueteId
          ? {
              ...e,
              comptesRendus: e.comptesRendus.filter(cr => cr.id !== crId),
              dateMiseAJour: new Date().toISOString(),
            }
          : e
      )
    );
  }, [updateEnquetesList]);

  return {
    enquetes,
    selectedEnquete,
    isEditing,
    editingCR,
    isLoading,
    setSelectedEnquete,
    setIsEditing,
    setEditingCR,
    handleAddEnquete,
    handleUpdateEnquete,
    handleDeleteEnquete,
    handleArchiveEnquete,
    handleUnarchiveEnquete,
    handleStartEnquete,
    handleAjoutCR,
    handleUpdateCR,
    handleDeleteCR,
    flushPendingSave,
    // Le contentieux courant pour référence
    contentieuxId,
  };
};
