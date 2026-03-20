// utils/backupManager.ts
import { ElectronBridge } from './electronBridge';
import { APP_CONFIG } from '../config/constants';
import { StorageValidator } from './storage/validator';

class BackupManager {
  // Configuration des sauvegardes
  private static readonly BACKUP_COUNT = 3; // Limité à 3 sauvegardes
  private static readonly DATA_JSON_BACKUP_COUNT = 3; // 3 copies de data.json aussi
  private static readonly BACKUP_INTERVAL = 3 * 24 * 60 * 60 * 1000; // 3 jours
  private static readonly DATA_JSON_COPY_INTERVAL = 24 * 60 * 60 * 1000; // 1 jour pour data.json
  private static readonly BACKUP_KEY_PREFIX = 'backup_';
  
  // Liste des données importantes pour les sauvegardes sélectives
  private static readonly MAIN_DATA_KEYS = [
    APP_CONFIG.STORAGE_KEYS.ENQUETES,
    APP_CONFIG.STORAGE_KEYS.INSTRUCTIONS,
    APP_CONFIG.STORAGE_KEYS.ALERT_RULES,
    APP_CONFIG.STORAGE_KEYS.CUSTOM_TAGS,
    APP_CONFIG.STORAGE_KEYS.AUDIENCE_RESULTATS,
    APP_CONFIG.STORAGE_KEYS.AIR_MESURES,
    APP_CONFIG.STORAGE_KEYS.SAVE_HISTORY
  ];

  private backupTimerId: NodeJS.Timeout | null = null;
  private dataJsonTimerId: NodeJS.Timeout | null = null;
  private integrityCheckTimerId: NodeJS.Timeout | null = null;
  private lastBackupTime: number = 0;
  private lastDataJsonCopyTime: number = 0;
  private isBackupInProgress: boolean = false;
  private isDataJsonCopyInProgress: boolean = false;

  public initialize(): void {
    console.log('🚀 Initializing BackupManager...');
    
    this.checkLastBackupTime().then(recentBackup => {
      // Démarrer les sauvegardes automatiques
      this.startAutomaticBackup();
      this.startAutomaticDataJsonCopy();
      
      // Vérification d'intégrité hebdomadaire
      this.scheduleIntegrityCheck();
      
      // Sauvegarde initiale si nécessaire (après 5 minutes)
      if (!recentBackup) {
        setTimeout(() => {
          this.checkLastBackupTime().then(stillNeedsBackup => {
            if (!stillNeedsBackup) {
              console.log('⏭️ Skipping initial backup, recent one exists');
              return;
            }
            this.createBackup();
          });
        }, 5 * 60 * 1000); // 5 minutes
      }
    });
  }

  private async checkLastBackupTime(): Promise<boolean> {
    try {
      const backups = await this.listBackups();
      if (backups.length === 0) return false;
      
      const latestBackup = backups[0];
      let date: Date | null = null;
      
      if (latestBackup.endsWith('.json')) {
        date = this.extractDateFromFilename(latestBackup);
      } else {
        date = this.extractDateFromKey(latestBackup);
      }
      
      if (!date) return false;
      
      const now = Date.now();
      const backupTime = date.getTime();
      this.lastBackupTime = backupTime;
      
      // Sauvegarde récente si moins de 24h
      return (now - backupTime) < 24 * 60 * 60 * 1000;
    } catch (error) {
      console.error('❌ Error checking last backup time:', error);
      return false;
    }
  }

  public startAutomaticBackup(): void {
    if (this.backupTimerId) {
      clearInterval(this.backupTimerId);
    }
    
    this.backupTimerId = setInterval(() => {
      const now = Date.now();
      if (this.isBackupInProgress || (now - this.lastBackupTime < 12 * 60 * 60 * 1000)) {
        return;
      }
      this.createBackup();
    }, BackupManager.BACKUP_INTERVAL);
    
    console.log('⏰ Automatic backup scheduled every 3 days');
  }

  public startAutomaticDataJsonCopy(): void {
    if (this.dataJsonTimerId) {
      clearInterval(this.dataJsonTimerId);
    }
    
    this.dataJsonTimerId = setInterval(() => {
      const now = Date.now();
      if (this.isDataJsonCopyInProgress || (now - this.lastDataJsonCopyTime < BackupManager.DATA_JSON_COPY_INTERVAL)) {
        return;
      }
      this.copyDataJsonToBackups();
    }, BackupManager.DATA_JSON_COPY_INTERVAL);
    
    console.log('⏰ Automatic data.json copy scheduled every 24 hours');
  }

