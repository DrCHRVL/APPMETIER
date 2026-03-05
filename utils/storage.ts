// utils/storage.ts
import { backupManager } from './backupManager';
import { APP_CONFIG } from '../config/constants'; // 🆕 IMPORT AJOUTÉ

interface SaveHistoryEntry {
  date: string;
  type: 'auto' | 'manual';
}

class StorageManagerService {
  private readonly MAX_HISTORY_SIZE = APP_CONFIG.MAX_SAVE_HISTORY; // 🆕 UTILISE CONSTANTS

  /**
   * Récupère des données depuis le stockage
   */
  async get<T>(key: string, defaultValue: T): Promise<T> {
    try {
      if (!this.isElectronAvailable()) {
        return defaultValue;
      }

      const result = await window.electronAPI.getData(key);
      return result ?? defaultValue;
    } catch (error) {
      console.error(`Error getting data for ${key}:`, error);
      return defaultValue;
    }
  }

  /**
   * Sauvegarde des données dans le stockage
   */
  async set<T>(key: string, value: T): Promise<boolean> {
    try {
      if (!this.isElectronAvailable()) {
        return false;
      }

      if (value === undefined) {
        throw new Error(`Cannot store undefined value for key ${key}`);
      }

      const result = await window.electronAPI.setData(key, value);
      
      // Créer une sauvegarde automatique si c'est une clé importante
      if (this.isImportantData(key)) {
        this.debouncedCreateBackup();
      }
      
      return result;
    } catch (error) {
      console.error(`Error setting data for ${key}:`, error);
      return false;
    }
  }

  /**
   * Récupère la date de la dernière sauvegarde
   */
  getLastSave(): string | null {
    try {
      const lastSaveData = localStorage.getItem(APP_CONFIG.STORAGE_KEYS.LAST_SAVE); // 🆕 UTILISE CONSTANTS
      return lastSaveData;
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

      const updatedHistory = this.addToHistory(history, {
        date: now,
        type: 'manual'
      });

      await this.saveHistory(updatedHistory);
      await this.updateLastSaveDate(now);
      
      // Créer une sauvegarde de sécurité
      await backupManager.createBackup();
    } catch (error) {
      console.error('Error adding manual save to history:', error);
    }
  }

  /**
   * Vérifie si l'API Electron est disponible
   */
  private isElectronAvailable(): boolean {
    return typeof window !== 'undefined' && !!window.electronAPI;
  }

  /**
   * Récupère l'historique des sauvegardes
   */
  private async getSaveHistory(): Promise<SaveHistoryEntry[]> {
    const history = await this.get<SaveHistoryEntry[]>(APP_CONFIG.STORAGE_KEYS.SAVE_HISTORY, []); // 🆕 UTILISE CONSTANTS
    return Array.isArray(history) ? history : [];
  }

  /**
   * Ajoute une entrée à l'historique en respectant la taille maximale
   */
  private addToHistory(
    history: SaveHistoryEntry[], 
    entry: SaveHistoryEntry
  ): SaveHistoryEntry[] {
    const newHistory = [entry, ...history];
    return newHistory.slice(0, this.MAX_HISTORY_SIZE);
  }

  /**
   * Sauvegarde l'historique
   */
  private async saveHistory(history: SaveHistoryEntry[]): Promise<void> {
    await this.set(APP_CONFIG.STORAGE_KEYS.SAVE_HISTORY, history); // 🆕 UTILISE CONSTANTS
  }

  /**
   * Met à jour la date de dernière sauvegarde
   */
  private async updateLastSaveDate(date: string): Promise<void> {
    await this.set(APP_CONFIG.STORAGE_KEYS.LAST_SAVE, date); // 🆕 UTILISE CONSTANTS
    localStorage.setItem(APP_CONFIG.STORAGE_KEYS.LAST_SAVE, date); // 🆕 UTILISE CONSTANTS
  }
  
  /**
   * Vérifie si une clé correspond à des données importantes
   */
  private isImportantData(key: string): boolean {
    const importantKeys = [
      APP_CONFIG.STORAGE_KEYS.ENQUETES,        // 🆕 UTILISE CONSTANTS
      APP_CONFIG.STORAGE_KEYS.INSTRUCTIONS,    // 🆕 UTILISE CONSTANTS
      APP_CONFIG.STORAGE_KEYS.ALERT_RULES,     // 🆕 UTILISE CONSTANTS
      APP_CONFIG.STORAGE_KEYS.CUSTOM_TAGS,     // 🆕 UTILISE CONSTANTS
      APP_CONFIG.STORAGE_KEYS.AUDIENCE_RESULTATS, // 🆕 UTILISE CONSTANTS
      APP_CONFIG.STORAGE_KEYS.AIR_MESURES      // 🆕 UTILISE CONSTANTS
    ];
    
    return importantKeys.some(k => key.includes(k));
  }
  
  // Variable pour le debounce de création de sauvegarde
  private backupTimeout: NodeJS.Timeout | null = null;
  
  /**
   * Crée une sauvegarde avec debounce
   */
  private debouncedCreateBackup(): void {
    if (this.backupTimeout) {
      clearTimeout(this.backupTimeout);
    }
    
    this.backupTimeout = setTimeout(() => {
      backupManager.createBackup().catch(error => {
        console.error('Error creating auto backup:', error);
      });
    }, 60000); // Attendre 1 minute d'inactivité
  }
}

export const StorageManager = new StorageManagerService();