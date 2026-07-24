// utils/electronBridge.ts
import { APP_CONFIG } from '../config/constants';
import { MigrationManager, CURRENT_VERSION } from '../migrations/migrationManager';
import { StorageValidator } from './storage/validator';

class ElectronBridgeService {
  private static instance: ElectronBridgeService;
  private isElectronAvailable: boolean;
  private migrationManager: MigrationManager;
  
  // Cache en mémoire pour minimiser les lectures/écritures
  private dataCache = new Map<string, any>();
  private lastSaveTime = new Map<string, number>();
  private pendingSaves = new Map<string, NodeJS.Timeout>();
  // Clés dont la DERNIÈRE lecture a échoué (fichier illisible côté main, qui
  // rejette alors la requête). À distinguer d'une clé réellement absente : on
  // ne doit jamais traiter une lecture ratée comme « pas de donnée », sinon on
  // risque d'écrire une valeur par défaut par-dessus une vraie donnée.
  private readFailures = new Set<string>();
  
  // Constante pour le délai de sauvegarde
  private readonly SAVE_DELAY = 2500; // 2.5 secondes

  private constructor() {
    this.isElectronAvailable = typeof window !== 'undefined' && !!window.electronAPI;
    this.migrationManager = new MigrationManager();
    
    // Capture les événements de fermeture/mise en veille pour sauvegarder :
    // `pagehide` et `visibilitychange` couvrent iOS et la mise en veille,
    // où `beforeunload` ne se déclenche jamais.
    if (typeof window !== 'undefined') {
      const flush = this.saveAllPendingChanges.bind(this);
      window.addEventListener('beforeunload', flush);
      window.addEventListener('pagehide', flush);
      document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

      // Deux onglets SIRAL ouverts : chaque setData annonce sa clé aux autres
      // onglets, qui invalident leur cache mémoire — sinon un onglet périmé
      // peut pousser un état ancien vers le serveur.
      try {
        this.crossTab = new BroadcastChannel('siral-data');
        this.crossTab.onmessage = (ev) => {
          const k = ev?.data?.key;
          if (typeof k === 'string') this.dataCache.delete(k);
        };
      } catch { /* BroadcastChannel indisponible : navigateur ancien */ }
    }
  }

  private crossTab: BroadcastChannel | null = null;

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

      // Lecture aboutie (clé réellement absente comprise) : on lève le drapeau
      // d'échec éventuel d'une tentative précédente.
      this.readFailures.delete(key);

      if (!result) {
        this.dataCache.set(key, defaultValue);
        return defaultValue;
      }

      // Migration des données, uniquement si nécessaire.
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
      // Lecture en échec (ex. data.json illisible) : on NE met PAS en cache la
      // valeur par défaut (sinon elle serait gravée pour la session et risquerait
      // d'être réécrite sur disque). On marque l'échec et on réessaiera au
      // prochain appel.
      this.readFailures.add(key);
      return defaultValue;
    }
  }

  /** True si la dernière lecture de cette clé a échoué (fichier illisible),
   *  par opposition à une clé réellement absente. Permet aux gestionnaires
   *  sensibles (ex. config carto) de refuser d'écrire par-dessus une donnée
   *  qu'ils n'ont pas pu lire. */
  public didReadFail(key: string): boolean {
    return this.readFailures.has(key);
  }

  public async setData<T>(key: string, value: T): Promise<boolean> {
    // Mettre à jour le cache immédiatement
    this.dataCache.set(key, value);
    try { this.crossTab?.postMessage({ key }); } catch {}
    
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
  
  // Force l'écriture disque immédiate d'une clé en attente (annule le délai
  // de 2,5 s) et attend le résultat réel. À utiliser pour les réglages qu'on
  // édite puis quitte/recharge aussitôt, sinon la sauvegarde temporisée peut
  // être perdue avant son déclenchement.
  public async flush(key: string): Promise<boolean> {
    const timeout = this.pendingSaves.get(key);
    if (timeout) {
      clearTimeout(timeout);
      this.pendingSaves.delete(key);
    }
    if (!this.dataCache.has(key)) return true;
    return this.setDataInternal(key, this.dataCache.get(key));
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

    // Annuler toute sauvegarde temporisée en attente pour cette clé : sinon un
    // setData throttlé ré-écrirait la clé juste après sa suppression (cas de la
    // sentinelle de sync, posée puis effacée en quelques centaines de ms).
    if (this.pendingSaves.has(key)) {
      clearTimeout(this.pendingSaves.get(key)!);
      this.pendingSaves.delete(key);
    }

    if (!this.isElectronAvailable) {
      console.warn('Electron API not available, data not cleared');
      return false;
    }

    try {
      // Suppression intentionnelle via le handler dédié (supprime la clé du
      // fichier). On n'utilise plus setData(key, null) : ce dernier est désormais
      // refusé par le garde-fou anti-écrasement côté main process.
      return await window.electronAPI.clearData(key);
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