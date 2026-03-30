// utils/permissions.ts — Résolveur de permissions multi-utilisateurs
//
// Principe : on combine le rôle global + le rôle contentieux.
// Le plus permissif gagne quand il y a chevauchement.

import {
  UserProfile,
  GlobalRole,
  ContentieuxRole,
  ContentieuxId,
  PermissionAction,
  ResolvedPermissions,
  UserPermissionsContext,
} from '@/types/userTypes';

// ──────────────────────────────────────────────
// DÉFINITION DES DROITS PAR RÔLE
// ──────────────────────────────────────────────

/** Permissions du rôle global (s'appliquent à TOUS les contentieux) */
const GLOBAL_ROLE_PERMISSIONS: Record<NonNullable<GlobalRole>, Set<PermissionAction>> = {
  admin: new Set([
    'view', 'create', 'edit', 'delete',
    'manage_tags', 'manage_alerts', 'manage_backups', 'view_stats',
    'pin_overboard', 'manage_users', 'manage_modules',
    'manage_services', 'manage_common_tags', 'full_snapshot',
  ]),
  pra: new Set([
    'view', 'create', 'edit',           // lecture + ajout + modif, PAS de suppression
    'view_stats', 'pin_overboard',
  ]),
  vice_proc: new Set([
    'view', 'view_stats', 'pin_overboard',  // lecture seule + overboard
  ]),
};

/** Permissions d'un rôle contentieux (sur SON contentieux uniquement) */
const CONTENTIEUX_ROLE_PERMISSIONS: Record<ContentieuxRole, Set<PermissionAction>> = {
  magistrat: new Set([
    'view', 'create', 'edit', 'delete',
    'manage_tags', 'manage_alerts', 'manage_backups', 'view_stats',
  ]),
  ja: new Set([
    'view', 'edit',    // lecture + ajout/modif, PAS de suppression ni création d'enquête
    'view_stats',
  ]),
};

// Permissions purement globales (non liées à un contentieux)
const ADMIN_ONLY_PERMISSIONS: Set<PermissionAction> = new Set([
  'manage_users', 'manage_modules', 'manage_services', 'manage_common_tags', 'full_snapshot',
]);

// ──────────────────────────────────────────────
// RÉSOLVEUR
// ──────────────────────────────────────────────

/**
 * Résout les permissions effectives d'un utilisateur sur un contentieux donné.
 * Combine rôle global + rôle contentieux, le plus permissif gagne.
 */
function resolveContentieuxPermissions(
  user: UserProfile,
  contentieuxId: ContentieuxId
): ResolvedPermissions {
  const actions = new Set<PermissionAction>();

  // 1. Appliquer le rôle global (s'il y en a un)
  if (user.globalRole && GLOBAL_ROLE_PERMISSIONS[user.globalRole]) {
    for (const action of GLOBAL_ROLE_PERMISSIONS[user.globalRole]) {
      // Les permissions admin-only ne s'appliquent pas "par contentieux"
      if (!ADMIN_ONLY_PERMISSIONS.has(action)) {
        actions.add(action);
      }
    }
  }

  // 2. Appliquer le rôle contentieux (s'il y en a un)
  const assignment = user.contentieux.find(c => c.contentieuxId === contentieuxId);
  if (assignment && CONTENTIEUX_ROLE_PERMISSIONS[assignment.role]) {
    for (const action of CONTENTIEUX_ROLE_PERMISSIONS[assignment.role]) {
      actions.add(action);
    }
  }

  // Déterminer le mode sync
  const canWrite = actions.has('create') || actions.has('edit') || actions.has('delete');
  const syncMode = canWrite ? 'read_write' as const : 'read_only' as const;

  const isReadOnly = !canWrite;

  return {
    contentieuxId,
    actions,
    isReadOnly,
    syncMode,
  };
}

/**
 * Construit le contexte complet de permissions pour un utilisateur.
 * Appelé une seule fois au login, puis stocké dans le contexte React.
 */
export function buildPermissionsContext(
  user: UserProfile,
  allContentieuxIds: ContentieuxId[]
): UserPermissionsContext {
  // 1. Déterminer les contentieux accessibles
  const accessibleContentieux: ContentieuxId[] = [];
  const byContentieux = new Map<ContentieuxId, ResolvedPermissions>();

  for (const cId of allContentieuxIds) {
    // Accessible si : rôle global transversal OU affecté à ce contentieux
    const hasGlobalAccess = user.globalRole === 'admin'
      || user.globalRole === 'pra'
      || user.globalRole === 'vice_proc';
    const hasDirectAccess = user.contentieux.some(c => c.contentieuxId === cId);

    if (hasGlobalAccess || hasDirectAccess) {
      accessibleContentieux.push(cId);
      byContentieux.set(cId, resolveContentieuxPermissions(user, cId));
    }
  }

  // 2. Permissions globales (non liées à un contentieux)
  const globalPermissions = new Set<PermissionAction>();
  if (user.globalRole === 'admin') {
    for (const action of ADMIN_ONLY_PERMISSIONS) {
      globalPermissions.add(action);
    }
  }

  // 3. Overboard = admin, pra, vice_proc
  const hasOverboard = user.globalRole === 'admin'
    || user.globalRole === 'pra'
    || user.globalRole === 'vice_proc';

  return {
    user,
    globalPermissions,
    byContentieux,
    accessibleContentieux,
    hasOverboard,
  };
}

// ──────────────────────────────────────────────
// HELPERS — à utiliser dans les composants
// ──────────────────────────────────────────────

/** Vérifie si l'utilisateur peut effectuer une action sur un contentieux */
export function canDo(
  ctx: UserPermissionsContext,
  contentieuxId: ContentieuxId,
  action: PermissionAction
): boolean {
  // Vérifier d'abord les permissions globales (admin-only)
  if (ADMIN_ONLY_PERMISSIONS.has(action)) {
    return ctx.globalPermissions.has(action);
  }

  const perms = ctx.byContentieux.get(contentieuxId);
  if (!perms) return false;
  return perms.actions.has(action);
}

/** Vérifie si l'utilisateur est admin */
export function isAdmin(ctx: UserPermissionsContext): boolean {
  return ctx.user.globalRole === 'admin';
}

/** Vérifie si l'utilisateur a un rôle global transversal */
export function hasGlobalView(ctx: UserPermissionsContext): boolean {
  return ctx.user.globalRole === 'admin'
    || ctx.user.globalRole === 'pra'
    || ctx.user.globalRole === 'vice_proc';
}

/** Retourne le mode de sync pour un contentieux */
export function getSyncMode(
  ctx: UserPermissionsContext,
  contentieuxId: ContentieuxId
): 'read_write' | 'read_only' | 'none' {
  const perms = ctx.byContentieux.get(contentieuxId);
  if (!perms) return 'none';
  return perms.syncMode;
}
