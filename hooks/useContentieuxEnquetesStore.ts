/**
 * Hook wrapper rétro-compatible autour du store Zustand useEnquetesStore.
 *
 * Retourne exactement la même API que useContentieuxEnquetes,
 * mais utilise le store Zustand pour le state management.
 * → Pas de Context.Provider = pas de cascade de re-renders.
 *
 * Usage : remplacer `useContentieuxEnquetes` par `useContentieuxEnquetesStore`
 * dans app/page.tsx (un seul import à changer).
 */

import { useEffect } from 'react';
import { useEnquetesStore } from '@/stores/useEnquetesStore';
import { useToastStore } from '@/stores/useToastStore';
import { ContentieuxId } from '@/types/userTypes';

export const useContentieuxEnquetesStore = (contentieuxId: ContentieuxId) => {
  const showToast = useToastStore.getState().showToast;

  // Initialiser / switcher le contentieux dans le store
  useEffect(() => {
    useEnquetesStore.getState().setContentieux(contentieuxId);
  }, [contentieuxId]);

  // Souscrire aux tranches de state individuellement (selectors granulaires)
  const enquetes = useEnquetesStore(s => s.enquetes);
  const selectedEnquete = useEnquetesStore(s => s.selectedEnquete);
  const isEditing = useEnquetesStore(s => s.isEditing);
  const editingCR = useEnquetesStore(s => s.editingCR);
  const isLoading = useEnquetesStore(s => s.isLoading);

  // Actions stables (ne changent jamais de référence grâce à Zustand)
  const setSelectedEnquete = useEnquetesStore(s => s.setSelectedEnquete);
  const setIsEditing = useEnquetesStore(s => s.setIsEditing);
  const setEditingCR = useEnquetesStore(s => s.setEditingCR);
  const updateEnquete = useEnquetesStore(s => s.updateEnquete);
  const addEnquete = useEnquetesStore(s => s.addEnquete);
  const deleteEnquete = useEnquetesStore(s => s.deleteEnquete);
  const archiveEnquete = useEnquetesStore(s => s.archiveEnquete);
  const unarchiveEnquete = useEnquetesStore(s => s.unarchiveEnquete);
  const startEnquete = useEnquetesStore(s => s.startEnquete);
  const ajoutCR = useEnquetesStore(s => s.ajoutCR);
  const updateCR = useEnquetesStore(s => s.updateCR);
  const deleteCR = useEnquetesStore(s => s.deleteCR);
  const flushPendingSave = useEnquetesStore(s => s.flushPendingSave);
  const loadEnquetes = useEnquetesStore(s => s.loadEnquetes);
  const isSharedEnqueteFn = useEnquetesStore(s => s.isSharedEnquete);
  const shareEnquete = useEnquetesStore(s => s.shareEnquete);
  const unshareEnquete = useEnquetesStore(s => s.unshareEnquete);

  // Wrappers pour compatibilité API (les anciens handlers prennent id en premier argument)
  return {
    enquetes,
    selectedEnquete,
    isEditing,
    editingCR,
    isLoading,
    setSelectedEnquete,
    setIsEditing,
    setEditingCR,
    handleUpdateEnquete: updateEnquete,
    handleAddEnquete: (data: any) => {
      const newEnquete = addEnquete(data);
      showToast('Enquête créée', 'success');
      return newEnquete;
    },
    handleDeleteEnquete: (id: number) => {
      deleteEnquete(id);
      showToast('Enquête supprimée', 'info');
    },
    handleArchiveEnquete: (id: number) => {
      archiveEnquete(id);
      showToast('Enquête archivée', 'success');
    },
    handleUnarchiveEnquete: (id: number) => {
      unarchiveEnquete(id);
      showToast('Enquête réactivée', 'success');
    },
    handleStartEnquete: startEnquete,
    handleAjoutCR: ajoutCR,
    handleUpdateCR: updateCR,
    handleDeleteCR: deleteCR,
    flushPendingSave,
    refreshData: loadEnquetes,
    isSharedEnquete: isSharedEnqueteFn,
    handleShareEnquete: shareEnquete,
    handleUnshareEnquete: unshareEnquete,
    contentieuxId,
  };
};