  public stopAutomaticBackup(): void {
    if (this.backupTimerId) {
      clearInterval(this.backupTimerId);
      this.backupTimerId = null;
    }
    
    if (this.dataJsonTimerId) {
      clearInterval(this.dataJsonTimerId);
      this.dataJsonTimerId = null;
    }

    if (this.integrityCheckTimerId) {
      clearInterval(this.integrityCheckTimerId);
      this.integrityCheckTimerId = null;
    }
    
    console.log('🛑 All automatic backups stopped');
  }

  // 🆕 COPIE DIRECTE DE DATA.JSON
  public async copyDataJsonToBackups(): Promise<boolean> {
    if (this.isDataJsonCopyInProgress) {
      console.log('📁 Data.json copy already in progress, skipping');
      return false;
    }
    
    // Vérifier si une copie récente existe
    const now = Date.now();
    if (this.lastDataJsonCopyTime > 0 && (now - this.lastDataJsonCopyTime < BackupManager.DATA_JSON_COPY_INTERVAL / 2)) {
      console.log('📁 Recent data.json copy exists, skipping');
      return false;
    }
    
    this.isDataJsonCopyInProgress = true;
    
    try {
      console.log('📁 Starting direct copy of data.json...');
      
      if (!window.electronAPI || !window.electronAPI.copyDataJson) {
        console.error('❌ Data.json copy API not available');
        this.isDataJsonCopyInProgress = false;
        return false;
      }
      
      const timestamp = new Date().toISOString().replace(/:/g, '-');
      const backupFileName = `data_backup_${timestamp}.json`;
      
      const success = await window.electronAPI.copyDataJson(backupFileName);
      
      if (success) {
        console.log(`✅ Data.json copied successfully: ${backupFileName}`);
        
        // Nettoyer les anciennes copies
        await this.rotateDataJsonBackups();
        
        this.lastDataJsonCopyTime = now;
      } else {
        console.error('❌ Failed to copy data.json');
      }
      
      this.isDataJsonCopyInProgress = false;
      return success;
    } catch (error) {
      console.error('❌ Error copying data.json:', error);
      this.isDataJsonCopyInProgress = false;
      return false;
    }
  }

  // 🆕 COMPARAISON ENTRE DATA.JSON ET EXPORT SÉLECTIF
  public async compareDataSources(): Promise<{
    dataJsonSize: number;
    exportSize: number;
    sizeDifference: number;
    dataJsonExists: boolean;
  }> {
    try {
      let dataJsonSize = 0;
      let dataJsonExists = false;
      
      // Tenter de lire les infos de data.json
      if (window.electronAPI && window.electronAPI.getDataJsonInfo) {
        try {
          const fileInfo = await window.electronAPI.getDataJsonInfo();
          if (fileInfo) {
            dataJsonSize = fileInfo.size || 0;
            dataJsonExists = true;
          }
        } catch (error) {
          console.warn('Could not get data.json info:', error);
        }
      }
      
      // Calculer la taille des données exportées
      let exportSize = 0;
      for (const key of BackupManager.MAIN_DATA_KEYS) {
        const data = await ElectronBridge.getData(key, null);
        if (data) {
          exportSize += JSON.stringify(data).length;
        }
      }
      
      const sizeDifference = dataJsonSize - exportSize;
      
      console.log('📊 Data source comparison:', {
        dataJsonSize: `${Math.round(dataJsonSize / 1024)} KB`,
        exportSize: `${Math.round(exportSize / 1024)} KB`,
        difference: `${Math.round(sizeDifference / 1024)} KB`,
        dataJsonExists
      });
      
      return {
        dataJsonSize,
        exportSize,
        sizeDifference,
        dataJsonExists
      };
    } catch (error) {
      console.error('❌ Error comparing data sources:', error);
      return {
        dataJsonSize: 0,
        exportSize: 0,
        sizeDifference: 0,
        dataJsonExists: false
      };
    }
  }

