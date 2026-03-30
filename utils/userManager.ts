// utils/userManager.ts — Gestion des utilisateurs et lecture/écriture de users.json
//
// Lit users.json depuis le serveur partagé (via IPC),
// identifie l'utilisateur courant par son Windows username,
// et fournit les méthodes CRUD pour l'admin.

import { ElectronBridge } from './electronBridge';
import {
  UsersConfig,
  UserProfile,
  ContentieuxDefinition,
  ContentieuxId,
  ModuleId,
  GlobalRole,
  ContentieuxRole,
} from '@/types/userTypes';
import { buildPermissionsContext, UserPermissionsContext } from './permissions';

// ──────────────────────────────────────────────
// CONFIGURATION PAR DÉFAUT
// ──────────────────────────────────────────────

const DEFAULT_CONTENTIEUX: ContentieuxDefinition[] = [
  { id: 'crimorg', label: 'Criminalité Organisée / Stup', color: '#dc2626', serverFolder: 'crimorg', order: 1 },
  { id: 'ecofi',   label: 'ECOFI (Financière)',          color: '#2563eb', serverFolder: 'ecofi',   order: 2 },
  { id: 'enviro',  label: 'Atteintes Environnement',     color: '#16a34a', serverFolder: 'enviro',  order: 3 },
];

// ──────────────────────────────────────────────
// USER MANAGER
// ──────────────────────────────────────────────

export class UserManager {
  private static instance: UserManager;
  private config: UsersConfig | null = null;
  private currentUser: UserProfile | null = null;
  private permissionsCtx: UserPermissionsContext | null = null;

  private constructor() {}

  public static getInstance(): UserManager {
    if (!UserManager.instance) {
      UserManager.instance = new UserManager();
    }
    return UserManager.instance;
  }

  // ──────────────────────────────────────────────
  // INITIALISATION
  // ──────────────────────────────────────────────

  /**
   * Initialise le UserManager :
   * 1. Détecte le Windows username
   * 2. Lit users.json depuis le serveur
   * 3. Identifie l'utilisateur courant
   * 4. Construit le contexte de permissions
   *
   * Retourne null si l'utilisateur n'est pas trouvé dans users.json.
   */
  public async initialize(): Promise<UserPermissionsContext | null> {
    try {
      // 1. Obtenir l'identité Windows
      const systemUser = await this.getWindowsUser();
      if (!systemUser) {
        console.error('UserManager: impossible de détecter le Windows username');
        return null;
      }

      // 2. Charger users.json depuis le serveur
      this.config = await this.loadUsersConfig();

      // 3. Si pas de config (premier lancement / migration), créer une config par défaut
      if (!this.config) {
        console.warn('UserManager: users.json introuvable, création de la config initiale');
        this.config = this.createDefaultConfig(systemUser.displayName);
        // Persister immédiatement sur le serveur pour que les prochains lancements la trouvent
        await this.saveConfig();
      }

      // 4. Identifier l'utilisateur courant
      this.currentUser = this.config.users.find(
        u => u.windowsUsername.toLowerCase() === systemUser.displayName.toLowerCase()
      ) || null;

      if (!this.currentUser) {
        console.warn(`UserManager: utilisateur "${systemUser.displayName}" non trouvé dans users.json`);
        return null;
      }

      // 5. Construire les permissions
      const allContentieuxIds = this.config.contentieux.map(c => c.id);
      this.permissionsCtx = buildPermissionsContext(this.currentUser, allContentieuxIds);

      return this.permissionsCtx;
    } catch (error) {
      console.error('UserManager: erreur lors de l\'initialisation', error);
      return null;
    }
  }

  // ──────────────────────────────────────────────
  // GETTERS
  // ──────────────────────────────────────────────

  public getCurrentUser(): UserProfile | null {
    return this.currentUser;
  }

  public getPermissions(): UserPermissionsContext | null {
    return this.permissionsCtx;
  }

