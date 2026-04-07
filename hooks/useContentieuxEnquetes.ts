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

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Enquete, CompteRendu, NewEnqueteData } from '@/types/interfaces';
import { ElectronBridge } from '@/utils/electronBridge';
import { ContentieuxId } from '@/types/userTypes';
import { MultiSyncManager } from '@/utils/dataSync/MultiSyncManager';
import { ContentieuxManager } from '@/utils/contentieuxManager';
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
 * Charge également les enquêtes partagées (co-saisine) depuis les autres contentieux.
 */
export const useContentieuxEnquetes = (contentieuxId: ContentieuxId) => {
  const [ownEnquetes, setOwnEnquetes] = useState<Enquete[]>([]);
  const [sharedEnquetes, setSharedEnquetes] = useState<Enquete[]>([]);
  const [selectedEnquete, setSelectedEnquete] = useState<Enquete | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editingCR, setEditingCR] = useState<CompteRendu | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDataDirty, setIsDataDirty] = useState(false);

  // Enquêtes combinées (propres + partagées) pour l'affichage
  const enquetes = useMemo(() => [...ownEnquetes, ...sharedEnquetes], [ownEnquetes, sharedEnquetes]);

  const enquetesRef = useRef<Enquete[]>([]);
  const isInitialized = useRef(false);
  const currentContentieuxRef = useRef(contentieuxId);
  const isDataDirtyRef = useRef(false);
  const isLoadingRef = useRef(true);

  const { showToast } = useToast();

  // Reset quand le contentieux change — flush les données dirty avant de switcher
  useEffect(() => {
    if (currentContentieuxRef.current !== contentieuxId) {
      // Capturer les données dirty AVANT de reset les refs
      if (isDataDirtyRef.current && !isLoadingRef.current) {
        const oldKey = storageKey(currentContentieuxRef.current);
        const dataToSave = [...enquetesRef.current]; // copie snapshot
        ElectronBridge.setData(oldKey, dataToSave).catch(err =>
          console.error('useContentieuxEnquetes: erreur flush avant switch', err)
        );
      }
      currentContentieuxRef.current = contentieuxId;
      isInitialized.current = false;
      setIsDataDirty(false);
      isDataDirtyRef.current = false;
      setSelectedEnquete(null);
      setIsEditing(false);
      setEditingCR(null);
      setSharedEnquetes([]);
    }
  }, [contentieuxId]);

  useEffect(() => {
    enquetesRef.current = ownEnquetes;
  }, [ownEnquetes]);

  useEffect(() => { isDataDirtyRef.current = isDataDirty; }, [isDataDirty]);
  useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);

  // Chargement des enquêtes propres
  const loadEnquetes = useCallback(async () => {
    try {
      const key = storageKey(contentieuxId);
      const data = await ElectronBridge.getData<Enquete[]>(key, []);
      const validData = Array.isArray(data)
        ? data.filter(item => item.statut !== 'instruction').map(migrateEnqueteDocuments)
        : [];
      setOwnEnquetes(validData);
      enquetesRef.current = validData;
    } catch (error) {
      console.error(`❌ useContentieuxEnquetes[${contentieuxId}]: erreur chargement`, error);
      setOwnEnquetes([]);
      enquetesRef.current = [];
    }
  }, [contentieuxId]);

  // Chargement des enquêtes partagées depuis les autres contentieux (co-saisine)
  const loadSharedEnquetes = useCallback(async () => {
    try {
      const manager = ContentieuxManager.getInstance();
      const allIds = manager.getLoadedContentieuxIds();
      const shared: Enquete[] = [];
      for (const otherId of allIds) {
        if (otherId === contentieuxId) continue;
        const otherEnquetes = manager.getEnquetes(otherId);
        for (const enquete of otherEnquetes) {
          if (enquete.sharedWith?.includes(contentieuxId)) {
            shared.push({
              ...enquete,
              contentieuxOrigine: enquete.contentieuxOrigine || otherId,
            });
          }
        }
      }
      setSharedEnquetes(shared);
    } catch (error) {
      console.error(`❌ useContentieuxEnquetes[${contentieuxId}]: erreur chargement co-saisines`, error);
      setSharedEnquetes([]);
    }
  }, [contentieuxId]);

  useEffect(() => {
    if (isInitialized.current && currentContentieuxRef.current === contentieuxId) return;

    const init = async () => {
      setIsLoading(true);
      await loadEnquetes();
      await loadSharedEnquetes();
      setIsLoading(false);
      isInitialized.current = true;
    };
    init();
  }, [loadEnquetes, loadSharedEnquetes, contentieuxId]);

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

  // Updater helper (enquêtes propres uniquement)
  const updateEnquetesList = useCallback((updater: (prev: Enquete[]) => Enquete[]) => {
    setOwnEnquetes(prev => {
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

  // ── HELPERS CO-SAISINE ──

  /** Vérifie si une enquête est partagée (provient d'un autre contentieux) */
  const isSharedEnquete = useCallback((enqueteId: number): boolean => {
    return sharedEnquetes.some(e => e.id === enqueteId);
  }, [sharedEnquetes]);

  /** Trouve le contentieux d'origine d'une enquête partagée */
  const getOriginContentieux = useCallback((enqueteId: number): ContentieuxId | null => {
    const shared = sharedEnquetes.find(e => e.id === enqueteId);
    return shared?.contentieuxOrigine || null;
  }, [sharedEnquetes]);

  /**
   * Met à jour une enquête partagée dans son contentieux d'origine.
   * Utilise ContentieuxManager pour écrire dans le bon storage.
   */
  const updateSharedEnquete = useCallback(async (
    originId: ContentieuxId,
    enqueteId: number,
    updater: (enquete: Enquete) => Enquete
  ) => {
    const manager = ContentieuxManager.getInstance();
    const originEnquetes = manager.getEnquetes(originId);
    const updated = originEnquetes.map(e =>
      e.id === enqueteId ? updater(e) : e
    );
    await manager.setEnquetes(originId, updated);
    // Recharger les enquêtes partagées pour refléter le changement
    await loadSharedEnquetes();
  }, [loadSharedEnquetes]);

  // ── CR OPERATIONS ──

  const handleAjoutCR = useCallback((enqueteId: number, cr: CompteRendu | Omit<CompteRendu, 'id'>) => {
    const newCR = 'id' in cr ? { ...cr, contentieuxSource: contentieuxId } : { ...cr, id: Date.now(), contentieuxSource: contentieuxId };

    const originId = getOriginContentieux(enqueteId);
    if (originId) {
      // Enquête partagée → écrire dans le contentieux d'origine
      updateSharedEnquete(originId, enqueteId, e => ({
        ...e,
        comptesRendus: [...e.comptesRendus, newCR],
        dateMiseAJour: new Date().toISOString(),
      }));
      return;
    }

    const now = new Date().toISOString();
    updateEnquetesList(prev =>
      prev.map(e =>
        e.id === enqueteId
          ? { ...e, comptesRendus: [...e.comptesRendus, newCR], dateMiseAJour: now }
          : e
      )
    );
    // Mettre à jour selectedEnquete pour rafraîchir immédiatement l'UI
    setSelectedEnquete(prev => {
      if (prev && prev.id === enqueteId) {
        return { ...prev, comptesRendus: [...prev.comptesRendus, newCR], dateMiseAJour: now };
      }
      return prev;
    });
  }, [updateEnquetesList, getOriginContentieux, updateSharedEnquete, contentieuxId]);

  const handleUpdateCR = useCallback((enqueteId: number, crId: number, updates: Partial<CompteRendu>) => {
    const originId = getOriginContentieux(enqueteId);
    if (originId) {
      updateSharedEnquete(originId, enqueteId, e => ({
        ...e,
        comptesRendus: e.comptesRendus.map(cr =>
          cr.id === crId ? { ...cr, ...updates } : cr
        ),
        dateMiseAJour: new Date().toISOString(),
      }));
      return;
    }

    const now = new Date().toISOString();
    updateEnquetesList(prev =>
      prev.map(e =>
        e.id === enqueteId
          ? {
              ...e,
              comptesRendus: e.comptesRendus.map(cr =>
                cr.id === crId ? { ...cr, ...updates } : cr
              ),
              dateMiseAJour: now,
            }
          : e
      )
    );
    // Mettre à jour selectedEnquete pour rafraîchir immédiatement l'UI
    setSelectedEnquete(prev => {
      if (prev && prev.id === enqueteId) {
        return {
          ...prev,
          comptesRendus: prev.comptesRendus.map(cr =>
            cr.id === crId ? { ...cr, ...updates } : cr
          ),
          dateMiseAJour: now,
        };
      }
      return prev;
    });
  }, [updateEnquetesList, getOriginContentieux, updateSharedEnquete]);

  const handleDeleteCR = useCallback((enqueteId: number, crId: number) => {
    const originId = getOriginContentieux(enqueteId);
    if (originId) {
      updateSharedEnquete(originId, enqueteId, e => ({
        ...e,
        comptesRendus: e.comptesRendus.filter(cr => cr.id !== crId),
        dateMiseAJour: new Date().toISOString(),
      }));
      return;
    }

    const now = new Date().toISOString();
    updateEnquetesList(prev =>
      prev.map(e =>
        e.id === enqueteId
          ? {
              ...e,
              comptesRendus: e.comptesRendus.filter(cr => cr.id !== crId),
              dateMiseAJour: now,
            }
          : e
      )
    );
    // Mettre à jour selectedEnquete pour rafraîchir immédiatement l'UI
    setSelectedEnquete(prev => {
      if (prev && prev.id === enqueteId) {
        return {
          ...prev,
          comptesRendus: prev.comptesRendus.filter(cr => cr.id !== crId),
          dateMiseAJour: now,
        };
      }
      return prev;
    });
  }, [updateEnquetesList, getOriginContentieux, updateSharedEnquete]);

  // ── CO-SAISINE : partager/départager une enquête ──

  const handleShareEnquete = useCallback((enqueteId: number, targetContentieuxIds: string[]) => {
    updateEnquetesList(prev =>
      prev.map(e =>
        e.id === enqueteId
          ? {
              ...e,
              sharedWith: targetContentieuxIds,
              contentieuxOrigine: contentieuxId,
              dateMiseAJour: new Date().toISOString(),
            }
          : e
      )
    );
  }, [updateEnquetesList, contentieuxId]);

  const handleUnshareEnquete = useCallback((enqueteId: number) => {
    updateEnquetesList(prev =>
      prev.map(e =>
        e.id === enqueteId
          ? {
              ...e,
              sharedWith: undefined,
              dateMiseAJour: new Date().toISOString(),
            }
          : e
      )
    );
  }, [updateEnquetesList]);

  return {
    enquetes,
    ownEnquetes,
    sharedEnquetes,
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
    // Co-saisine
    isSharedEnquete,
    handleShareEnquete,
    handleUnshareEnquete,
    loadSharedEnquetes,
    // Le contentieux courant pour référence
    contentieuxId,
  };
};