  // SAUVEGARDE SÉLECTIVE (comme avant)
  public async createBackup(force: boolean = false): Promise<boolean> {
    if (this.isBackupInProgress) {
      console.log('💾 Backup already in progress, skipping');
      return false;
    }

    const now = Date.now();
    if (!force && this.lastBackupTime > 0 && (now - this.lastBackupTime < 12 * 60 * 60 * 1000)) {
      console.log('💾 Recent backup exists, skipping');
      return false;
    }
    
    this.isBackupInProgress = true;
    
    try {
      const backupData: Record<string, any> = {};
      let totalDataSize = 0;
      
      for (const key of BackupManager.MAIN_DATA_KEYS) {
        const data = await ElectronBridge.getData(key, null);
        if (data) {
          backupData[key] = data;
          totalDataSize += JSON.stringify(data).length;
        }
      }
      
      if (Object.keys(backupData).length === 0) {
        console.error('❌ No data to backup');
        this.isBackupInProgress = false;
        return false;
      }

      console.log(`💾 Creating selective backup with ${Object.keys(backupData).length} data types (≈${Math.round(totalDataSize/1024)}KB)`);

      const timestamp = new Date().toISOString().replace(/:/g, '-');
      const backupName = `backup_${timestamp}.json`;
      let success = false;
      
      if (window.electronAPI && window.electronAPI.saveFile) {
        success = await window.electronAPI.saveFile(
          'backups',
          backupName,
          JSON.stringify(backupData, null, 2)
        );
        
        if (success) {
          console.log(`✅ Selective backup created: ${backupName}`);
          await this.rotateBackups();
          this.lastBackupTime = Date.now();
        }
      } 
      
      // Fallback: stockage interne
      if (!success) {
        const backupKey = `${BackupManager.BACKUP_KEY_PREFIX}${timestamp}`;
        success = await ElectronBridge.setData(backupKey, backupData);
        
        if (success) {
          await this.rotateInternalBackups();
          console.log(`✅ Internal backup created: ${backupKey}`);
          this.lastBackupTime = Date.now();
        }
      }
      
      this.isBackupInProgress = false;
      return success;
    } catch (error) {
      console.error('❌ Error creating backup:', error);
      this.isBackupInProgress = false;
      return false;
    }
  }

  // 🆕 ROTATION DES COPIES DE DATA.JSON
  private async rotateDataJsonBackups(): Promise<void> {
    try {
      if (window.electronAPI && window.electronAPI.listFiles && window.electronAPI.deleteFile) {
        const backupFiles = await window.electronAPI.listFiles('backups');
        const dataBackups = backupFiles
          .filter(file => file.startsWith('data_backup_') && file.endsWith('.json'))
          .sort()
          .reverse();
        
        if (dataBackups.length > BackupManager.DATA_JSON_BACKUP_COUNT) {
          const filesToRemove = dataBackups.slice(BackupManager.DATA_JSON_BACKUP_COUNT);
          console.log(`🔄 Rotating data.json backups: removing ${filesToRemove.length} old copies`);
          
          for (const file of filesToRemove) {
            await window.electronAPI.deleteFile('backups', file);
          }
        }
      }
    } catch (error) {
      console.error('❌ Error rotating data.json backups:', error);
    }
  }

  // 🆕 LISTER LES COPIES DE DATA.JSON
  public async listDataJsonBackups(): Promise<string[]> {
    try {
      if (window.electronAPI && window.electronAPI.listFiles) {
        const backupFiles = await window.electronAPI.listFiles('backups');
        return backupFiles
          .filter(file => file.startsWith('data_backup_') && file.endsWith('.json'))
          .sort()
          .reverse();
      }
      return [];
    } catch (error) {
      console.error('❌ Error listing data.json backups:', error);
      return [];
    }
  }

  // 🆕 RESTAURER DEPUIS UNE COPIE DE DATA.JSON
  public async restoreFromDataJsonBackup(filename: string): Promise<boolean> {
    try {
      console.log(`🔄 Restoring from data.json backup: ${filename}`);
      
      if (!window.electronAPI || !window.electronAPI.restoreDataJson) {
        console.error('❌ Data.json restore API not available');
        return false;
      }
      
      // Créer une sauvegarde de sécurité avant restauration
      await this.copyDataJsonToBackups();
      
      const success = await window.electronAPI.restoreDataJson(filename);
      
      if (success) {
        console.log(`✅ Successfully restored from: ${filename}`);
        return true;
      } else {
        console.error('❌ Failed to restore from data.json backup');
        return false;
      }
    } catch (error) {
      console.error('❌ Error restoring from data.json backup:', error);
      return false;
    }
  }