  public getConfig(): UsersConfig | null {
    return this.config;
  }

  public getContentieux(): ContentieuxDefinition[] {
    return this.config?.contentieux || DEFAULT_CONTENTIEUX;
  }

  public getContentieuxById(id: ContentieuxId): ContentieuxDefinition | undefined {
    return this.getContentieux().find(c => c.id === id);
  }

  public getAllUsers(): UserProfile[] {
    return this.config?.users || [];
  }

  // ──────────────────────────────────────────────
  // CRUD UTILISATEURS (admin only)
  // ──────────────────────────────────────────────

  public async addUser(user: Omit<UserProfile, 'createdAt' | 'updatedAt'>): Promise<boolean> {
    if (!this.config || !this.isCurrentUserAdmin()) return false;

    const now = new Date().toISOString();
    const newUser: UserProfile = {
      ...user,
      createdAt: now,
      updatedAt: now,
    };

    // Vérifier que le username n'existe pas déjà
    if (this.config.users.some(u => u.windowsUsername.toLowerCase() === newUser.windowsUsername.toLowerCase())) {
      console.error(`UserManager: l'utilisateur "${newUser.windowsUsername}" existe déjà`);
      return false;
    }

    this.config.users.push(newUser);
    return this.saveConfig();
  }

  public async updateUser(windowsUsername: string, updates: Partial<UserProfile>): Promise<boolean> {
    if (!this.config || !this.isCurrentUserAdmin()) return false;

    const index = this.config.users.findIndex(
      u => u.windowsUsername.toLowerCase() === windowsUsername.toLowerCase()
    );
    if (index === -1) return false;

    this.config.users[index] = {
      ...this.config.users[index],
      ...updates,
      windowsUsername: this.config.users[index].windowsUsername, // ne pas changer le username
      updatedAt: new Date().toISOString(),
    };

    // Si on met à jour l'utilisateur courant, recalculer les permissions
    if (this.currentUser?.windowsUsername.toLowerCase() === windowsUsername.toLowerCase()) {
      this.currentUser = this.config.users[index];
      const allContentieuxIds = this.config.contentieux.map(c => c.id);
      this.permissionsCtx = buildPermissionsContext(this.currentUser, allContentieuxIds);
    }

    return this.saveConfig();
  }

  public async removeUser(windowsUsername: string): Promise<boolean> {
    if (!this.config || !this.isCurrentUserAdmin()) return false;

    // Ne pas pouvoir se supprimer soi-même
    if (this.currentUser?.windowsUsername.toLowerCase() === windowsUsername.toLowerCase()) {
      console.error('UserManager: impossible de supprimer son propre compte');
      return false;
    }

    const lengthBefore = this.config.users.length;
    this.config.users = this.config.users.filter(
      u => u.windowsUsername.toLowerCase() !== windowsUsername.toLowerCase()
    );

    if (this.config.users.length === lengthBefore) return false;
    return this.saveConfig();
  }

  // ──────────────────────────────────────────────
  // GESTION DES MODULES (admin only)
  // ──────────────────────────────────────────────

  public async toggleModule(windowsUsername: string, moduleId: ModuleId, enabled: boolean): Promise<boolean> {
    if (!this.config || !this.isCurrentUserAdmin()) return false;

    const user = this.config.users.find(
      u => u.windowsUsername.toLowerCase() === windowsUsername.toLowerCase()
    );
    if (!user) return false;

    if (enabled && !user.modules.includes(moduleId)) {
      user.modules.push(moduleId);
    } else if (!enabled) {
      user.modules = user.modules.filter(m => m !== moduleId);
    }

    user.updatedAt = new Date().toISOString();
    return this.saveConfig();
  }

  // ──────────────────────────────────────────────
  // GESTION DES CONTENTIEUX (admin only)
  // ──────────────────────────────────────────────

