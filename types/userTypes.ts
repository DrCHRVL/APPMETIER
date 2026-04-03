// types/userTypes.ts — Types pour le système multi-utilisateurs et multi-contentieux

// ──────────────────────────────────────────────
// RÔLES
// ──────────────────────────────────────────────

/** Rôle global (transversal, indépendant d'un contentieux) */
export type GlobalRole = 'admin' | 'pra' | 'vice_proc' | null;

/** Rôle au sein d'un contentieux */
export type ContentieuxRole = 'magistrat' | 'ja';

// ──────────────────────────────────────────────
// CONTENTIEUX
// ──────────────────────────────────────────────

/** Identifiant unique d'un contentieux */
export type ContentieuxId = string; // ex: "crimorg", "ecofi", "enviro"

/** Définition d'un contentieux */
export interface ContentieuxDefinition {
  id: ContentieuxId;
  label: string;           // "Criminalité Organisée / Stup"
  color: string;           // Couleur hex pour la sidebar et les badges
  serverFolder: string;    // Nom du dossier sur le serveur (ex: "crimorg")
  order: number;           // Ordre d'affichage dans la sidebar
}

// ──────────────────────────────────────────────
// MODULES OPTIONNELS
// ──────────────────────────────────────────────

/** Modules activables par l'admin */
export type ModuleId = 'air' | 'instructions';

// ──────────────────────────────────────────────
// UTILISATEUR
// ──────────────────────────────────────────────

/** Affectation d'un utilisateur à un contentieux */
export interface UserContentieuxAssignment {
  contentieuxId: ContentieuxId;
  role: ContentieuxRole;
}

/** Profil utilisateur complet */
export interface UserProfile {
  windowsUsername: string;    // Identifiant Windows (auto-détecté)
  displayName: string;        // Nom affiché
  globalRole: GlobalRole;     // Rôle transversal
  contentieux: UserContentieuxAssignment[];
  modules: ModuleId[];        // Modules activés pour cet utilisateur
  createdAt: string;          // ISO date
  updatedAt: string;          // ISO date
}

// ──────────────────────────────────────────────
// FICHIER USERS.JSON (structure serveur)
// ──────────────────────────────────────────────

export interface UsersConfig {
  version: number;
  contentieux: ContentieuxDefinition[];
  users: UserProfile[];
  updatedAt: string;          // ISO date
  updatedBy: string;          // windowsUsername de l'admin
}

// ──────────────────────────────────────────────
// PERMISSIONS
// ──────────────────────────────────────────────

/** Actions possibles sur les données */
export type PermissionAction =
  | 'view'            // Voir les enquêtes/données
  | 'create'          // Créer une enquête
  | 'edit'            // Modifier une enquête (y compris ajouter CR, actes, etc.)
  | 'delete'          // Supprimer une enquête, un CR, un acte
  | 'manage_tags'     // Modifier les tags du contentieux
  | 'manage_alerts'   // Modifier les règles d'alertes
  | 'manage_backups'  // Gérer les sauvegardes
  | 'view_stats'      // Voir les statistiques
  | 'pin_overboard'   // Épingler une enquête sur l'Overboard
  | 'manage_users'    // Gérer les utilisateurs (admin only)
  | 'manage_modules'; // Activer/désactiver les modules (admin only)

/** Permissions résolues pour un utilisateur sur un contentieux donné */
export interface ResolvedPermissions {
  contentieuxId: ContentieuxId;
  actions: Set<PermissionAction>;
  isReadOnly: boolean;       // Raccourci : true si seulement view + view_stats
  syncMode: 'read_write' | 'read_only';
}

/** Contexte de permissions global pour l'utilisateur connecté */
export interface UserPermissionsContext {
  user: UserProfile;
  globalPermissions: Set<PermissionAction>;  // Permissions non liées à un contentieux
  byContentieux: Map<ContentieuxId, ResolvedPermissions>;
  accessibleContentieux: ContentieuxId[];    // Liste des contentieux accessibles
  hasOverboard: boolean;                     // Accès à l'Overboard
}

// ──────────────────────────────────────────────
// OVERBOARD — MARQUAGE D'ENQUÊTES
// ──────────────────────────────────────────────

/** Pin d'une enquête sur l'Overboard */
export interface OverboardPin {
  pinnedBy: string;           // windowsUsername
  pinnedAt: string;           // ISO date
  role: 'admin' | 'pra' | 'vice_proc';
}
