import { create } from '@/lib/zustand';
import { UserManager } from '@/utils/userManager';
import {
  UserProfile,
  ContentieuxDefinition,
  ContentieuxId,
  PermissionAction,
  UserPermissionsContext,
  ModuleId,
} from '@/types/userTypes';
import { canDo as canDoCheck, isAdmin as isAdminCheck, getSyncMode } from '@/utils/permissions';
import { migrateToMultiContentieux } from '@/utils/migration/migrateToMultiContentieux';
import { MultiSyncManager } from '@/utils/dataSync/MultiSyncManager';

interface UserState {
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;
  user: UserProfile | null;
  permissions: UserPermissionsContext | null;
  contentieux: ContentieuxDefinition[];

  // Actions
  initialize: () => Promise<void>;
  refreshUsers: () => Promise<void>;

  // Helpers (fonctions stables — ne causent jamais de re-render)
  canDo: (contentieuxId: ContentieuxId, action: PermissionAction) => boolean;
  isAdmin: () => boolean;
  hasOverboard: () => boolean;
  hasModule: (moduleId: ModuleId) => boolean;
  getSyncMode: (contentieuxId: ContentieuxId) => 'read_write' | 'read_only' | 'none';
  getAccessibleContentieux: () => ContentieuxDefinition[];
}

export const useUserStore = create<UserState>((set, get) => ({
  isLoading: true,
  isAuthenticated: false,
  error: null,
  user: null,
  permissions: null,
  contentieux: [],

  initialize: async () => {
    try {
      set({ isLoading: true, error: null });

      // Migration one-shot mono→multi contentieux
      try {
        await migrateToMultiContentieux();
      } catch (migErr) {
        console.error('UserStore: migration échouée (non bloquante)', migErr);
      }

      const manager = UserManager.getInstance();
      const ctx = await manager.initialize();

      if (ctx) {
        const defs = manager.getContentieux();
        set({
          user: ctx.user,
          permissions: ctx,
          contentieux: defs,
          isAuthenticated: true,
        });

        // Initialiser la synchronisation multi-contentieux
        const syncModes = new Map<ContentieuxId, 'read_write' | 'read_only'>();
        for (const cId of ctx.accessibleContentieux) {
          syncModes.set(cId, getSyncMode(ctx, cId));
        }
        try {
          await MultiSyncManager.getInstance().initialize(defs, ctx.accessibleContentieux, syncModes);
        } catch (syncErr) {
          console.warn('UserStore: sync multi-contentieux non démarrée', syncErr);
        }
      } else {
        set({
          error: "Impossible d'identifier l'utilisateur Windows. Vérifiez votre session.",
          isAuthenticated: false,
        });
      }
    } catch (err) {
      console.error('UserStore: erreur initialisation', err);
      set({
        error: "Erreur lors de l'identification utilisateur.",
        isAuthenticated: false,
      });
    } finally {
      set({ isLoading: false });
    }
  },

  refreshUsers: async () => {
    const manager = UserManager.getInstance();
    const ctx = await manager.initialize();
    if (ctx) {
      set({
        user: ctx.user,
        permissions: ctx,
        contentieux: manager.getContentieux(),
      });
    }
  },

  // Helpers — lisent le state via get(), pas de re-render quand appelés
  canDo: (contentieuxId: ContentieuxId, action: PermissionAction): boolean => {
    const { permissions } = get();
    if (!permissions) return false;
    return canDoCheck(permissions, contentieuxId, action);
  },

  isAdmin: (): boolean => {
    const { permissions } = get();
    if (!permissions) return false;
    return isAdminCheck(permissions);
  },

  hasOverboard: (): boolean => {
    return get().permissions?.hasOverboard ?? false;
  },

  hasModule: (moduleId: ModuleId): boolean => {
    const { user } = get();
    if (!user) return false;
    return user.modules.includes(moduleId);
  },

  getSyncMode: (contentieuxId: ContentieuxId): 'read_write' | 'read_only' | 'none' => {
    const { permissions } = get();
    if (!permissions) return 'none';
    return getSyncMode(permissions, contentieuxId);
  },

  getAccessibleContentieux: (): ContentieuxDefinition[] => {
    const { contentieux, permissions } = get();
    return contentieux.filter(c => permissions?.accessibleContentieux?.includes(c.id) ?? false);
  },
}));