  // STATISTIQUES MISES À JOUR
  public async getBackupStats(): Promise<{
    totalBackups: number;
    latestBackup: string | null;
    totalSize: string;
    dataTypes: string[];
    dataJsonInfo?: {
      exists: boolean;
      size: string;
      lastModified?: string;
    };
    comparison?: {
      sizeDifference: string;
      percentage: number;
    };
  }> {
    try {
      const backups = await this.listBackups();
      const latestBackup = backups.length > 0 ? backups[0] : null;
      
      let totalSize = 0;
      const dataTypes: string[] = [];
      
      for (const key of BackupManager.MAIN_DATA_KEYS) {
        const data = await ElectronBridge.getData(key, null);
        if (data) {
          dataTypes.push(key);
          totalSize += JSON.stringify(data).length;
        }
      }
      
      // Comparaison avec data.json
      const comparison = await this.compareDataSources();
      
      const result = {
        totalBackups: backups.length,
        latestBackup: latestBackup ? (() => {
          const d = this.extractDateFromFilename(latestBackup) || this.extractDateFromKey(latestBackup);
          return d ? d.toLocaleString('fr-FR') : latestBackup.replace('backup_', '').replace('.json', '');
        })() : null,
        totalSize: `${Math.round(totalSize / 1024)} KB`,
        dataTypes,
        dataJsonInfo: {
          exists: comparison.dataJsonExists,
          size: `${Math.round(comparison.dataJsonSize / 1024)} KB`,
        },
        comparison: {
          sizeDifference: `${Math.round(comparison.sizeDifference / 1024)} KB`,
          percentage: comparison.exportSize > 0 ? Math.round((comparison.sizeDifference / comparison.exportSize) * 100) : 0
        }
      };
      
      return result;
    } catch (error) {
      console.error('❌ Error getting backup stats:', error);
      return {
        totalBackups: 0,
        latestBackup: null,
        totalSize: '0 KB',
        dataTypes: []
      };
    }
  }

  // MÉTHODES EXISTANTES (rotation, export, etc.)
  public async rotateBackups(): Promise<void> {
    try {
      if (window.electronAPI && window.electronAPI.listFiles && window.electronAPI.deleteFile) {
        const backupFiles = await window.electronAPI.listFiles('backups');
        const selectiveBackups = backupFiles
          .filter(file => file.startsWith('backup_') && file.endsWith('.json') && !file.includes('data_backup_'))
          .sort()
          .reverse();
        
        if (selectiveBackups.length > BackupManager.BACKUP_COUNT) {
          const filesToRemove = selectiveBackups.slice(BackupManager.BACKUP_COUNT);
          console.log(`🔄 Rotating selective backups: removing ${filesToRemove.length} old files`);
          for (const file of filesToRemove) {
            await window.electronAPI.deleteFile('backups', file);
          }
        }
      }
    } catch (error) {
      console.error('❌ Error rotating file backups:', error);
    }
  }

  private async rotateInternalBackups(): Promise<void> {
    try {
      const allKeys = await ElectronBridge.getAllKeys();
      const backupKeys = allKeys.filter(key => 
        key.startsWith(BackupManager.BACKUP_KEY_PREFIX)
      ).sort().reverse();
      
      if (backupKeys.length > BackupManager.BACKUP_COUNT) {
        const keysToRemove = backupKeys.slice(BackupManager.BACKUP_COUNT);
        console.log(`🔄 Rotating internal backups: removing ${keysToRemove.length} old backups`);
        for (const key of keysToRemove) {
          await ElectronBridge.clearData(key);
        }
      }
    } catch (error) {
      console.error('❌ Error rotating internal backups:', error);
    }
  }

  public async restoreFromBackup(backupIdentifier: string): Promise<boolean> {
    const isFileBackup = backupIdentifier.endsWith('.json');
    
    try {
      console.log(`🔄 Restoring from backup: ${backupIdentifier}`);
      
      if (isFileBackup && window.electronAPI && window.electronAPI.readFile) {
        return await this.restoreFromFileBackup(backupIdentifier);
      } else {
        return await this.restoreFromInternalBackup(backupIdentifier);
      }
    } catch (error) {
      console.error('❌ Error restoring from backup:', error);
      return false;
    }
  }

