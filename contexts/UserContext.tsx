// contexts/UserContext.tsx — Contexte React pour l'utilisateur connecté et ses permissions
//
// Wrape le UserManager et expose les permissions à tous les composants.
// Usage : const { permissions, canDo, isAdmin, contentieux } = useUser();

'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { UserManager } from '@/utils/userManager';
import {
  UserProfile,
  ContentieuxDefinition,
  ContentieuxId,
  PermissionAction,
  UserPermissionsContext,
  ModuleId,
} from '@/types/userTypes';
import { canDo as canDoCheck, isAdmin as isAdminCheck, hasGlobalView, getSyncMode } from '@/utils/permissions';
import { migrateToMultiContentieux } from '@/utils/migration/migrateToMultiContentieux';

// ──────────────────────────────────────────────
// INTERFACE DU CONTEXTE
// ──────────────────────────────────────────────

interface UserContextValue {
  // État
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;

  // Utilisateur courant
  user: UserProfile | null;
  permissions: UserPermissionsContext | null;

  // Données contentieux
  contentieux: ContentieuxDefinition[];
  accessibleContentieux: ContentieuxDefinition[];

  // Helpers rapides
  canDo: (contentieuxId: ContentieuxId, action: PermissionAction) => boolean;
  isAdmin: () => boolean;
  hasOverboard: () => boolean;
  hasModule: (moduleId: ModuleId) => boolean;
  getSyncMode: (contentieuxId: ContentieuxId) => 'read_write' | 'read_only' | 'none';

  // Admin actions
  refreshUsers: () => Promise<void>;
}

const UserContext = createContext<UserContextValue | null>(null);

// ──────────────────────────────────────────────
// PROVIDER
// ──────────────────────────────────────────────

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [permissions, setPermissions] = useState<UserPermissionsContext | null>(null);
  const [contentieux, setContentieux] = useState<ContentieuxDefinition[]>([]);

  // Initialisation au montage
  useEffect(() => {
    const init = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Migration one-shot des données mono→multi contentieux
        await migrateToMultiContentieux();

        const manager = UserManager.getInstance();
        const ctx = await manager.initialize();

        if (ctx) {
          setUser(ctx.user);
          setPermissions(ctx);
          setContentieux(manager.getContentieux());
          setIsAuthenticated(true);
        } else {
          setError('Utilisateur non reconnu. Contactez l\'administrateur.');
          setIsAuthenticated(false);
        }
      } catch (err) {
        console.error('UserContext: erreur initialisation', err);
        setError('Erreur lors de l\'identification utilisateur.');
        setIsAuthenticated(false);
      } finally {
        setIsLoading(false);
      }
    };

    init();
  }, []);

  // Contentieux accessibles (filtrés selon les permissions)
  const accessibleContentieux = contentieux.filter(c =>
    permissions?.accessibleContentieux?.includes(c.id) ?? false
  );

  // Helpers
  const canDoHelper = useCallback(
    (contentieuxId: ContentieuxId, action: PermissionAction): boolean => {
      if (!permissions) return false;
      return canDoCheck(permissions, contentieuxId, action);
    },
    [permissions]
  );

  const isAdminHelper = useCallback((): boolean => {
    if (!permissions) return false;
    return isAdminCheck(permissions);
  }, [permissions]);

  const hasOverboardHelper = useCallback((): boolean => {
    return permissions?.hasOverboard ?? false;
  }, [permissions]);

  const hasModuleHelper = useCallback(
    (moduleId: ModuleId): boolean => {
      if (!user) return false;
      return user.modules.includes(moduleId);
    },
    [user]
  );

  const getSyncModeHelper = useCallback(
    (contentieuxId: ContentieuxId): 'read_write' | 'read_only' | 'none' => {
      if (!permissions) return 'none';
      return getSyncMode(permissions, contentieuxId);
    },
    [permissions]
  );

  const refreshUsers = useCallback(async () => {
    const manager = UserManager.getInstance();
    const ctx = await manager.initialize();
    if (ctx) {
      setUser(ctx.user);
      setPermissions(ctx);
      setContentieux(manager.getContentieux());
    }
  }, []);

  const value: UserContextValue = {
    isLoading,
    isAuthenticated,
    error,
    user,
    permissions,
    contentieux,
    accessibleContentieux,
    canDo: canDoHelper,
    isAdmin: isAdminHelper,
    hasOverboard: hasOverboardHelper,
    hasModule: hasModuleHelper,
    getSyncMode: getSyncModeHelper,
    refreshUsers,
  };

  return (
    <UserContext.Provider value={value}>
      {children}
    </UserContext.Provider>
  );
}

// ──────────────────────────────────────────────
// HOOK
// ──────────────────────────────────────────────

export function useUser(): UserContextValue {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error('useUser doit être utilisé dans un <UserProvider>');
  }
  return context;
}
