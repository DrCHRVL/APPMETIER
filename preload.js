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

  // Configuration serveur (premier lancement)
  serverConfig_get: () =>
    ipcRenderer.invoke('serverConfig:get'),
  serverConfig_setup: (serverRootPath) =>
    ipcRenderer.invoke('serverConfig:setup', serverRootPath),
  serverConfig_reset: () =>
    ipcRenderer.invoke('serverConfig:reset'),

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

  // ========================================================================
  // APIS MULTI-CONTENTIEUX (users.json + sync par contentieux)
  // ========================================================================

  dataSync_pullUsersConfig: () =>
    ipcRenderer.invoke('dataSync:pullUsersConfig'),

  dataSync_pushUsersConfig: (config) =>
    ipcRenderer.invoke('dataSync:pushUsersConfig', config),

  dataSync_checkContentieuxAccess: (contentieuxId) =>
    ipcRenderer.invoke('dataSync:checkContentieuxAccess', contentieuxId),

  paths_getEffective: () =>
    ipcRenderer.invoke('paths:getEffective'),

  paths_migrateContentieux: (contentieuxId, oldPath, newPath) =>
    ipcRenderer.invoke('paths:migrateContentieux', contentieuxId, oldPath, newPath),

  paths_migrateGeneral: (oldPath, newPath) =>
    ipcRenderer.invoke('paths:migrateGeneral', oldPath, newPath),

  dataSync_pullContentieux: (contentieuxId) =>
    ipcRenderer.invoke('dataSync:pullContentieux', contentieuxId),

  dataSync_pushContentieux: (contentieuxId, data, metadata) =>
    ipcRenderer.invoke('dataSync:pushContentieux', contentieuxId, data, metadata),

  dataSync_backupContentieux: (contentieuxId, backupFilename) =>
    ipcRenderer.invoke('dataSync:backupContentieux', contentieuxId, backupFilename),

  // ========================================================================
  // HEARTBEAT, ÉVÉNEMENTS PARTAGÉS, JOURNAL D'AUDIT
  // ========================================================================

  writeHeartbeat: (username, heartbeat) =>
    ipcRenderer.invoke('heartbeat:write', username, heartbeat),

  removeHeartbeat: (username) =>
    ipcRenderer.invoke('heartbeat:remove', username),

  readAllHeartbeats: () =>
    ipcRenderer.invoke('heartbeat:readAll'),

  writeSharedEvent: (sharedEvent) =>
    ipcRenderer.invoke('sharedEvent:write', sharedEvent),

  cleanupSharedEvents: (ttlMs) =>
    ipcRenderer.invoke('sharedEvent:cleanup', ttlMs),

  startEventsWatcher: () =>
    ipcRenderer.invoke('sharedEvent:startWatcher'),

  onSharedEvent: (callback) =>
    ipcRenderer.on('sharedEvent:received', (event, data) => callback(data)),

  appendAuditLog: (entry, maxEntries) =>
    ipcRenderer.invoke('auditLog:append', entry, maxEntries),

  readAuditLog: () =>
    ipcRenderer.invoke('auditLog:read'),

  // === MISE À JOUR DE L'APPLICATION (GitHub) ===
  checkAppUpdate: () =>
    ipcRenderer.invoke('app:checkUpdate'),

  applyAppUpdate: () =>
    ipcRenderer.invoke('app:applyUpdate'),

  // === MISE À JOUR VIA RÉSEAU LOCAL ===
  lanUpdatePublish: (changelog) =>
    ipcRenderer.invoke('lanUpdate:publish', changelog),

  lanUpdatePublishFull: (changelog) =>
    ipcRenderer.invoke('lanUpdate:publishFull', changelog),

  lanUpdateCheck: () =>
    ipcRenderer.invoke('lanUpdate:check'),

  lanUpdateApply: () =>
    ipcRenderer.invoke('lanUpdate:apply'),

  lanUpdateRollback: () =>
    ipcRenderer.invoke('lanUpdate:rollback'),

  lanUpdateGetJustUpdated: () =>
    ipcRenderer.invoke('lanUpdate:getJustUpdated'),

  lanUpdateGetLocalVersion: () =>
    ipcRenderer.invoke('lanUpdate:getLocalVersion'),

  lanUpdateVerifyIntegrity: () =>
    ipcRenderer.invoke('lanUpdate:verifyIntegrity'),

  // Listener pour la progression de la publication (build + obfuscation)
  onPublishProgress: (callback) =>
    ipcRenderer.on('publish-progress', (event, data) => callback(data)),
})