  private async restoreFromFileBackup(filename: string): Promise<boolean> {
    try {
      const backupContent = await window.electronAPI.readFile('backups', filename);
      
      if (!backupContent) {
        console.error(`❌ Backup file ${filename} not found or empty`);
        return false;
      }
      
      const backupData = JSON.parse(backupContent);
      
      if (!StorageValidator.validateBackupData(backupData)) {
        console.error('❌ Invalid backup data structure');
        return false;
      }
      
      let success = true;
      const restoredKeys: string[] = [];
      
      for (const key of Object.keys(backupData)) {
        const result = await ElectronBridge.setData(key, backupData[key]);
        if (!result) {
          console.error(`❌ Failed to restore data for key: ${key}`);
          success = false;
        } else {
          restoredKeys.push(key);
        }
      }
      
      if (success) {
        console.log(`✅ Successfully restored ${restoredKeys.length} data types: ${restoredKeys.join(', ')}`);
      }
      
      return success;
    } catch (error) {
      console.error('❌ Error restoring from file backup:', error);
      return false;
    }
  }

  private async restoreFromInternalBackup(backupKey: string): Promise<boolean> {
    try {
      const backup = await ElectronBridge.getData(backupKey, null);
      if (!backup) {
        console.error(`❌ Backup with key ${backupKey} not found`);
        return false;
      }
      
      let success = true;
      const restoredKeys: string[] = [];
      
      for (const key of Object.keys(backup)) {
        const result = await ElectronBridge.setData(key, backup[key]);
        if (!result) {
          console.error(`❌ Failed to restore data for key: ${key}`);
          success = false;
        } else {
          restoredKeys.push(key);
        }
      }
      
      if (success) {
        console.log(`✅ Successfully restored ${restoredKeys.length} data types: ${restoredKeys.join(', ')}`);
      }
      
      return success;
    } catch (error) {
      console.error('❌ Error restoring from internal backup:', error);
      return false;
    }
  }

  public async listBackups(): Promise<string[]> {
    const fileBackups: string[] = [];
    const internalBackups: string[] = [];
    
    try {
      if (window.electronAPI && window.electronAPI.listFiles) {
        try {
          const backupFiles = await window.electronAPI.listFiles('backups');
          fileBackups.push(...backupFiles.filter(file => 
            file.startsWith('backup_') && file.endsWith('.json')
          ));
        } catch (fileError) {
          console.error('❌ Error listing file backups:', fileError);
        }
      }
      
      try {
        const allKeys = await ElectronBridge.getAllKeys();
        internalBackups.push(...allKeys.filter(key => 
          key.startsWith(BackupManager.BACKUP_KEY_PREFIX)
        ));
      } catch (internalError) {
        console.error('❌ Error listing internal backups:', internalError);
      }
      
      const allBackups = [
        ...fileBackups.map(file => ({ id: file, type: 'file', date: this.extractDateFromFilename(file) })),
        ...internalBackups.map(key => ({ id: key, type: 'internal', date: this.extractDateFromKey(key) }))
      ];
      
      allBackups.sort((a, b) => {
        if (a.date && b.date) {
          return b.date.getTime() - a.date.getTime();
        }
        return 0;
      });
      
      return allBackups.map(backup => backup.id);
    } catch (error) {
      console.error('❌ Error listing backups:', error);
      return [];
    }
  }

  private extractDateFromFilename(filename: string): Date | null {
    try {
      const dateStr = filename.replace('backup_', '').replace('data_backup_', '').replace('.json', '');
      // Le timestamp a été créé avec .replace(/:/g, '-'), donc seule la partie heure
      // contient des tirets à restaurer en ':'. La date (YYYY-MM-DD) doit garder ses tirets.
      // Format attendu : 2026-03-07T19-43-00.000Z
      const formattedDate = dateStr.replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3');
      const date = new Date(formattedDate);
      return isNaN(date.getTime()) ? null : date;
    } catch (error) {
      return null;
    }
  }

  private extractDateFromKey(key: string): Date | null {
    try {
      const dateStr = key.replace('backup_', '');
      return new Date(dateStr);
    } catch (error) {
      return null;
    }
  }

