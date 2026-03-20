const { contextBridge, ipcRenderer } = require('electron')
// Exposer les fonctions d'API protégées à votre application de rendu
contextBridge.exposeInMainWorld('electronAPI', {
  // API de base pour le stockage de données
  getData: (key, defaultValue) => ipcRenderer.invoke('getData', key, defaultValue),
  setData: (key, value) => ipcRenderer.invoke('setData', key, value),
  clearData: (key) => ipcRenderer.invoke('clearData', key),
  getAllKeys: () => ipcRenderer.invoke('getAllKeys'),

  // API pour les casiers judiciaires (B1)
  openFileDialog: (options) => ipcRenderer.invoke('dialog:openFile', options),
  saveCasierFile: (sourcePath, fileName) => ipcRenderer.invoke('casier:save', sourcePath, fileName),
  deleteCasierFile: (filePath) => ipcRenderer.invoke('casier:delete', filePath),
  openExternalFile: (filePath) => ipcRenderer.invoke('open:external', filePath),

  // API pour la gestion des fichiers de sauvegarde
  saveFile: (folder, filename, content) => ipcRenderer.invoke('saveFile', folder, filename, content),
  readFile: (folder, filename) => ipcRenderer.invoke('readFile', folder, filename),
  listFiles: (folder) => ipcRenderer.invoke('listFiles', folder),
  deleteFile: (folder, filename) => ipcRenderer.invoke('deleteFile', folder, filename),
  saveFileDialog: (defaultName, content) => ipcRenderer.invoke('saveFileDialog', defaultName, content),

  // APIS POUR DATA.JSON
  copyDataJson: (backupFileName) => ipcRenderer.invoke('copyDataJson', backupFileName),
  restoreDataJson: (backupFileName) => ipcRenderer.invoke('restoreDataJson', backupFileName),
  getDataJsonInfo: () => ipcRenderer.invoke('getDataJsonInfo'),
  compareWithDataJson: (backupFileName) => ipcRenderer.invoke('compareWithDataJson', backupFileName),
  listDataJsonBackups: () => ipcRenderer.invoke('listDataJsonBackups'),
  getBackupStats: () => ipcRenderer.invoke('getBackupStats'),
  cleanOldBackups: (keepCount) => ipcRenderer.invoke('cleanOldBackups', keepCount),

  // === APIS POUR DOCUMENTS AVEC CATÉGORIES ===
  saveDocuments: (enqueteNumero, files, category) =>
    ipcRenderer.invoke('documents:save-with-category', enqueteNumero, files, category),

  // === APIS POUR GESTION EXTERNE AVEC SUPPORT USESUBFOLDER ===
  copyToExternalPath: (enqueteNumero, externalPath, files, category, useSubfolder = true) =>
    ipcRenderer.invoke('documents:copy-to-external', enqueteNumero, externalPath, files, category, useSubfolder),

  validatePath: (pathToValidate) =>
    ipcRenderer.invoke('documents:validate-path', pathToValidate),

  selectFolder: () =>
    ipcRenderer.invoke('documents:select-folder'),

  openExternalFolder: (externalPath, enqueteNumero, useSubfolder = true) =>
    ipcRenderer.invoke('documents:open-external-folder', externalPath, enqueteNumero, useSubfolder),

  deleteFromExternalPath: (externalPath, enqueteNumero, cheminRelatif) =>
    ipcRenderer.invoke('documents:delete-from-external', externalPath, enqueteNumero, cheminRelatif),

  // === NOUVELLES APIS POUR SYNCHRONISATION ===
  syncDocuments: (enqueteNumero, externalPath, useSubfolder = true) =>
    ipcRenderer.invoke('documents:sync', enqueteNumero, externalPath, useSubfolder),

  scanForNewDocuments: (enqueteNumero, existingDocumentPaths) =>
    ipcRenderer.invoke('documents:scan-new', enqueteNumero, existingDocumentPaths),

  // === API DOCUMENTS EXISTANTES (RÉTROCOMPATIBILITÉ) ===
  deleteDocument: (enqueteNumero, cheminRelatif, externalPath, useSubfolder = true) =>
    ipcRenderer.invoke('documents:delete-with-external', enqueteNumero, cheminRelatif, externalPath, useSubfolder),

  openDocument: (enqueteNumero, cheminRelatif) =>
    ipcRenderer.invoke('documents:open', enqueteNumero, cheminRelatif),

  documentExists: (enqueteNumero, cheminRelatif) =>
    ipcRenderer.invoke('documents:exists', enqueteNumero, cheminRelatif),

  getDocumentSize: (enqueteNumero, cheminRelatif) =>
    ipcRenderer.invoke('documents:getSize', enqueteNumero, cheminRelatif),

  // API pour l'extraction de texte PDF
  extractPDFText: (buffer) => ipcRenderer.invoke('pdf:extractText', buffer),

  // API pour le scan et analyse des PDFs du chemin externe
  scanExternalPDFs: (externalPath, enqueteNumero, useSubfolder = true) =>
    ipcRenderer.invoke('documents:scan-external-pdfs', externalPath, enqueteNumero, useSubfolder),

  // ========================================================================
  // APIS POUR LA SYNCHRONISATION DES DONNÉES (DataSyncManager)
  // ========================================================================

  dataSync_checkAccess: () =>
    ipcRenderer.invoke('dataSync:checkAccess'),

  dataSync_pull: () =>
    ipcRenderer.invoke('dataSync:pull'),

  dataSync_push: (data, metadata) =>
    ipcRenderer.invoke('dataSync:push', data, metadata),

  // Crée un backup daté du fichier serveur avant chaque push.
  // filename : ex "app-data-backup-2026-03-09T14-30-00.000Z.json"
  // Si absent, repli sur l'ancien nom unique "app-data-backup.json" (rétrocompat).
  dataSync_backupServer: (filename) =>
    ipcRenderer.invoke('dataSync:backupServer', filename),

  // Supprime un fichier backup du dossier serveur (rotation).
  // Sécurité côté main : seuls les app-data-backup-*.json sont acceptés.
  dataSync_deleteServerBackup: (filename) =>
    ipcRenderer.invoke('dataSync:deleteServerBackup', filename),

  // Liste les fichiers app-data-backup-*.json présents sur le serveur,
  // triés du plus récent au plus ancien.
  dataSync_listServerBackups: () =>
    ipcRenderer.invoke('dataSync:listServerBackups'),

  // Lit un fichier backup serveur et retourne { data, metadata }.
  // Utilisé par la restauration depuis backup (SavePage).
  dataSync_readServerBackup: (filename) =>
    ipcRenderer.invoke('dataSync:readServerBackup', filename),

  getCurrentUser: () =>
    ipcRenderer.invoke('system:getCurrentUser'),

  // === MISE À JOUR DE L'APPLICATION ===
  checkAppUpdate: () =>
    ipcRenderer.invoke('app:checkUpdate'),

  applyAppUpdate: () =>
    ipcRenderer.invoke('app:applyUpdate'),
})
