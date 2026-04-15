/**
 * ToastContext — wrapper rétro-compatible autour du store Zustand.
 *
 * Le ToastProvider ne fait plus que rendre le composant Toast.
 * L'état est géré par useToastStore (pas de re-render du provider tree).
 *
 * useToast() continue de fonctionner partout — aucun changement nécessaire
 * dans les 54 fichiers consommateurs.
 */

import React from 'react';
import { Toast } from '../components/ui/toast';
import { useToastStore } from '@/stores/useToastStore';

// Ré-exporter le type pour compatibilité
export type { ToastType } from '../components/ui/toast';

/**
 * Provider rétro-compatible.
 * Rend uniquement le composant Toast — l'état est dans le store Zustand.
 * Pas de Context.Provider = pas de cascade de re-renders.
 */
export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  return (
    <>
      {children}
      <ToastDisplay />
    </>
  );
};

/** Composant interne qui s'abonne au store pour afficher le toast */
function ToastDisplay() {
  const toast = useToastStore(s => s.toast);
  const clearToast = useToastStore(s => s.clearToast);

  if (!toast) return null;
  return <Toast message={toast.message} type={toast.type} onClose={clearToast} />;
}

/**
 * Hook rétro-compatible — délègue au store Zustand.
 * Les 54 fichiers consommateurs n'ont rien à changer.
 */
export const useToast = () => {
  const showToast = useToastStore(s => s.showToast);
  return { showToast };
};
