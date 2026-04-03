// utils/electronBridge.ts
import { APP_CONFIG } from '../config/constants';
import { MigrationManager, CURRENT_VERSION } from '../migrations/migrationManager';
import { StorageValidator } from './storage/validator';

interface ElectronAPI {
  getData: <T>(key: string) => Promise<T | null>;
  setData: <T>(key: string, value: T) => Promise<boolean>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

class ElectronBridgeService {
  private static instance: ElectronBridgeService;
  private isElectronAvailable: boolean;
  private migrationManager: MigrationManager;
  
  // Cache en mémoire pour minimiser les lectures/écritures
  private dataCache = new Map<string, any>();
  private lastSaveTime = new Map<string, number>();
  private pendingSaves = new Map<string, NodeJS.Timeout>();
  
  // Constante pour le délai de sauvegarde
  private readonly SAVE_DELAY = 2500; // 2.5 secondes

  private constructor() {
    this.isElectronAvailable = typeof window !== 'undefined' && !!window.electronAPI;
    this.migrationManager = new MigrationManager();
    
    // Capture les événements de fermeture de la fenêtre pour sauvegarder
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.saveAllPendingChanges.bind(this));
    }
  }

  public static getInstance(): ElectronBridgeService {
    if (!ElectronBridgeService.instance) {
      ElectronBridgeService.instance = new ElectronBridgeService();
    }
    return ElectronBridgeService.instance;
  }

  public async getData<T>(key: string, defaultValue: T): Promise<T> {
    // Utiliser le cache si disponible
    if (this.dataCache.has(key)) {
      return this.dataCache.get(key);
    }
    
    if (!this.isElectronAvailable) {
      console.warn('Electron API not available, returning default value');
      return defaultValue;
    }

    try {
      const result = await window.electronAPI.getData<{
        version: number;
        data: T;
      }>(key);

      if (!result) {
        this.dataCache.set(key, defaultValue);
        return defaultValue;
      }

      // Migration des données, uniquement si nécessaire
      const migrationNeeded = result.version < CURRENT_VERSION;
      
      if (migrationNeeded) {
        // Effectuer la migration en arrière-plan pour ne pas bloquer l'interface
        setTimeout(async () => {
          try {
            const migratedData = await this.migrationManager.migrate(
              result.data,
              result.version
            );
            this.dataCache.set(key, migratedData);
            
            // Utiliser setDataInternal pour éviter une autre validation
            await this.setDataInternal(key, migratedData);
          } catch (error) {
            console.error(`Migration error for key ${key}:`, error);
          }
        }, 100);
      }
      
      // Stocker dans le cache et retourner les données
      this.dataCache.set(key, result.data);
      return result.data;
    } catch (error) {
      console.error(`Error getting data for key ${key}:`, error);
      return defaultValue;
    }
  }

  public async setData<T>(key: string, value: T): Promise<boolean> {
    // Mettre à jour le cache immédiatement
    this.dataCache.set(key, value);
    
    // Annuler toute sauvegarde en attente pour cette clé
    if (this.pendingSaves.has(key)) {
      clearTimeout(this.pendingSaves.get(key)!);
    }
    
    // Définir un nouveau timeout pour la sauvegarde
    const timeout = setTimeout(() => {
      this.setDataInternal(key, value).catch(error => {
        console.error(`Error during delayed save for key ${key}:`, error);
      });
      this.pendingSaves.delete(key);
    }, this.SAVE_DELAY);
    
    this.pendingSaves.set(key, timeout);
    
    // Retourner toujours true car la sauvegarde est en attente
    return true;
  }
  
  /**
   * Écriture immédiate — sans SAVE_DELAY.
   * À utiliser pour les opérations critiques (migration, etc.)
   */
  public async setDataImmediate<T>(key: string, value: T): Promise<boolean> {
    this.dataCache.set(key, value);
    // Annuler toute sauvegarde en attente pour cette clé
    if (this.pendingSaves.has(key)) {
      clearTimeout(this.pendingSaves.get(key)!);
      this.pendingSaves.delete(key);
    }
    return this.setDataInternal(key, value);
  }

  // Méthode interne qui effectue la sauvegarde réelle
  private async setDataInternal<T>(key: string, value: T): Promise<boolean> {
    if (!this.isElectronAvailable) {
      console.warn('Electron API not available, data not saved');
      return false;
    }

    try {
      if (value === undefined) {
        throw new Error(`Cannot store undefined value for key ${key}`);
      }

      // Validation minimale uniquement pour les données importantes
      if (this.isImportantData(key) && !this.validateDataBeforeSave(key, value)) {
        console.error(`Invalid data structure for key ${key}, data not saved`);
        return false;
      }

      const dataWithVersion = {
        version: CURRENT_VERSION,
        data: value
      };

      const success = await window.electronAPI.setData(key, dataWithVersion);
      
      if (success) {
        this.lastSaveTime.set(key, Date.now());
        
        // Mettre à jour l'historique de sauvegarde uniquement pour les données importantes
        // mais moins fréquemment
        if (this.isImportantData(key) && this.shouldUpdateSaveHistory(key)) {
          await this.updateSaveHistory();
        }
      }
      
      return success;
    } catch (error) {
      console.error(`Error setting data for key ${key}:`, error);
      return false;
    }
  }
  
  // Détermine si l'historique de sauvegarde doit être mis à jour
  private shouldUpdateSaveHistory(key: string): boolean {
    const lastUpdate = this.lastSaveTime.get('save_history') || 0;
    const now = Date.now();
    // Limiter la mise à jour de l'historique à une fois toutes les 5 minutes
    return (now - lastUpdate) > 5 * 60 * 1000;
  }
  
  // Sauvegarde toutes les modifications en attente
  private saveAllPendingChanges(): void {
    for (const [key, timeout] of this.pendingSaves.entries()) {
      clearTimeout(timeout);
      const value = this.dataCache.get(key);
      if (value !== undefined) {
        // Utiliser la méthode synchrone pour s'assurer que la sauvegarde se produit
        this.setDataInternal(key, value).catch(error => {
          console.error(`Error during final save for key ${key}:`, error);
        });
      }
    }
    this.pendingSaves.clear();
  }

  public async clearData(key: string): Promise<boolean> {
    // Supprimer du cache
    this.dataCache.delete(key);
    
    if (!this.isElectronAvailable) {
      console.warn('Electron API not available, data not cleared');
      return false;
    }

    try {
      return await window.electronAPI.setData(key, null);
    } catch (error) {
      console.error(`Error clearing data for key ${key}:`, error);
      return false;
    }
  }

  public async getAllKeys(): Promise<string[]> {
    if (!this.isElectronAvailable) {
      return [];
    }

    try {
      const keys = await window.electronAPI.getData<string[]>('__keys__');
      return keys || [];
    } catch (error) {
      console.error('Error getting all keys:', error);
      return [];
    }
  }

  private isImportantData(key: string): boolean {
    if (!key) return false;
    return [
      APP_CONFIG.STORAGE_KEYS.ENQUETES,
      APP_CONFIG.STORAGE_KEYS.ALERT_RULES,
      APP_CONFIG.STORAGE_KEYS.CUSTOM_TAGS
    ].includes(key);
  }

  private validateDataBeforeSave<T>(key: string, value: T): boolean {
    try {
      // Validation minimaliste, juste pour vérifier que la structure de base est correcte
      if (key === APP_CONFIG.STORAGE_KEYS.ENQUETES) {
        return Array.isArray(value);
      } else if (key === APP_CONFIG.STORAGE_KEYS.ALERT_RULES) {
        return Array.isArray(value);
      } else if (key === APP_CONFIG.STORAGE_KEYS.CUSTOM_TAGS) {
        return typeof value === 'object' && value !== null;
      }
      
      // Validation générique pour les autres types de données
      return true;
    } catch (error) {
      console.error('Error validating data:', error);
      // En cas d'erreur de validation, on autorise quand même la sauvegarde
      return true;
    }
  }

  private async updateSaveHistory(): Promise<void> {
    const now = new Date().toISOString();
    try {
      let history = await this.getData<Array<{ date: string; type: 'auto' | 'manual' }>>(
        APP_CONFIG.STORAGE_KEYS.SAVE_HISTORY,
        []
      );

      if (!Array.isArray(history)) {
        history = [];
      }

      if (!history.some(entry => entry?.date === now)) {
        history.unshift({ date: now, type: 'auto' });
        
        if (history.length > APP_CONFIG.MAX_SAVE_HISTORY) {
          history.length = APP_CONFIG.MAX_SAVE_HISTORY;
        }

        // Sauvegarde directe sans passer par setData pour éviter la récursion
        this.setDataInternal(APP_CONFIG.STORAGE_KEYS.SAVE_HISTORY, history);
        this.setDataInternal(APP_CONFIG.STORAGE_KEYS.LAST_SAVE, now);
        
        // Mettre à jour le localStorage pour accès rapide
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('lastSave', now);
        }
        
        // Mettre à jour le timestamp de mise à jour
        this.lastSaveTime.set('save_history', Date.now());
      }
    } catch (error) {
      console.error('Error updating save history:', error);
    }
  }

  public isAvailable(): boolean {
    return this.isElectronAvailable;
  }
}

export const ElectronBridge = ElectronBridgeService.getInstance();