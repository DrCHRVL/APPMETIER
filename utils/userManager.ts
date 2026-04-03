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
        // Auto-inscription : nouvel utilisateur → JA sans contentieux
        console.log(`UserManager: auto-inscription de "${systemUser.displayName}" en tant que JA`);
        this.currentUser = this.autoRegisterUser(systemUser.displayName);
        this.config.users.push(this.currentUser);
        await this.saveConfig();
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

  /** Retourne uniquement les contentieux activés (pour l'app) */
  public getContentieux(): ContentieuxDefinition[] {
    const all = this.config?.contentieux || DEFAULT_CONTENTIEUX;
    return all.filter(c => c.enabled !== false);
  }

  /** Retourne TOUS les contentieux, y compris désactivés (pour l'admin) */
  public getAllContentieux(): ContentieuxDefinition[] {
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
  // GESTION DES DÉFINITIONS DE CONTENTIEUX (admin only)
  // ──────────────────────────────────────────────

  public async addContentieux(def: ContentieuxDefinition): Promise<boolean> {
    if (!this.config || !this.isCurrentUserAdmin()) return false;
    if (this.config.contentieux.some(c => c.id === def.id)) return false;
    this.config.contentieux.push({ ...def, enabled: def.enabled !== false });
    return this.saveConfig();
  }

  public async updateContentieux(id: ContentieuxId, updates: Partial<ContentieuxDefinition>): Promise<boolean> {
    if (!this.config || !this.isCurrentUserAdmin()) return false;
    const idx = this.config.contentieux.findIndex(c => c.id === id);
    if (idx === -1) return false;
    this.config.contentieux[idx] = { ...this.config.contentieux[idx], ...updates, id };
    return this.saveConfig();
  }

  public async toggleContentieux(id: ContentieuxId, enabled: boolean): Promise<boolean> {
    if (!this.config || !this.isCurrentUserAdmin()) return false;
    // Ne pas désactiver le dernier contentieux
    if (!enabled) {
      const enabledCount = this.config.contentieux.filter(c => c.enabled !== false && c.id !== id).length;
      if (enabledCount === 0) return false;
    }
    return this.updateContentieux(id, { enabled });
  }

  // ──────────────────────────────────────────────
  // GESTION DES ASSIGNATIONS CONTENTIEUX (admin only)
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

  /**
   * Auto-inscription d'un nouvel utilisateur : JA sans contentieux.
   * L'admin lui attribuera ensuite ses contentieux et son rôle.
   */
  private autoRegisterUser(windowsUsername: string): UserProfile {
    const now = new Date().toISOString();
    return {
      windowsUsername,
      displayName: windowsUsername,
      globalRole: 'ja' as GlobalRole,
      contentieux: [],
      modules: [],
      createdAt: now,
      updatedAt: now,
    };
  }

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
    // 1. Essayer de lire depuis le serveur partagé
    if (typeof window !== 'undefined' && (window as any).electronAPI?.dataSync_pullUsersConfig) {
      try {
        const serverConfig = await (window as any).electronAPI.dataSync_pullUsersConfig();
        if (serverConfig) {
          // Mettre à jour le cache local pour le mode offline
          await ElectronBridge.setData('users_config', serverConfig);
          return serverConfig;
        }
      } catch (error) {
        console.warn('UserManager: serveur inaccessible, tentative depuis le cache local', error);
      }
    }

    // 2. Fallback : lire depuis le cache local (mode offline)
    try {
      const localConfig = await ElectronBridge.getData<UsersConfig>('users_config', null as any);
      if (localConfig) {
        console.log('UserManager: config chargée depuis le cache local (mode offline)');
      }
      return localConfig;
    } catch (error) {
      console.error('UserManager: erreur lecture cache local', error);
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

    // Toujours sauvegarder en local d'abord (ne doit jamais échouer)
    try {
      await ElectronBridge.setData('users_config', this.config);
    } catch (error) {
      console.error('UserManager: erreur sauvegarde locale', error);
      return false;
    }

    // Puis tenter la sauvegarde serveur (peut échouer en offline)
    try {
      if (typeof window !== 'undefined' && (window as any).electronAPI?.dataSync_pushUsersConfig) {
        await (window as any).electronAPI.dataSync_pushUsersConfig(this.config);
      }
    } catch (error) {
      console.warn('UserManager: sauvegarde serveur échouée (mode offline)', error);
      // Pas de return false — le local est sauvé, ça suffira
    }

    return true;
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