  public async assignContentieux(
    windowsUsername: string,
    contentieuxId: ContentieuxId,
    role: ContentieuxRole
  ): Promise<boolean> {
    if (!this.config || !this.isCurrentUserAdmin()) return false;

    const user = this.config.users.find(
      u => u.windowsUsername.toLowerCase() === windowsUsername.toLowerCase()
    );
    if (!user) return false;

    const existing = user.contentieux.find(c => c.contentieuxId === contentieuxId);
    if (existing) {
      existing.role = role;
    } else {
      user.contentieux.push({ contentieuxId, role });
    }

    user.updatedAt = new Date().toISOString();
    return this.saveConfig();
  }

  public async unassignContentieux(windowsUsername: string, contentieuxId: ContentieuxId): Promise<boolean> {
    if (!this.config || !this.isCurrentUserAdmin()) return false;

    const user = this.config.users.find(
      u => u.windowsUsername.toLowerCase() === windowsUsername.toLowerCase()
    );
    if (!user) return false;

    user.contentieux = user.contentieux.filter(c => c.contentieuxId !== contentieuxId);
    user.updatedAt = new Date().toISOString();
    return this.saveConfig();
  }

  // ──────────────────────────────────────────────
  // MÉTHODES PRIVÉES
  // ──────────────────────────────────────────────

  private isCurrentUserAdmin(): boolean {
    return this.currentUser?.globalRole === 'admin';
  }

  private async getWindowsUser(): Promise<{ displayName: string; computerName: string } | null> {
    try {
      if (typeof window !== 'undefined' && (window as any).electronAPI?.getCurrentUser) {
        return await (window as any).electronAPI.getCurrentUser();
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Charge users.json depuis le serveur partagé.
   * Utilise l'IPC dataSync pour lire le fichier.
   */
  private async loadUsersConfig(): Promise<UsersConfig | null> {
    try {
      if (typeof window !== 'undefined' && (window as any).electronAPI?.dataSync_pullUsersConfig) {
        return await (window as any).electronAPI.dataSync_pullUsersConfig();
      }
      // Fallback : lire depuis le stockage local (mode dégradé)
      return await ElectronBridge.getData<UsersConfig>('users_config', null as any);
    } catch (error) {
      console.error('UserManager: erreur chargement users.json', error);
      return null;
    }
  }

  /**
   * Sauvegarde users.json sur le serveur partagé.
   */
  private async saveConfig(): Promise<boolean> {
    if (!this.config) return false;

    this.config.updatedAt = new Date().toISOString();
    this.config.updatedBy = this.currentUser?.windowsUsername || 'unknown';

    try {
      // Sauvegarder sur le serveur
      if (typeof window !== 'undefined' && (window as any).electronAPI?.dataSync_pushUsersConfig) {
        await (window as any).electronAPI.dataSync_pushUsersConfig(this.config);
      }

      // Sauvegarder aussi en local (cache)
      await ElectronBridge.setData('users_config', this.config);
      return true;
    } catch (error) {
      console.error('UserManager: erreur sauvegarde users.json', error);
      return false;
    }
  }

  /**
   * Crée une config par défaut pour le premier lancement (migration).
   * L'utilisateur courant devient admin avec accès à tous les contentieux.
   */
  private createDefaultConfig(windowsUsername: string): UsersConfig {
    const now = new Date().toISOString();
    return {
      version: 1,
      contentieux: DEFAULT_CONTENTIEUX,
      users: [
        {
          windowsUsername,
          displayName: `Admin (${windowsUsername})`,
          globalRole: 'admin',
          contentieux: DEFAULT_CONTENTIEUX.map(c => ({ contentieuxId: c.id, role: 'magistrat' as ContentieuxRole })),
          modules: ['air', 'instructions'] as ModuleId[],
          createdAt: now,
          updatedAt: now,
        },
      ],
      updatedAt: now,
      updatedBy: windowsUsername,
    };
  }
}
