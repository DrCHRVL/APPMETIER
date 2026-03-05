// utils/storage.ts
import { backupManager } from './backupManager';
import { ElectronBridge } from './electronBridge';
import { APP_CONFIG } from '../config/constants';

interface SaveHistoryEntry {
  date: string;
  type: 'auto' | 'manual';
}

class StorageManagerService {
  private readonly MAX_HISTORY_SIZE = APP_CONFIG.MAX_SAVE_HISTORY;

  /**
   * Récupère des données depuis le stockage (via ElectronBridge — cache + versioning)
   */
  async get<T>(key: string, defaultValue: T): Promise<T> {
    return ElectronBridge.getData<T>(key, defaultValue);
  }

  /**
   * Sauvegarde des données dans le stockage (via ElectronBridge — debounce + versioning)
   */
  async set<T>(key: string, value: T): Promise<boolean> {
    const result = await ElectronBridge.setData(key, value);

    if (this.isImportantData(key)) {
      this.debouncedCreateBackup();
    }

    return result;
  }

  /**
   * Récupère la date de la dernière sauvegarde
   */
  getLastSave(): string | null {
    try {
      return localStorage.getItem(APP_CONFIG.STORAGE_KEYS.LAST_SAVE);
    } catch (error) {
      console.error('Error getting last save date:', error);
      return null;
    }
  }

  /**
   * Ajoute une sauvegarde manuelle à l'historique
   */
  async addManualSaveToHistory(): Promise<void> {
    try {
      const now = new Date().toISOString();
      const history = await this.getSaveHistory();

      const updatedHistory = this.addToHistory(history, { date: now, type: 'manual' });

      await this.set(APP_CONFIG.STORAGE_KEYS.SAVE_HISTORY, updatedHistory);
      await ElectronBridge.setData(APP_CONFIG.STORAGE_KEYS.LAST_SAVE, now);
      localStorage.setItem(APP_CONFIG.STORAGE_KEYS.LAST_SAVE, now);

      await backupManager.createBackup();
    } catch (error) {
      console.error('Error adding manual save to history:', error);
    }
  }

  private async getSaveHistory(): Promise<SaveHistoryEntry[]> {
    const history = await this.get<SaveHistoryEntry[]>(APP_CONFIG.STORAGE_KEYS.SAVE_HISTORY, []);
    return Array.isArray(history) ? history : [];
  }

  private addToHistory(history: SaveHistoryEntry[], entry: SaveHistoryEntry): SaveHistoryEntry[] {
    return [entry, ...history].slice(0, this.MAX_HISTORY_SIZE);
  }

  private isImportantData(key: string): boolean {
    const importantKeys = [
      APP_CONFIG.STORAGE_KEYS.ENQUETES,
      APP_CONFIG.STORAGE_KEYS.INSTRUCTIONS,
      APP_CONFIG.STORAGE_KEYS.ALERT_RULES,
      APP_CONFIG.STORAGE_KEYS.CUSTOM_TAGS,
      APP_CONFIG.STORAGE_KEYS.AUDIENCE_RESULTATS,
      APP_CONFIG.STORAGE_KEYS.AIR_MESURES
    ];
    return importantKeys.some(k => key.includes(k));
  }

  private backupTimeout: NodeJS.Timeout | null = null;

  private debouncedCreateBackup(): void {
    if (this.backupTimeout) clearTimeout(this.backupTimeout);
    this.backupTimeout = setTimeout(() => {
      backupManager.createBackup().catch(error => {
        console.error('Error creating auto backup:', error);
      });
    }, 60000);
  }
}

export const StorageManager = new StorageManagerService();