  public async exportToFile(): Promise<boolean> {
    try {
      const exportData: Record<string, any> = {};
      
      for (const key of BackupManager.MAIN_DATA_KEYS) {
        const data = await ElectronBridge.getData(key, null);
        if (data) {
          exportData[key] = data;
        }
      }
      
      if (Object.keys(exportData).length === 0) {
        console.error('❌ No data to export');
        return false;
      }

      console.log(`📤 Exporting ${Object.keys(exportData).length} data types`);

      const date = new Date().toISOString().split('T')[0];
      const filename = `enquetes_export_${date}.json`;
      const jsonData = JSON.stringify(exportData, null, 2);
      
      if (window.electronAPI && window.electronAPI.saveFileDialog) {
        const success = await window.electronAPI.saveFileDialog(filename, jsonData);
        if (success) {
          console.log(`✅ Export successful: ${filename}`);
        }
        return success;
      } else {
        // Fallback: téléchargement navigateur
        const blob = new Blob([jsonData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log(`✅ Export successful (browser download): ${filename}`);
        return true;
      }
    } catch (error) {
      console.error('❌ Error exporting to file:', error);
      return false;
    }
  }

  public async checkDataIntegrity(): Promise<boolean> {
    try {
      let isIntact = true;
      const checkedKeys: string[] = [];
      
      for (const key of BackupManager.MAIN_DATA_KEYS) {
        const data = await ElectronBridge.getData(key, null);
        
        if (!data) {
          console.warn(`⚠️ Data integrity check: No data found for key ${key}`);
          continue;
        }
        
        checkedKeys.push(key);
        
        if (key === APP_CONFIG.STORAGE_KEYS.ENQUETES || key === APP_CONFIG.STORAGE_KEYS.INSTRUCTIONS) {
          if (!Array.isArray(data)) {
            console.error(`❌ Data integrity check failed: ${key} is not an array`);
            isIntact = false;
          }
        } else if (key === APP_CONFIG.STORAGE_KEYS.ALERT_RULES) {
          if (!Array.isArray(data)) {
            console.error('❌ Data integrity check failed: Alert rules is not an array');
            isIntact = false;
          }
        } else if (key === APP_CONFIG.STORAGE_KEYS.CUSTOM_TAGS || key === APP_CONFIG.STORAGE_KEYS.AUDIENCE_RESULTATS) {
          if (typeof data !== 'object' || data === null) {
            console.error(`❌ Data integrity check failed: ${key} is not an object`);
            isIntact = false;
          }
        } else if (key === APP_CONFIG.STORAGE_KEYS.SAVE_HISTORY || key === APP_CONFIG.STORAGE_KEYS.AIR_MESURES) {
          if (!Array.isArray(data)) {
            console.error(`❌ Data integrity check failed: ${key} is not an array`);
            isIntact = false;
          }
        }
      }
      
      if (isIntact && checkedKeys.length > 0) {
        console.log(`✅ Data integrity check passed for ${checkedKeys.length} data types`);
      }
      
      return isIntact;
    } catch (error) {
      console.error('❌ Error checking data integrity:', error);
      return false;
    }
  }

  public scheduleIntegrityCheck(): void {
    this.integrityCheckTimerId = setInterval(() => {
      setTimeout(() => {
        this.checkAndRepairData();
      }, 10 * 60 * 1000); // 10 minutes après le démarrage de l'intervalle
    }, 7 * 24 * 60 * 60 * 1000); // Une fois par semaine
    
    console.log('⏰ Weekly integrity check scheduled');
  }
  
  private async checkAndRepairData(): Promise<void> {
    console.log('🔍 Running scheduled integrity check...');
    const isIntact = await this.checkDataIntegrity();
    if (!isIntact) {
      console.log('🔧 Data integrity issues detected, attempting auto-repair...');
      const backups = await this.listBackups();
      if (backups.length > 0) {
        const success = await this.restoreFromBackup(backups[0]);
        if (success) {
          console.log('✅ Auto-restored from latest backup due to data integrity issues');
        } else {
          console.error('❌ Failed to auto-restore from backup after data integrity issues');
        }
      } else {
        console.error('❌ No backups available to restore after data integrity issues');
      }
    }
  }
}

export const backupManager = new BackupManager();