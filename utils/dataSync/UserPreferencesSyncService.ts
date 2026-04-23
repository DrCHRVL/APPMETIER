// utils/dataSync/UserPreferencesSyncService.ts
//
// Préférences par utilisateur, synchronisées via un fichier JSON par user :
//   P:\...\10_App METIER\user-preferences\{windowsUsername}.json
//
// Portée intentionnellement volontairement ouverte (schéma extensible) : on
// prévoit d'autres préférences utilisateur à venir, chaque clé étant
// indépendante. Pas de tombstone : on ne "supprime" pas une préférence, on
// l'écrase avec une nouvelle valeur (last-write-wins via version+updatedAt).

import { ElectronBridge } from '@/utils/electronBridge';
import { UserPreferencesFile } from '@/types/globalSyncTypes';
import {
  getCurrentUserInfo,
  buildMetadata,
  emitSyncCompleted,
} from './globalSyncCommon';

const LOCAL_KEY_PREFIX = 'user_preferences_';
const PUSH_DEBOUNCE_MS = 800;
const PERIODIC_SYNC_MS = 60_000;

const localKey = (username: string) => `${LOCAL_KEY_PREFIX}${username}`;

function isAvailable(): boolean {
  return typeof window !== 'undefined'
    && !!window.electronAPI?.globalSync_pullUserPreferences
    && !!window.electronAPI?.globalSync_pushUserPreferences;
}

async function pullServer(username: string): Promise<UserPreferencesFile | null> {
  if (!window.electronAPI?.globalSync_pullUserPreferences) return null;
  return (await window.electronAPI.globalSync_pullUserPreferences(username)) || null;
}

async function pushServer(username: string, payload: UserPreferencesFile): Promise<boolean> {
  if (!window.electronAPI?.globalSync_pushUserPreferences) return false;
  return await window.electronAPI.globalSync_pushUserPreferences(username, payload);
}

async function readLocal(username: string): Promise<UserPreferencesFile | null> {
  const raw = await ElectronBridge.getData<UserPreferencesFile | null>(localKey(username), null);
  return raw || null;
}

async function writeLocal(username: string, data: UserPreferencesFile): Promise<void> {
  await ElectronBridge.setData(localKey(username), data);
}

function empty(username: string): UserPreferencesFile {
  return {
    version: 0,
    updatedAt: '1970-01-01T00:00:00.000Z',
    updatedBy: 'init',
    computerName: 'init',
    windowsUsername: username,
    weeklyRecap: { subscribedContentieux: [] },
  };
}

/** Fusion last-write-wins par updatedAt. Conserve la valeur la plus récente pour chaque clé. */
function mergeLatest(a: UserPreferencesFile | null, b: UserPreferencesFile | null): UserPreferencesFile | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a.updatedAt || '') >= Date.parse(b.updatedAt || '') ? a : b;
}

export class UserPreferencesSyncService {
  private static instance: UserPreferencesSyncService;
  private currentUsername: string | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;
  private dirty = false;

  static getInstance(): UserPreferencesSyncService {
    if (!UserPreferencesSyncService.instance) {
      UserPreferencesSyncService.instance = new UserPreferencesSyncService();
    }
    return UserPreferencesSyncService.instance;
  }

  /** Doit être appelé au login ou à chaque changement d'utilisateur connecté. */
  setCurrentUser(username: string | null): void {
    this.currentUsername = username || null;
  }

  startPeriodic(): void {
    if (this.periodicTimer) return;
    this.periodicTimer = setInterval(() => {
      this.sync().catch(err => console.error('UserPrefsSync.periodic', err));
    }, PERIODIC_SYNC_MS);
  }

  stopPeriodic(): void {
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }

  /** Lit les préférences (memo local puis serveur au besoin). */
  async getPreferences(): Promise<UserPreferencesFile | null> {
    if (!this.currentUsername) return null;
    const local = await readLocal(this.currentUsername);
    if (local) return local;
    // Pas encore en local : tenter un pull serveur
    if (isAvailable()) {
      const server = await pullServer(this.currentUsername);
      if (server) {
        await writeLocal(this.currentUsername, server);
        return server;
      }
    }
    return null;
  }

  /**
   * Met à jour les contentieux abonnés au récap hebdo et pousse au serveur.
   * Ne vérifie PAS les permissions : c'est à l'appelant de fournir une liste
   * pré-filtrée aux contentieux accessibles (règle simple "on ne peut
   * s'abonner qu'à ce qu'on peut voir").
   */
  async setWeeklyRecapSubscriptions(contentieux: string[]): Promise<void> {
    if (!this.currentUsername) return;
    const user = await getCurrentUserInfo();
    const current = (await readLocal(this.currentUsername)) || empty(this.currentUsername);
    const next: UserPreferencesFile = {
      ...buildMetadata(current.version || 0, user),
      windowsUsername: this.currentUsername,
      weeklyRecap: {
        ...(current.weeklyRecap || {}),
        subscribedContentieux: Array.from(new Set(contentieux)),
      },
    };
    await writeLocal(this.currentUsername, next);
    emitSyncCompleted('userPreferences');
    this.schedulePush();
  }

  async sync(): Promise<void> {
    if (!isAvailable() || !this.currentUsername) return;
    if (this.inFlight) {
      await this.inFlight;
      return;
    }
    this.inFlight = this.performSync().finally(() => {
      this.inFlight = null;
    });
    await this.inFlight;
  }

  private async performSync(): Promise<void> {
    if (!this.currentUsername) return;
    try {
      const [serverFile, localFile] = await Promise.all([
        pullServer(this.currentUsername),
        readLocal(this.currentUsername),
      ]);

      const merged = mergeLatest(localFile, serverFile);
      if (!merged) {
        this.dirty = false;
        return;
      }

      // Mise à jour locale si le serveur gagne ou s'il n'y avait rien
      const localChanged = !localFile || Date.parse(merged.updatedAt) > Date.parse(localFile.updatedAt || '');
      if (localChanged) {
        await writeLocal(this.currentUsername, merged);
        emitSyncCompleted('userPreferences');
      }

      // Pousser si local gagne ou si push explicite
      const serverNeedsUpdate =
        !serverFile ||
        this.dirty ||
        Date.parse(merged.updatedAt) > Date.parse(serverFile.updatedAt || '');

      if (serverNeedsUpdate) {
        const ok = await pushServer(this.currentUsername, merged);
        if (ok) this.dirty = false;
      } else {
        this.dirty = false;
      }
    } catch (error) {
      console.error('❌ UserPrefsSync: sync échouée', error);
    }
  }

  schedulePush(): void {
    this.dirty = true;
    if (!isAvailable()) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      this.sync().catch(err => console.error('UserPrefsSync.schedulePush', err));
    }, PUSH_DEBOUNCE_MS);
  }
}

export const userPreferencesSyncService = UserPreferencesSyncService.getInstance();
