/**
 * UserContext — wrapper rétro-compatible autour du store Zustand.
 *
 * Le UserProvider initialise le store au montage.
 * useUser() continue de fonctionner partout — aucun changement nécessaire
 * dans les 16 fichiers consommateurs.
 *
 * Avantage Zustand : les composants qui lisent isAdmin() ne re-rendent pas
 * quand `user.name` change. Chaque composant ne re-rend que sur sa tranche.
 */

'use client';

import React, { useEffect, useMemo } from 'react';
import { useUserStore } from '@/stores/useUserStore';
import type {
  ContentieuxId,
  PermissionAction,
  ModuleId,
} from '@/types/userTypes';

/**
 * Provider rétro-compatible.
 * Initialise le store au montage — pas de Context.Provider.
 */
export function UserProvider({ children }: { children: React.ReactNode }) {
  const initialize = useUserStore(s => s.initialize);

  useEffect(() => {
    initialize();
  }, [initialize]);

  return <>{children}</>;
}

/**
 * Hook rétro-compatible — délègue au store Zustand.
 * Retourne le même objet que l'ancien UserContext.
 * Les 16 fichiers consommateurs n'ont rien à changer.
 */
export function useUser() {
  const isLoading = useUserStore(s => s.isLoading);
  const isAuthenticated = useUserStore(s => s.isAuthenticated);
  const error = useUserStore(s => s.error);
  const user = useUserStore(s => s.user);
  const permissions = useUserStore(s => s.permissions);
  const contentieux = useUserStore(s => s.contentieux);
  const canDo = useUserStore(s => s.canDo);
  const isAdmin = useUserStore(s => s.isAdmin);
  const hasOverboard = useUserStore(s => s.hasOverboard);
  const hasModule = useUserStore(s => s.hasModule);
  const getSyncMode = useUserStore(s => s.getSyncMode);
  const refreshUsers = useUserStore(s => s.refreshUsers);
  const getAccessibleContentieux = useUserStore(s => s.getAccessibleContentieux);

  // Mémoiser pour éviter une nouvelle ref array à chaque render — dépend aussi des
  // permissions car getAccessibleContentieux lit `get().permissions` en interne.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const accessibleContentieux = useMemo(() => getAccessibleContentieux(), [contentieux, permissions]);

  return {
    isLoading,
    isAuthenticated,
    error,
    user,
    permissions,
    contentieux,
    accessibleContentieux,
    canDo,
    isAdmin,
    hasOverboard,
    hasModule,
    getSyncMode,
    refreshUsers,
  };
}
