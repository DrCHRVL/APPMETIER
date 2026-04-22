const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const http = require('http')
const https = require('https')
const { exec, execSync } = require('child_process')
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, powerMonitor } = require('electron')

// ── MODE PRODUCTION : détecte si l'app tourne en mode build (standalone) ──
const IS_PRODUCTION = fs.existsSync(path.join(__dirname, '.next', 'BUILD_ID'))
  && !fs.existsSync(path.join(__dirname, '.dev-mode'))
// Ajout pour l'extraction PDF
const pdfParse = require('pdf-parse')
const tesseract = require('tesseract.js')
console.log('User Data Path:', app.getPath('userData'));

// ── FILET DE SÉCURITÉ : empêche le crash sur erreurs non gérées (ex. ECONNRESET au retour de veille) ──
process.on('uncaughtException', (error) => {
  console.error('⚠️ Uncaught exception interceptée :', error.message)
  // Les erreurs réseau liées au file watcher sont récupérables, on ne crash pas
  if (error.message && (error.message.includes('ECONNRESET') || error.message.includes('EPERM') || error.message.includes('ENETUNREACH'))) {
    console.log('🔄 Erreur réseau récupérable, l\'app continue...')
    return
  }
  // Pour les erreurs vraiment critiques, on affiche une alerte
  console.error('❌ Erreur critique non gérée :', error.stack)
})

// Création des dossiers pour les données
const dataFolder = path.join(__dirname, 'data')
const casiersFolder = path.join(dataFolder, 'casiers')
const backupsFolder = path.join(dataFolder, 'backups')
const documentsEnquetesFolder = path.join(dataFolder, 'documentenquete')
const userDataPath = path.join(dataFolder, 'data.json')

// ── CONFIGURATION SERVEUR (configurable au premier lancement) ──
const SERVER_CONFIG_PATH = path.join(dataFolder, 'server-config.json')
// Fallback historique (pour compatibilité avec les installations existantes)
const LEGACY_SERVER_PATH = "P:\\TGI\\Parquet\\P17 - STUP - CRIM ORG\\GESTION DE SERVICE\\10_App METIER"

/**
 * Lit le chemin serveur racine depuis server-config.json.
 * Retourne null si pas encore configuré (premier lancement).
 */
function getConfiguredServerPath() {
  try {
    if (fs.existsSync(SERVER_CONFIG_PATH)) {
      const config = JSON.parse(fs.readFileSync(SERVER_CONFIG_PATH, 'utf8'))
      if (config.serverRootPath) return config.serverRootPath
    }
  } catch {}
  return null
}

/**
 * Sauvegarde le chemin serveur racine dans server-config.json.
 */
function saveServerConfig(serverRootPath) {
  if (!fs.existsSync(dataFolder)) fs.mkdirSync(dataFolder, { recursive: true })
  const config = { serverRootPath, configuredAt: new Date().toISOString() }
  fs.writeFileSync(SERVER_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
}

/**
 * Retourne le chemin serveur racine effectif :
 * 1. server-config.json (configuré au premier lancement)
 * 2. Fallback legacy (installations existantes avec le chemin en dur)
 */
function getServerRootPath() {
  return getConfiguredServerPath() || LEGACY_SERVER_PATH
}

// Chemin serveur commun — résolu dynamiquement
const COMMON_SERVER_PATH = getServerRootPath()

// ── MULTI-CONTENTIEUX : chemin racine et dossiers par contentieux ──
// Note: ces chemins sont recalculés si le serveur est reconfiguré (via getServerRootPath())
let MULTI_CONTENTIEUX_ROOT = COMMON_SERVER_PATH
let USERS_CONFIG_PATH = path.join(COMMON_SERVER_PATH, 'users.json')

// Mapping des contentieux vers leurs dossiers serveur
function getDefaultContentieuxFolders() {
  const root = getServerRootPath()
  return {
    crimorg: path.join(root, 'crimorg'),
    ecofi:   path.join(root, 'ecofi'),
    enviro:  path.join(root, 'enviro'),
  }
}
let CONTENTIEUX_FOLDERS = getDefaultContentieuxFolders()

/** Recharge les chemins après reconfiguration du serveur */
function reloadServerPaths() {
  const root = getServerRootPath()
  MULTI_CONTENTIEUX_ROOT = root
  USERS_CONFIG_PATH = path.join(root, 'users.json')
  CONTENTIEUX_FOLDERS = getDefaultContentieuxFolders()
}

/**
 * Retourne le chemin du dossier d'un contentieux, en le créant si nécessaire.
 * Priorité : serverPaths.contentieux[id] dans users.json > CONTENTIEUX_FOLDERS hardcodé
 */
function getContentieuxFolder(contentieuxId) {
  let folder = CONTENTIEUX_FOLDERS[contentieuxId]
  try {
    if (fs.existsSync(USERS_CONFIG_PATH)) {
      const config = JSON.parse(fs.readFileSync(USERS_CONFIG_PATH, 'utf8'))
      if (config.serverPaths?.contentieux?.[contentieuxId]) {
        folder = config.serverPaths.contentieux[contentieuxId]
      }
    }
  } catch {}
  if (!folder) throw new Error(`Contentieux inconnu: ${contentieuxId}`)
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true })
  }
  return folder
}

/**
 * Retourne le chemin du dossier backups d'un contentieux.
 */
function getContentieuxBackupFolder(contentieuxId) {
  const backupDir = path.join(getContentieuxFolder(contentieuxId), 'backups')
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true })
  }
  return backupDir
}
// Création des dossiers s'ils n'existent pas
if (!fs.existsSync(dataFolder)) {
  fs.mkdirSync(dataFolder, { recursive: true })
}
if (!fs.existsSync(casiersFolder)) {
  fs.mkdirSync(casiersFolder, { recursive: true })
}
if (!fs.existsSync(backupsFolder)) {
  fs.mkdirSync(backupsFolder, { recursive: true })
}
if (!fs.existsSync(documentsEnquetesFolder)) {
  fs.mkdirSync(documentsEnquetesFolder, { recursive: true })
}
// Cache mémoire pour éviter les lectures disque répétées
let _dataCache = null

// Fonction pour charger toutes les données (avec cache mémoire)
function loadData() {
  if (_dataCache !== null) return _dataCache
  try {
    _dataCache = fs.existsSync(userDataPath)
      ? JSON.parse(fs.readFileSync(userDataPath, 'utf8'))
      : {}
    return _dataCache
  } catch (error) {
    console.error('Erreur de chargement:', error)
    return {}
  }
}
// Fonction pour sauvegarder toutes les données (invalide le cache)
function saveData(data) {
  try {
    fs.writeFileSync(userDataPath, JSON.stringify(data, null, 2))
    _dataCache = data
    return true
  } catch (error) {
    console.error('Erreur de sauvegarde:', error)
    _dataCache = null
    return false
  }
}
// Fonction pour nettoyer le nom de fichier
function sanitizeFileName(fileName) {
  return fileName.replace(/[<>:"/\\|?*]/g, '_')
}
// Fonction pour obtenir le type de fichier basé sur l'extension
function getFileType(extension) {
  const ext = extension.toLowerCase()

  if (ext === '.pdf') return 'pdf'
  if (['.doc', '.docx'].includes(ext)) return 'doc'
  if (ext === '.odt') return 'odt'
  if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext)) return 'image'
  if (['.html', '.htm'].includes(ext)) return 'html'
  if (ext === '.msg') return 'msg'
  if (ext === '.txt') return 'txt'

  return 'autre'
}
// Fonction pour construire le chemin externe selon la configuration
function buildExternalPath(externalBasePath, enqueteNumero, useSubfolder = true, category = '') {
  const sanitizedEnqueteNumero = sanitizeFileName(enqueteNumero)

  let basePath
  if (useSubfolder) {
    // Comportement par défaut : [externalPath]/[enqueteNumero]/[category]
    basePath = path.join(externalBasePath, sanitizedEnqueteNumero)
  } else {
    // Nouveau comportement : [externalPath]/[category]
    basePath = externalBasePath
  }

  return category ? path.join(basePath, category) : basePath
}
// Fonction utilitaire pour lister récursivement les fichiers dans un dossier
function listFilesRecursively(dir, relativePath = '') {
  try {
    if (!fs.existsSync(dir)) {
      return [];
    }
    let results = [];
    const list = fs.readdirSync(dir);

    for (const file of list) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);

      if (stat && stat.isDirectory()) {
        // Récursivement lister les fichiers dans les sous-dossiers
        const newRelativePath = relativePath ? path.join(relativePath, file) : file;
        const subResults = listFilesRecursively(filePath, newRelativePath);
        results = results.concat(subResults);
      } else {
        const fileRelativePath = relativePath ? path.join(relativePath, file) : file;
        results.push(fileRelativePath);
      }
    }

    return results;
  } catch (error) {
    console.error(`Erreur lors du listage des fichiers dans ${dir}:`, error);
    return [];
  }
}
let mainWindow;
function createWindow() {
   mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.resolve(__dirname, 'preload.js'),
      webSecurity: true,
      webviewTag: true
    }
  })
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["script-src 'self' 'unsafe-eval' 'unsafe-inline' http://localhost:3000"]
      }
    })
  })

  mainWindow.once('ready-to-show', () => {
    console.log('Fenêtre prête à être affichée')
    mainWindow.show()
  })
  mainWindow.webContents.on('did-fail-load', () => {
    setTimeout(() => {
      mainWindow.loadURL('http://localhost:3000')
    }, 1000)
  })
  // DevTools : uniquement en mode développement
  if (!IS_PRODUCTION) {
    mainWindow.webContents.openDevTools()
  } else {
    // En production : bloquer F12 / Ctrl+Shift+I
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F12' ||
          (input.control && input.shift && (input.key === 'I' || input.key === 'i')) ||
          (input.control && input.shift && (input.key === 'J' || input.key === 'j'))) {
        event.preventDefault()
      }
    })
    // Supprimer le menu par défaut en production
    Menu.setApplicationMenu(null)
  }
  mainWindow.loadURL('http://localhost:3000')
}
// ── UTILITAIRES RÉSEAU (niveau module pour accès depuis watcher et powerMonitor) ──
function getGeneralServerPath() {
  try {
    if (fs.existsSync(USERS_CONFIG_PATH)) {
      const config = JSON.parse(fs.readFileSync(USERS_CONFIG_PATH, 'utf8'))
      if (config.serverPaths?.general) {
        return config.serverPaths.general
      }
    }
  } catch {}
  return COMMON_SERVER_PATH
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
  return dirPath
}

// ── FILE WATCHER pour événements partagés (niveau module pour accès depuis powerMonitor) ──
let eventsWatcher = null
let eventsWatcherRestartTimeout = null

function stopEventsWatcher() {
  if (eventsWatcher) {
    try { eventsWatcher.close() } catch {}
    eventsWatcher = null
  }
  if (eventsWatcherRestartTimeout) {
    clearTimeout(eventsWatcherRestartTimeout)
    eventsWatcherRestartTimeout = null
  }
}

function startEventsWatcher() {
  try {
    const dir = ensureDir(path.join(getGeneralServerPath(), 'events'))
    stopEventsWatcher()
    eventsWatcher = fs.watch(dir, (eventType, filename) => {
      if (eventType === 'rename' && filename && filename.endsWith('.json')) {
        const filePath = path.join(dir, filename)
        try {
          if (fs.existsSync(filePath)) {
            const content = JSON.parse(fs.readFileSync(filePath, 'utf8'))
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('sharedEvent:received', content)
            }
          }
        } catch {}
      }
    })
    // Handler d'erreur pour éviter le crash (ex. ECONNRESET au retour de veille)
    eventsWatcher.on('error', (error) => {
      console.error('⚠️ Events watcher error:', error.message)
      stopEventsWatcher()
      // Redémarrage automatique après 5 secondes
      eventsWatcherRestartTimeout = setTimeout(() => {
        console.log('🔄 Tentative de redémarrage du watcher...')
        startEventsWatcher()
      }, 5000)
    })
    console.log('✅ Events watcher démarré sur', dir)
  } catch (error) {
    console.error('❌ Events watcher error:', error.message)
    // Retry après 10 secondes si le dossier réseau n'est pas accessible
    eventsWatcherRestartTimeout = setTimeout(() => {
      console.log('🔄 Retry démarrage du watcher...')
      startEventsWatcher()
    }, 10000)
  }
}

// Configuration des gestionnaires IPC pour l'API Electron
function setupIpcHandlers() {
  // === GESTIONNAIRES DE BASE POUR LES DONNÉES ===
  ipcMain.handle('getData', async (event, key, defaultValue) => {
    const data = loadData()
    return key in data ? data[key] : defaultValue
  })
  ipcMain.handle('setData', async (event, key, value) => {
    const data = loadData()
    data[key] = value
    return saveData(data)
  })
  ipcMain.handle('clearData', async (event, key) => {
    const data = loadData()
    if (key in data) {
      delete data[key]
      return saveData(data)
    }
    return true
  })
  ipcMain.handle('getAllKeys', async () => {
    const data = loadData()
    return Object.keys(data)
  })
  // === GESTIONNAIRES EXISTANTS POUR LES FICHIERS ===

  // Gestionnaire pour ouvrir une boîte de dialogue de sélection de fichier
  ipcMain.handle('dialog:openFile', async (event, options) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(options)
    if (canceled) {
      return null
    }
    return filePaths[0]
  })
  // Gestionnaire pour sauvegarder un casier judiciaire (B1)
  ipcMain.handle('casier:save', async (event, sourcePath, fileName) => {
    try {
      const targetPath = path.join(casiersFolder, fileName)
      fs.copyFileSync(sourcePath, targetPath)
      console.log(`Casier sauvegardé: ${targetPath}`)
      return targetPath
    } catch (error) {
      console.error('Erreur lors de la sauvegarde du casier:', error)
      throw error
    }
  })
  // Gestionnaire pour supprimer un fichier casier
  ipcMain.handle('casier:delete', async (event, filePath) => {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
        console.log(`Casier supprimé: ${filePath}`)
        return true
      }
      return false
    } catch (error) {
      console.error('Erreur lors de la suppression du casier:', error)
      throw error
    }
  })
  // Gestionnaire pour ouvrir un fichier avec l'application par défaut
  ipcMain.handle('open:external', async (event, filePath) => {
    try {
      if (fs.existsSync(filePath)) {
        const result = await shell.openPath(filePath)
        if (result !== "") {
          console.error('Erreur lors de l\'ouverture du fichier:', result)
          return false
        }
        return true
      }
      return false
    } catch (error) {
      console.error('Erreur lors de l\'ouverture du fichier:', error)
      return false
    }
  })
  // === GESTIONNAIRES POUR LES DOCUMENTS (NE PAS TOUCHER - SYNC DOCUMENTS) ===

  // === SYNCHRONISATION DES DOCUMENTS ===
  ipcMain.handle('documents:sync', async (event, enqueteNumero, externalPath, useSubfolder = true) => {
    try {
      const result = {
        totalInternal: 0,
        totalExternal: 0,
        addedToInternal: [],
        addedToExternal: [],
        errors: [],
        externalAccessible: true
      };
      if (!externalPath) {
        result.errors.push('Aucun chemin externe configuré');
        result.externalAccessible = false;
        return result;
      }
      // Vérifier d'abord si le chemin externe est accessible
      try {
        const isAccessible = fs.existsSync(externalPath);
        if (!isAccessible) {
          result.errors.push('Chemin externe inaccessible actuellement');
          result.externalAccessible = false;
          return result;
        }
      } catch (error) {
        console.error('Erreur lors de la vérification du chemin externe:', error);
        result.errors.push(`Erreur d'accès au chemin externe: ${error.message}`);
        result.externalAccessible = false;
        return result;
      }
      const enqueteFolderName = sanitizeFileName(enqueteNumero);
      const internalEnqueteFolder = path.join(documentsEnquetesFolder, enqueteFolderName);
      const externalEnqueteFolder = buildExternalPath(externalPath, enqueteNumero, useSubfolder);
      // Vérifier si les dossiers existent
      if (!fs.existsSync(internalEnqueteFolder)) {
        fs.mkdirSync(internalEnqueteFolder, { recursive: true });
      }

      try {
        if (!fs.existsSync(externalEnqueteFolder)) {
          fs.mkdirSync(externalEnqueteFolder, { recursive: true });
        }
      } catch (error) {
        console.error('Erreur lors de la création du dossier externe:', error);
        result.errors.push(`Erreur création dossier externe: ${error.message}`);
        result.externalAccessible = false;
        return result;
      }
      // Liste des catégories
      const categories = ['Geoloc', 'Ecoutes', 'Actes', 'PV'];
      // Pour chaque catégorie
      for (const category of categories) {
        const internalCategoryFolder = path.join(internalEnqueteFolder, category);
        const externalCategoryFolder = path.join(externalEnqueteFolder, category);
        // Créer les dossiers s'ils n'existent pas
        if (!fs.existsSync(internalCategoryFolder)) {
          fs.mkdirSync(internalCategoryFolder, { recursive: true });
        }

        try {
          if (!fs.existsSync(externalCategoryFolder)) {
            fs.mkdirSync(externalCategoryFolder, { recursive: true });
          }
        } catch (error) {
          console.error(`Erreur lors de la création du dossier externe pour ${category}:`, error);
          result.errors.push(`Erreur création dossier externe pour ${category}: ${error.message}`);
          continue; // Continuer avec les autres catégories
        }
        // Lister les fichiers dans le dossier interne
        const internalFiles = fs.readdirSync(internalCategoryFolder);
        result.totalInternal += internalFiles.length;
        try {
          // Lister les fichiers dans le dossier externe
          const externalFiles = fs.readdirSync(externalCategoryFolder);
          result.totalExternal += externalFiles.length;
          // Trouver les fichiers qui sont dans le dossier externe mais pas dans l'interne
          for (const externalFile of externalFiles) {
            if (!internalFiles.includes(externalFile)) {
              try {
                const sourcePath = path.join(externalCategoryFolder, externalFile);
                const destPath = path.join(internalCategoryFolder, externalFile);

                fs.copyFileSync(sourcePath, destPath);
                result.addedToInternal.push(`${category}/${externalFile}`);
              } catch (error) {
                result.errors.push(`Erreur copie de ${category}/${externalFile} vers interne: ${error.message}`);
              }
            }
          }
          // Trouver les fichiers qui sont dans le dossier interne mais pas dans l'externe
          for (const internalFile of internalFiles) {
            if (!externalFiles.includes(internalFile)) {
              try {
                const sourcePath = path.join(internalCategoryFolder, internalFile);
                const destPath = path.join(externalCategoryFolder, internalFile);

                fs.copyFileSync(sourcePath, destPath);
                result.addedToExternal.push(`${category}/${internalFile}`);
              } catch (error) {
                result.errors.push(`Erreur copie de ${category}/${internalFile} vers externe: ${error.message}`);
              }
            }
          }
        } catch (error) {
          console.error(`Erreur lors de l'accès au dossier externe pour ${category}:`, error);
          result.errors.push(`Erreur accès dossier externe pour ${category}: ${error.message}`);
          result.externalAccessible = false;
        }
      }
      return result;
    } catch (error) {
      console.error('Erreur lors de la synchronisation des documents:', error);
      return {
        totalInternal: 0,
        totalExternal: 0,
        addedToInternal: [],
        addedToExternal: [],
        errors: [`Erreur: ${error.message}`],
        externalAccessible: false
      };
    }
  });
  // === SCAN DE NOUVEAUX DOCUMENTS ===
  ipcMain.handle('documents:scan-new', async (event, enqueteNumero, existingDocumentPaths) => {
    try {
      const enqueteFolderName = sanitizeFileName(enqueteNumero);
      const enqueteFolder = path.join(documentsEnquetesFolder, enqueteFolderName);

      const result = {
        newDocuments: [],
        errors: []
      };
      if (!fs.existsSync(enqueteFolder)) {
        return result;
      }
      // Liste des catégories
      const categories = ['Geoloc', 'Ecoutes', 'Actes', 'PV'];

      for (const category of categories) {
        const categoryFolder = path.join(enqueteFolder, category);

        if (!fs.existsSync(categoryFolder)) {
          // Créer le dossier s'il n'existe pas
          fs.mkdirSync(categoryFolder, { recursive: true });
          continue;
        }

        const files = fs.readdirSync(categoryFolder);

        for (const file of files) {
          const relativePath = `${category}/${file}`;

          // Vérifier si le fichier est déjà connu
          if (!existingDocumentPaths.includes(relativePath)) {
            const filePath = path.join(categoryFolder, file);
            const stats = fs.statSync(filePath);
            const extension = path.extname(file).toLowerCase();

            result.newDocuments.push({
              id: Date.now() + Math.random(),
              nom: file,
              nomOriginal: file,
              extension: extension,
              taille: stats.size,
              dateAjout: new Date().toISOString(),
              cheminRelatif: relativePath,
              type: getFileType(extension)
            });
          }
        }
      }

      return result;
    } catch (error) {
      console.error('Erreur lors de la recherche de nouveaux documents:', error);
      return {
        newDocuments: [],
        errors: [`Erreur: ${error.message}`]
      };
    }
  });
  // === VALIDATION DE CHEMIN ===
  ipcMain.handle('documents:validate-path', async (event, pathToValidate) => {
    try {
      if (!pathToValidate || pathToValidate.trim() === '') {
        return false;
      }

      // Vérifier si le chemin existe
      if (!fs.existsSync(pathToValidate)) {
        return false;
      }

      // Vérifier si c'est bien un dossier
      const stats = fs.statSync(pathToValidate);
      if (!stats.isDirectory()) {
        return false;
      }

      // Tester l'écriture avec un fichier temporaire
      try {
        const testFile = path.join(pathToValidate, `.write-test-${Date.now()}.tmp`);
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        return true;
      } catch (error) {
        console.error('Erreur test écriture:', error);
        return false;
      }
    } catch (error) {
      console.error('Erreur validation chemin:', error);
      return false;
    }
  });
  // === SÉLECTION DE DOSSIER ===
  ipcMain.handle('documents:select-folder', async (event) => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Sélectionner le dossier de sauvegarde externe'
      });

      return result.canceled ? null : result.filePaths[0];
    } catch (error) {
      console.error('Erreur sélection dossier:', error);
      return null;
    }
  });
  // === OUVERTURE DOSSIER EXTERNE ===
  ipcMain.handle('documents:open-external-folder', async (event, externalPath, enqueteNumero, useSubfolder = true) => {
    try {
      if (!externalPath) {
        return false;
      }

      // Vérifier si le chemin externe est accessible
      if (!fs.existsSync(externalPath)) {
        console.error('Chemin externe inaccessible:', externalPath);
        return false;
      }

      const folderPath = buildExternalPath(externalPath, enqueteNumero, useSubfolder);

      // Créer le dossier s'il n'existe pas
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });

        // Créer les sous-dossiers de catégories
        const categories = ['Geoloc', 'Ecoutes', 'Actes', 'PV'];
        for (const category of categories) {
          const categoryPath = path.join(folderPath, category);
          fs.mkdirSync(categoryPath, { recursive: true });
        }
      }

      // Ouvrir dans l'explorateur
      const result = await shell.openPath(folderPath);
      return result === ""; // openPath retourne "" en cas de succès
    } catch (error) {
      console.error('Erreur ouverture dossier externe:', error);
      return false;
    }
  });
  // === SAUVEGARDE DOCUMENTS AVEC CATÉGORIE ===
  ipcMain.handle('documents:save-with-category', async (event, enqueteNumero, files, category = 'general') => {
    try {
      const enqueteFolderName = sanitizeFileName(enqueteNumero);
      const enqueteFolder = path.join(documentsEnquetesFolder, enqueteFolderName);

      // Créer le dossier de l'enquête s'il n'existe pas
      if (!fs.existsSync(enqueteFolder)) {
        fs.mkdirSync(enqueteFolder, { recursive: true });
      }

      // Créer le sous-dossier de catégorie
      const categoryFolder = path.join(enqueteFolder, category);
      if (!fs.existsSync(categoryFolder)) {
        fs.mkdirSync(categoryFolder, { recursive: true });
      }

      const savedFiles = [];

      for (const file of files) {
        const originalName = file.name;
        const extension = path.extname(originalName);
        const baseName = path.basename(originalName, extension);
        const sanitizedBaseName = sanitizeFileName(baseName);

        let fileName = `${sanitizedBaseName}${extension}`;
        let counter = 1;
        while (fs.existsSync(path.join(categoryFolder, fileName))) {
          fileName = `${sanitizedBaseName}_${counter}${extension}`;
          counter++;
        }

        const destinationPath = path.join(categoryFolder, fileName);
        const buffer = Buffer.from(file.arrayBuffer);
        fs.writeFileSync(destinationPath, buffer);

        const stats = fs.statSync(destinationPath);

        savedFiles.push({
          id: Date.now() + Math.random(),
          nom: fileName,
          nomOriginal: originalName,
          extension: extension,
          taille: stats.size,
          dateAjout: new Date().toISOString(),
          cheminRelatif: `${category}/${fileName}`,
          type: getFileType(extension)
        });
      }

      return savedFiles;
    } catch (error) {
      console.error('Erreur lors de la sauvegarde des documents avec catégorie:', error);
      return [];
    }
  });
  // === COPIE VERS CHEMIN EXTERNE ===
  ipcMain.handle('documents:copy-to-external', async (event, enqueteNumero, externalPath, files, category, useSubfolder = true) => {
    try {
      // Vérifier si le chemin externe est accessible
      if (!externalPath || !fs.existsSync(externalPath)) {
        console.error('Chemin externe inaccessible:', externalPath);
        return false;
      }

      // Construire le chemin selon la configuration
      const externalCategoryDir = buildExternalPath(externalPath, enqueteNumero, useSubfolder, category);

      // Créer les dossiers nécessaires
      try {
        if (!fs.existsSync(externalCategoryDir)) {
          fs.mkdirSync(externalCategoryDir, { recursive: true });
        }
      } catch (error) {
        console.error('Erreur création dossier externe:', error);
        return false;
      }

      // Copier chaque fichier
      for (const file of files) {
        try {
          const sourceFile = path.join(documentsEnquetesFolder, sanitizeFileName(enqueteNumero), file.cheminRelatif);
          const targetFile = path.join(externalCategoryDir, file.nomOriginal);

          if (fs.existsSync(sourceFile)) {
            fs.copyFileSync(sourceFile, targetFile);
          }
        } catch (error) {
          console.error(`Erreur copie fichier ${file.nom} vers externe:`, error);
          // Continue avec les autres fichiers
        }
      }

      return true;
    } catch (error) {
      console.error('Erreur copie externe:', error);
      return false;
    }
  });
  // === SUPPRESSION DOCUMENT (INTERNE + EXTERNE) ===
  ipcMain.handle('documents:delete-with-external', async (event, enqueteNumero, cheminRelatif, externalPath = null, useSubfolder = true) => {
    try {
      // Suppression interne
      const enqueteFolderName = sanitizeFileName(enqueteNumero);
      const enqueteFolder = path.join(documentsEnquetesFolder, enqueteFolderName);
      const filePath = path.join(enqueteFolder, cheminRelatif);

      let internalSuccess = false;
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        internalSuccess = true;
      }

      // Suppression externe si configurée
      if (externalPath) {
        try {
          // Extraire la catégorie et le nom du fichier du chemin relatif
          const pathParts = cheminRelatif.split('/');
          const category = pathParts.length > 1 ? pathParts[0] : '';
          const fileName = pathParts[pathParts.length - 1];

          const externalDir = buildExternalPath(externalPath, enqueteNumero, useSubfolder, category);
          const externalFilePath = path.join(externalDir, fileName);

          if (fs.existsSync(externalFilePath)) {
            fs.unlinkSync(externalFilePath);
          }
        } catch (error) {
          console.warn('Erreur suppression externe (non bloquante):', error);
          // Ne pas bloquer même si la suppression externe échoue
        }
      }

      return internalSuccess;
    } catch (error) {
      console.error('Erreur lors de la suppression du document:', error);
      return false;
    }
  });
  // === OUVERTURE DE DOCUMENT ===
  ipcMain.handle('documents:open', async (event, enqueteNumero, cheminRelatif) => {
    try {
      const enqueteFolderName = sanitizeFileName(enqueteNumero);
      const enqueteFolder = path.join(documentsEnquetesFolder, enqueteFolderName);
      const filePath = path.join(enqueteFolder, cheminRelatif);

      if (fs.existsSync(filePath)) {
        const result = await shell.openPath(filePath);
        if (result !== "") {
          console.error('Erreur lors de l\'ouverture du document:', result);
          return false;
        }
        return true;
      }
      return false;
    } catch (error) {
      console.error('Erreur lors de l\'ouverture du document:', error);
      return false;
    }
  });
  // === VÉRIFICATION D'EXISTENCE DE DOCUMENT ===
  ipcMain.handle('documents:exists', async (event, enqueteNumero, cheminRelatif) => {
    try {
      const enqueteFolderName = sanitizeFileName(enqueteNumero);
      const enqueteFolder = path.join(documentsEnquetesFolder, enqueteFolderName);
      const filePath = path.join(enqueteFolder, cheminRelatif);

      return fs.existsSync(filePath);
    } catch (error) {
      console.error('Erreur lors de la vérification du document:', error);
      return false;
    }
  });
  // === OBTENTION DE LA TAILLE DU DOCUMENT ===
  ipcMain.handle('documents:getSize', async (event, enqueteNumero, cheminRelatif) => {
    try {
      const enqueteFolderName = sanitizeFileName(enqueteNumero);
      const enqueteFolder = path.join(documentsEnquetesFolder, enqueteFolderName);
      const filePath = path.join(enqueteFolder, cheminRelatif);

      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        return stats.size;
      }
      return 0;
    } catch (error) {
      console.error('Erreur lors de l\'obtention de la taille:', error);
      return 0;
    }
  });
  // === GESTIONNAIRES POUR LA GESTION DES FICHIERS DE SAUVEGARDE ===

  ipcMain.handle('readFile', async (event, folder, filename) => {
    try {
      let targetFolder;

      if (folder === 'backups') {
        targetFolder = backupsFolder;
      } else {
        targetFolder = path.join(dataFolder, folder);
      }

      const filePath = path.join(targetFolder, filename);
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf8');
      }
      return null;
    } catch (error) {
      console.error('Erreur lors de la lecture du fichier:', error);
      return null;
    }
  });
  ipcMain.handle('listFiles', async (event, folder) => {
    try {
      let targetFolder;

      if (folder === 'backups') {
        targetFolder = backupsFolder;
      } else {
        targetFolder = path.join(dataFolder, folder);
      }

      if (fs.existsSync(targetFolder)) {
        return fs.readdirSync(targetFolder);
      }
      return [];
    } catch (error) {
      console.error('Erreur lors du listage des fichiers:', error);
      return [];
    }
  });
  ipcMain.handle('deleteFile', async (event, folder, filename) => {
    try {
      let targetFolder;

      if (folder === 'backups') {
        targetFolder = backupsFolder;
      } else {
        targetFolder = path.join(dataFolder, folder);
      }

      const filePath = path.join(targetFolder, filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Erreur lors de la suppression du fichier:', error);
      return false;
    }
  });
  ipcMain.handle('saveFile', async (event, folder, filename, content) => {
    try {
      let targetFolder;

      if (folder === 'backups') {
        targetFolder = backupsFolder;
      } else {
        targetFolder = path.join(dataFolder, folder);
        if (!fs.existsSync(targetFolder)) {
          fs.mkdirSync(targetFolder, { recursive: true });
        }
      }

      const filePath = path.join(targetFolder, filename);
      fs.writeFileSync(filePath, content, 'utf8');
      return true;
    } catch (error) {
      console.error('Erreur lors de l\'enregistrement du fichier:', error);
      return false;
    }
  });
  ipcMain.handle('saveFileDialog', async (event, defaultName, content) => {
    try {
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Enregistrer la sauvegarde',
        defaultPath: path.join(app.getPath('documents'), defaultName),
        filters: [
          { name: 'JSON Files', extensions: ['json'] }
        ]
      });

      if (!canceled && filePath) {
        fs.writeFileSync(filePath, content, 'utf8');
        return true;
      }
      return false;
    } catch (error) {
      console.error('Erreur lors de la sauvegarde via dialogue:', error);
      return false;
    }
  });
  // Handler pour copier data.json vers le dossier backups
  ipcMain.handle('copyDataJson', async (event, backupFileName) => {
    try {
      // Vérifier que data.json existe
      if (!fs.existsSync(userDataPath)) {
        console.error('❌ data.json n\'existe pas');
        return false;
      }
      // Créer le chemin complet pour la sauvegarde
      const backupPath = path.join(backupsFolder, backupFileName);

      // Copier le fichier
      fs.copyFileSync(userDataPath, backupPath);

      console.log(`✅ data.json copié vers ${backupFileName}`);
      return true;
    } catch (error) {
      console.error('❌ Erreur lors de la copie de data.json:', error);
      return false;
    }
  });
  // Handler pour restaurer data.json depuis un backup
  ipcMain.handle('restoreDataJson', async (event, backupFileName) => {
    try {
      const backupPath = path.join(backupsFolder, backupFileName);

      // Vérifier que le backup existe
      if (!fs.existsSync(backupPath)) {
        console.error(`❌ Le backup ${backupFileName} n'existe pas`);
        return false;
      }
      // Créer une sauvegarde de sécurité du data.json actuel
      if (fs.existsSync(userDataPath)) {
        const securityBackupPath = path.join(
          backupsFolder,
          `data_before_restore_${Date.now()}.json`
        );
        fs.copyFileSync(userDataPath, securityBackupPath);
      }
      // Restaurer depuis le backup
      fs.copyFileSync(backupPath, userDataPath);
      _dataCache = null // Invalider le cache après restauration

      console.log(`✅ data.json restauré depuis ${backupFileName}`);
      return true;
    } catch (error) {
      console.error('❌ Erreur lors de la restauration de data.json:', error);
      return false;
    }
  });
  // Handler pour obtenir les informations sur data.json
  ipcMain.handle('getDataJsonInfo', async () => {
    try {
      if (!fs.existsSync(userDataPath)) {
        return null;
      }
      const stats = fs.statSync(userDataPath);

      return {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        path: userDataPath
      };
    } catch (error) {
      console.error('❌ Erreur lors de la récupération des infos de data.json:', error);
      return null;
    }
  });
  // Handler pour comparer data.json avec un backup
  ipcMain.handle('compareWithDataJson', async (event, backupFileName) => {
    try {
      const backupPath = path.join(backupsFolder, backupFileName);

      if (!fs.existsSync(userDataPath) || !fs.existsSync(backupPath)) {
        return null;
      }
      const currentStats = fs.statSync(userDataPath);
      const backupStats = fs.statSync(backupPath);

      return {
        currentSize: currentStats.size,
        backupSize: backupStats.size,
        sizeDifference: currentStats.size - backupStats.size,
        currentModified: currentStats.mtime,
        backupModified: backupStats.mtime
      };
    } catch (error) {
      console.error('❌ Erreur lors de la comparaison:', error);
      return null;
    }
  });
  // Handler pour lister tous les backups de data.json
  ipcMain.handle('listDataJsonBackups', async () => {
    try {
      if (!fs.existsSync(backupsFolder)) {
        return [];
      }
      const files = fs.readdirSync(backupsFolder);
      const dataBackups = files.filter(file =>
        file.startsWith('data_backup_') && file.endsWith('.json')
      );
      // Obtenir les infos de chaque backup
      const backupsInfo = dataBackups.map(file => {
        const filePath = path.join(backupsFolder, file);
        const stats = fs.statSync(filePath);

        return {
          name: file,
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime
        };
      });
      // Trier par date de modification (le plus récent en premier)
      backupsInfo.sort((a, b) => b.modified - a.modified);
      return backupsInfo;
    } catch (error) {
      console.error('❌ Erreur lors du listage des backups:', error);
      return [];
    }
  });
  // Handler pour obtenir des statistiques sur les backups
  ipcMain.handle('getBackupStats', async () => {
    try {
      let totalSize = 0;
      const files = fs.readdirSync(backupsFolder);
      const dataBackups = files.filter(file =>
        file.startsWith('data_backup_') && file.endsWith('.json')
      );
      dataBackups.forEach(file => {
        const filePath = path.join(backupsFolder, file);
        const stats = fs.statSync(filePath);
        totalSize += stats.size;
      });
      return {
        count: dataBackups.length,
        totalSize: totalSize,
        averageSize: dataBackups.length > 0 ? totalSize / dataBackups.length : 0
      };
    } catch (error) {
      console.error('❌ Erreur lors du calcul des statistiques:', error);
      return {
        count: 0,
        totalSize: 0,
        averageSize: 0
      };
    }
  });
  // Handler pour nettoyer les anciens backups (garder seulement les N plus récents)
  ipcMain.handle('cleanOldBackups', async (event, keepCount) => {
    try {
      if (!fs.existsSync(backupsFolder)) {
        return true;
      }
      const files = fs.readdirSync(backupsFolder);
      const dataBackups = files.filter(file =>
        file.startsWith('data_backup_') && file.endsWith('.json')
      );
      // Obtenir les infos et trier par date
      const backupsInfo = dataBackups.map(file => {
        const filePath = path.join(backupsFolder, file);
        const stats = fs.statSync(filePath);

        return {
          name: file,
          path: filePath,
          modified: stats.mtime
        };
      });
      // Trier par date (plus récent en premier)
      backupsInfo.sort((a, b) => b.modified - a.modified);
      // Supprimer ceux au-delà du nombre à garder
      if (backupsInfo.length > keepCount) {
        const toDelete = backupsInfo.slice(keepCount);

        toDelete.forEach(backup => {
          fs.unlinkSync(backup.path);
          console.log(`🗑️ Backup supprimé: ${backup.name}`);
        });
        console.log(`✅ ${toDelete.length} anciens backups supprimés, ${keepCount} conservés`);
      }
      return true;
    } catch (error) {
      console.error('❌ Erreur lors du nettoyage des backups:', error);
      return false;
    }
  });
  // ========================================================================
  // HANDLERS POUR LA SYNCHRONISATION DES DONNÉES (DataSyncManager)
  // ========================================================================
  const DATA_SYNC_PATH = path.join(COMMON_SERVER_PATH, 'app-data.json');
  const DATA_SYNC_METADATA_PATH = path.join(COMMON_SERVER_PATH, 'app-data-metadata.json');

  /**
   * Vérifie si le serveur commun est accessible pour la sync des données
   */
  ipcMain.handle('dataSync:checkAccess', async () => {
    try {
      return fs.existsSync(COMMON_SERVER_PATH);
    } catch (error) {
      return false;
    }
  });

  /**
   * Récupère les données du serveur commun (fichier principal app-data.json)
   */
  ipcMain.handle('dataSync:pull', async () => {
    try {
      if (!fs.existsSync(DATA_SYNC_PATH)) {
        console.log('ℹ️ DataSync: Pas de données sur le serveur (première sync)');
        return null;
      }
      const dataContent = fs.readFileSync(DATA_SYNC_PATH, 'utf8');
      const data = JSON.parse(dataContent);
      let metadata = null;
      if (fs.existsSync(DATA_SYNC_METADATA_PATH)) {
        const metadataContent = fs.readFileSync(DATA_SYNC_METADATA_PATH, 'utf8');
        metadata = JSON.parse(metadataContent);
      }
      console.log('✅ DataSync: Données récupérées du serveur');
      return { data, metadata };
    } catch (error) {
      console.error('❌ DataSync: Erreur lecture serveur:', error);
      throw new Error(`Erreur lecture serveur: ${error.message}`);
    }
  });

  /**
   * Envoie les données vers le serveur commun (fichier principal app-data.json)
   */
  ipcMain.handle('dataSync:push', async (event, data, metadata) => {
    try {
      if (!fs.existsSync(COMMON_SERVER_PATH)) {
        throw new Error('Serveur commun inaccessible');
      }
      fs.writeFileSync(DATA_SYNC_PATH, JSON.stringify(data, null, 2), 'utf8');
      fs.writeFileSync(DATA_SYNC_METADATA_PATH, JSON.stringify(metadata, null, 2), 'utf8');
      console.log('✅ DataSync: Données envoyées au serveur');
      return true;
    } catch (error) {
      console.error('❌ DataSync: Erreur envoi serveur:', error);
      throw new Error(`Erreur envoi serveur: ${error.message}`);
    }
  });

  /**
   * Crée un backup daté du fichier serveur actuel avant chaque push.
   * Si filename est fourni, utilise ce nom ; sinon repli sur l'ancien nom unique (rétrocompat).
   */
  ipcMain.handle('dataSync:backupServer', async (event, filename) => {
    try {
      if (!fs.existsSync(DATA_SYNC_PATH)) return false;
      // Utiliser le nom fourni ou, si absent, le nom legacy unique
      const backupName = filename || 'app-data-backup.json';
      const backupPath = path.join(COMMON_SERVER_PATH, backupName);
      fs.copyFileSync(DATA_SYNC_PATH, backupPath);
      console.log(`✅ DataSync: Backup serveur créé → ${backupName}`);
      return true;
    } catch (error) {
      console.error('❌ DataSync: Erreur backup serveur:', error);
      return false;
    }
  });

  /**
   * Supprime un fichier backup du dossier serveur (utilisé par la rotation).
   * Sécurité : seuls les fichiers app-data-backup-*.json peuvent être supprimés.
   */
  ipcMain.handle('dataSync:deleteServerBackup', async (event, filename) => {
    try {
      // Sécurité : n'accepter que les fichiers backup de sync (pas app-data.json ou autre)
      if (!filename || !filename.startsWith('app-data-backup-') || !filename.endsWith('.json')) {
        console.error(`❌ DataSync: Suppression refusée pour "${filename}" (nom non autorisé)`);
        return false;
      }
      const filePath = path.join(COMMON_SERVER_PATH, filename);
      if (!fs.existsSync(filePath)) {
        console.warn(`⚠️ DataSync: Fichier backup introuvable pour suppression : ${filename}`);
        return false;
      }
      fs.unlinkSync(filePath);
      console.log(`🗑️ DataSync: Backup serveur supprimé → ${filename}`);
      return true;
    } catch (error) {
      console.error('❌ DataSync: Erreur suppression backup serveur:', error);
      return false;
    }
  });

  /**
   * Liste les fichiers backup présents dans le dossier serveur.
   * Ne retourne que les fichiers app-data-backup-*.json (pas app-data.json).
   */
  ipcMain.handle('dataSync:listServerBackups', async () => {
    try {
      if (!fs.existsSync(COMMON_SERVER_PATH)) return [];
      const files = fs.readdirSync(COMMON_SERVER_PATH);
      // Ne lister que les backups datés (app-data-backup-TIMESTAMP.json)
      // Trier du plus récent au plus ancien (ordre alphabétique inverse = ordre chronologique inverse
      // car le nom contient un timestamp ISO)
      return files
        .filter(f => f.startsWith('app-data-backup-') && f.endsWith('.json'))
        .sort()
        .reverse();
    } catch (error) {
      console.error('❌ DataSync: Erreur listage backups serveur:', error);
      return [];
    }
  });

  /**
   * Lit un fichier backup serveur et retourne son contenu parsé { data, metadata }.
   * Utilisé par DataSyncManager.restoreFromServerBackup().
   */
  ipcMain.handle('dataSync:readServerBackup', async (event, filename) => {
    try {
      // Sécurité : seuls les fichiers app-data-backup-*.json sont lisibles via cette API
      if (!filename || !filename.startsWith('app-data-backup-') || !filename.endsWith('.json')) {
        console.error(`❌ DataSync: Lecture refusée pour "${filename}" (nom non autorisé)`);
        return null;
      }
      const filePath = path.join(COMMON_SERVER_PATH, filename);
      if (!fs.existsSync(filePath)) {
        console.error(`❌ DataSync: Backup introuvable : ${filename}`);
        return null;
      }
      const content = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(content);
      console.log(`✅ DataSync: Backup lu → ${filename}`);
      // Le fichier backup contient directement les SyncData (même format que app-data.json)
      // On reconstruit un objet { data, metadata } pour l'uniformité avec dataSync:pull
      return {
        data: data,
        metadata: {
          lastModified: new Date().toISOString(),
          modifiedBy: 'restore',
          computerName: 'restore',
          version: data.version || 0,
          restoredFrom: filename
        }
      };
    } catch (error) {
      console.error('❌ DataSync: Erreur lecture backup serveur:', error);
      return null;
    }
  });

  /**
   * Récupère les informations de l'utilisateur actuel
   */
  ipcMain.handle('system:getCurrentUser', async () => {
    try {
      const displayName = os.userInfo().username || 'Utilisateur';
      const computerName = os.hostname() || 'Ordinateur';

      return {
        displayName: displayName,
        computerName: computerName
      };
    } catch (error) {
      console.error('❌ Erreur récupération info utilisateur:', error);
      return {
        displayName: 'Utilisateur Inconnu',
        computerName: 'Ordinateur Inconnu'
      };
    }
  });

  // ========================================================================
  // HANDLERS MULTI-CONTENTIEUX (users.json + sync par contentieux)
  // ========================================================================

  /**
   * Lit users.json depuis le serveur partagé
   */
  ipcMain.handle('dataSync:pullUsersConfig', async () => {
    try {
      if (!fs.existsSync(USERS_CONFIG_PATH)) {
        console.log('ℹ️ MultiSync: users.json introuvable (premier lancement)')
        return null
      }
      const content = fs.readFileSync(USERS_CONFIG_PATH, 'utf8')
      return JSON.parse(content)
    } catch (error) {
      console.error('❌ MultiSync: Erreur lecture users.json:', error)
      return null
    }
  })

  /**
   * Écrit users.json sur le serveur partagé
   */
  ipcMain.handle('dataSync:pushUsersConfig', async (event, config) => {
    try {
      if (!fs.existsSync(COMMON_SERVER_PATH)) {
        throw new Error('Serveur commun inaccessible')
      }
      // Backup avant écriture
      if (fs.existsSync(USERS_CONFIG_PATH)) {
        const backupPath = path.join(COMMON_SERVER_PATH, 'admin', 'backups')
        if (!fs.existsSync(backupPath)) fs.mkdirSync(backupPath, { recursive: true })
        const timestamp = new Date().toISOString().replace(/:/g, '-')
        fs.copyFileSync(USERS_CONFIG_PATH, path.join(backupPath, `users-${timestamp}.json`))
      }
      fs.writeFileSync(USERS_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
      console.log('✅ MultiSync: users.json sauvegardé')
      return true
    } catch (error) {
      console.error('❌ MultiSync: Erreur écriture users.json:', error)
      return false
    }
  })

  // ========================================================================
  // HANDLERS FICHIERS GLOBAUX PARTAGÉS (tag-data.json, audience-data.json)
  //
  // Architecture : chaque catégorie "transverse aux contentieux" (tags,
  // résultats d'audience) possède son propre fichier à la racine du serveur
  // commun, avec backup dans admin/backups/. Remplace le vieux pipeline
  // DataSyncManager global (app-data.json racine) qui ne détectait plus les
  // changements depuis la bascule en multi-contentieux.
  // ========================================================================

  const globalFilePath = (name) => path.join(COMMON_SERVER_PATH, name)
  const globalBackupDir = () => path.join(COMMON_SERVER_PATH, 'admin', 'backups')

  const readGlobalFile = (name) => {
    try {
      const filePath = globalFilePath(name)
      if (!fs.existsSync(filePath)) return null
      const content = fs.readFileSync(filePath, 'utf8')
      if (!content || !content.trim()) return null
      return JSON.parse(content)
    } catch (error) {
      console.error(`❌ GlobalSync: Erreur lecture ${name}:`, error)
      return null
    }
  }

  const writeGlobalFile = (name, payload) => {
    if (!fs.existsSync(COMMON_SERVER_PATH)) {
      throw new Error('Serveur commun inaccessible')
    }
    const filePath = globalFilePath(name)
    const backupDir = globalBackupDir()
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true })
    if (fs.existsSync(filePath)) {
      const timestamp = new Date().toISOString().replace(/:/g, '-')
      const base = name.replace(/\.json$/i, '')
      fs.copyFileSync(filePath, path.join(backupDir, `${base}-${timestamp}.json`))
    }
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8')
    return true
  }

  // Nettoyage : on ne garde que les N backups les plus récents par type
  const pruneGlobalBackups = (basename, keep = 20) => {
    try {
      const backupDir = globalBackupDir()
      if (!fs.existsSync(backupDir)) return
      const prefix = `${basename}-`
      const files = fs.readdirSync(backupDir)
        .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
        .map(f => ({ name: f, mtime: fs.statSync(path.join(backupDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
      files.slice(keep).forEach(f => {
        try { fs.unlinkSync(path.join(backupDir, f.name)) } catch {}
      })
    } catch {
      // non bloquant
    }
  }

  ipcMain.handle('globalSync:pullTags', async () => {
    return readGlobalFile('tag-data.json')
  })

  ipcMain.handle('globalSync:pushTags', async (event, payload) => {
    try {
      writeGlobalFile('tag-data.json', payload)
      pruneGlobalBackups('tag-data')
      console.log('✅ GlobalSync: tag-data.json sauvegardé')
      return true
    } catch (error) {
      console.error('❌ GlobalSync: Erreur écriture tag-data.json:', error)
      return false
    }
  })

  ipcMain.handle('globalSync:pullAudience', async () => {
    return readGlobalFile('audience-data.json')
  })

  ipcMain.handle('globalSync:pushAudience', async (event, payload) => {
    try {
      writeGlobalFile('audience-data.json', payload)
      pruneGlobalBackups('audience-data')
      console.log('✅ GlobalSync: audience-data.json sauvegardé')
      return true
    } catch (error) {
      console.error('❌ GlobalSync: Erreur écriture audience-data.json:', error)
      return false
    }
  })

  /**
   * Lit app-data.json racine en fallback pour la migration one-shot
   * (renvoie la clé customTags telle qu'elle existe, format legacy ou non)
   */
  ipcMain.handle('globalSync:readLegacyAppData', async () => {
    try {
      const legacyPath = globalFilePath('app-data.json')
      if (!fs.existsSync(legacyPath)) return null
      const content = fs.readFileSync(legacyPath, 'utf8')
      if (!content || !content.trim()) return null
      return JSON.parse(content)
    } catch (error) {
      console.error('❌ GlobalSync: Erreur lecture app-data.json legacy:', error)
      return null
    }
  })

  /**
   * Vérifie l'accès au dossier d'un contentieux
   */
  ipcMain.handle('dataSync:checkContentieuxAccess', async (event, contentieuxId) => {
    try {
      const folder = getContentieuxFolder(contentieuxId)
      if (!folder) return false
      // Le dossier parent doit être accessible
      const parentDir = path.dirname(folder)
      return fs.existsSync(parentDir)
    } catch {
      return false
    }
  })

  /**
   * Retourne les chemins effectifs actuels (configurés ou par défaut)
   */
  // ── Configuration serveur (premier lancement / reset) ──

  ipcMain.handle('serverConfig:get', async () => {
    const configured = getConfiguredServerPath()
    return {
      isConfigured: !!configured,
      serverRootPath: configured || LEGACY_SERVER_PATH,
      configPath: SERVER_CONFIG_PATH,
    }
  })

  ipcMain.handle('serverConfig:setup', async (event, serverRootPath) => {
    try {
      // Valider que le chemin existe et est accessible
      if (!fs.existsSync(serverRootPath)) {
        // Tenter de créer le dossier
        try {
          fs.mkdirSync(serverRootPath, { recursive: true })
        } catch (e) {
          return { success: false, error: `Impossible de créer le dossier : ${e.message}` }
        }
      }
      // Vérifier l'écriture
      const testFile = path.join(serverRootPath, '.write-test')
      try {
        fs.writeFileSync(testFile, 'test', 'utf8')
        fs.unlinkSync(testFile)
      } catch (e) {
        return { success: false, error: `Le dossier n'est pas accessible en écriture : ${e.message}` }
      }

      // Sauvegarder la config
      saveServerConfig(serverRootPath)
      // Recharger les chemins dans le process
      reloadServerPaths()

      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('serverConfig:reset', async () => {
    try {
      if (fs.existsSync(SERVER_CONFIG_PATH)) {
        fs.unlinkSync(SERVER_CONFIG_PATH)
      }
      // Recharger les chemins (retombera sur le fallback legacy)
      reloadServerPaths()
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('paths:getEffective', async () => {
    const general = getGeneralServerPath()
    const contentieux = {}
    for (const [id, defaultPath] of Object.entries(CONTENTIEUX_FOLDERS)) {
      try {
        contentieux[id] = getContentieuxFolder(id)
      } catch {
        contentieux[id] = defaultPath
      }
    }
    return { general, contentieux }
  })

  /**
   * Migre les données d'un ancien chemin vers un nouveau chemin.
   * Copie app-data.json et le dossier backups/ s'ils existent.
   */
  ipcMain.handle('paths:migrateContentieux', async (event, contentieuxId, oldPath, newPath) => {
    try {
      if (!oldPath || !newPath || oldPath === newPath) return { success: true, skipped: true }
      if (!fs.existsSync(oldPath)) return { success: true, skipped: true, reason: 'Ancien chemin inexistant' }

      // Créer le nouveau dossier
      if (!fs.existsSync(newPath)) {
        fs.mkdirSync(newPath, { recursive: true })
      }

      const migrated = []

      // Copier app-data.json
      const oldData = path.join(oldPath, 'app-data.json')
      if (fs.existsSync(oldData)) {
        const newData = path.join(newPath, 'app-data.json')
        if (!fs.existsSync(newData)) {
          fs.copyFileSync(oldData, newData)
          migrated.push('app-data.json')
        }
      }

      // Copier le dossier backups/
      const oldBackups = path.join(oldPath, 'backups')
      if (fs.existsSync(oldBackups)) {
        const newBackups = path.join(newPath, 'backups')
        if (!fs.existsSync(newBackups)) {
          fs.mkdirSync(newBackups, { recursive: true })
          for (const file of fs.readdirSync(oldBackups)) {
            fs.copyFileSync(path.join(oldBackups, file), path.join(newBackups, file))
          }
          migrated.push(`backups/ (${fs.readdirSync(oldBackups).length} fichiers)`)
        }
      }

      console.log(`✅ Migration ${contentieuxId}: ${oldPath} → ${newPath} (${migrated.join(', ') || 'rien à migrer'})`)
      return { success: true, migrated }
    } catch (error) {
      console.error(`❌ Migration ${contentieuxId} error:`, error.message)
      return { success: false, error: error.message }
    }
  })

  /**
   * Migre les données générales (heartbeats, events, audit, updates) vers un nouveau chemin.
   */
  ipcMain.handle('paths:migrateGeneral', async (event, oldPath, newPath) => {
    try {
      if (!oldPath || !newPath || oldPath === newPath) return { success: true, skipped: true }
      if (!fs.existsSync(oldPath)) return { success: true, skipped: true, reason: 'Ancien chemin inexistant' }

      if (!fs.existsSync(newPath)) {
        fs.mkdirSync(newPath, { recursive: true })
      }

      const migrated = []
      const subfolders = ['heartbeats', 'events', 'audit', 'updates']
      for (const sub of subfolders) {
        const oldSub = path.join(oldPath, sub)
        const newSub = path.join(newPath, sub)
        if (fs.existsSync(oldSub) && !fs.existsSync(newSub)) {
          fs.mkdirSync(newSub, { recursive: true })
          fs.cpSync(oldSub, newSub, { recursive: true })
          migrated.push(sub)
        }
      }

      // Copier users.json
      const oldUsers = path.join(oldPath, 'users.json')
      const newUsers = path.join(newPath, 'users.json')
      if (fs.existsSync(oldUsers) && !fs.existsSync(newUsers)) {
        fs.copyFileSync(oldUsers, newUsers)
        migrated.push('users.json')
      }

      console.log(`✅ Migration général: ${oldPath} → ${newPath} (${migrated.join(', ') || 'rien à migrer'})`)
      return { success: true, migrated }
    } catch (error) {
      console.error(`❌ Migration général error:`, error.message)
      return { success: false, error: error.message }
    }
  })

  /**
   * Lit app-data.json d'un contentieux spécifique
   */
  ipcMain.handle('dataSync:pullContentieux', async (event, contentieuxId) => {
    try {
      const folder = getContentieuxFolder(contentieuxId)
      const dataPath = path.join(folder, 'app-data.json')
      if (!fs.existsSync(dataPath)) {
        console.log(`ℹ️ MultiSync[${contentieuxId}]: Pas de données (première sync)`)
        return null
      }
      const content = fs.readFileSync(dataPath, 'utf8')
      const parsed = JSON.parse(content)
      console.log(`✅ MultiSync[${contentieuxId}]: Données récupérées`)
      return {
        data: parsed.data || parsed,
        metadata: parsed.metadata || null
      }
    } catch (error) {
      console.error(`❌ MultiSync[${contentieuxId}]: Erreur lecture:`, error)
      throw new Error(`Erreur lecture serveur ${contentieuxId}: ${error.message}`)
    }
  })

  /**
   * Écrit app-data.json d'un contentieux spécifique
   */
  ipcMain.handle('dataSync:pushContentieux', async (event, contentieuxId, data, metadata) => {
    try {
      const folder = getContentieuxFolder(contentieuxId)
      const dataPath = path.join(folder, 'app-data.json')
      const payload = { data, metadata }
      fs.writeFileSync(dataPath, JSON.stringify(payload, null, 2), 'utf8')
      console.log(`✅ MultiSync[${contentieuxId}]: Données envoyées`)
      return true
    } catch (error) {
      console.error(`❌ MultiSync[${contentieuxId}]: Erreur écriture:`, error)
      throw new Error(`Erreur envoi serveur ${contentieuxId}: ${error.message}`)
    }
  })

  /**
   * Crée un backup du app-data.json d'un contentieux avant push
   */
  ipcMain.handle('dataSync:backupContentieux', async (event, contentieuxId, backupFilename) => {
    try {
      const folder = getContentieuxFolder(contentieuxId)
      const dataPath = path.join(folder, 'app-data.json')
      if (!fs.existsSync(dataPath)) return false
      const backupDir = getContentieuxBackupFolder(contentieuxId)
      fs.copyFileSync(dataPath, path.join(backupDir, backupFilename))
      console.log(`✅ MultiSync[${contentieuxId}]: Backup créé → ${backupFilename}`)
      return true
    } catch (error) {
      console.error(`❌ MultiSync[${contentieuxId}]: Erreur backup:`, error)
      return false
    }
  })

  // === SCAN DES DOCUMENTS PDF DU CHEMIN EXTERNE POUR ANALYSE AUTOMATIQUE ===
  ipcMain.handle('documents:scan-external-pdfs', async (event, externalPath, enqueteNumero, useSubfolder = true) => {
    try {
      const result = {
        documents: [],
        errors: [],
        foldersScanned: []
      };

      if (!externalPath) {
        result.errors.push('Aucun chemin externe configuré');
        return result;
      }

      const basePath = buildExternalPath(externalPath, enqueteNumero, useSubfolder);

      if (!fs.existsSync(basePath)) {
        result.errors.push(`Chemin inaccessible : ${basePath}`);
        return result;
      }

      // Scanner toutes les sous-pochettes (Geoloc, Géoloc, Ecoutes, Actes, PV, etc.)
      // Gérer les doublons de dossiers (Geoloc et Géoloc)
      const entries = fs.readdirSync(basePath, { withFileTypes: true });
      const foldersToScan = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          foldersToScan.push(entry.name);
        }
      }

      result.foldersScanned = foldersToScan;

      // Set pour détecter les fichiers en double (même nom dans Geoloc et Géoloc par ex)
      const processedFiles = new Set();

      for (const folder of foldersToScan) {
        const folderPath = path.join(basePath, folder);

        try {
          const files = listFilesRecursively(folderPath);

          for (const relFile of files) {
            const fullPath = path.join(folderPath, relFile);
            const ext = path.extname(relFile).toLowerCase();

            // Ne traiter que les PDF
            if (ext !== '.pdf') continue;

            const fileName = path.basename(relFile);

            // Vérifier si déjà traité (dossiers en double : Geoloc / Géoloc)
            // On normalise le nom du dossier pour la déduplication
            const normalizedFolder = folder
              .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Retirer accents
              .toLowerCase();
            const fileKey = `${normalizedFolder}/${fileName.toLowerCase()}`;

            if (processedFiles.has(fileKey)) {
              continue; // Fichier en double → ignorer
            }
            processedFiles.add(fileKey);

            try {
              // Vérifier la taille du fichier
              const stats = fs.statSync(fullPath);
              if (stats.size > 10 * 1024 * 1024) {
                result.errors.push(`Fichier trop volumineux (${fileName}), ignoré`);
                continue;
              }

              // Lire le fichier PDF
              const fileBuffer = fs.readFileSync(fullPath);

              // Extraire le texte
              let textContent = '';
              try {
                const pdfData = await pdfParse(fileBuffer);
                textContent = pdfData.text.trim();

                // Si texte insuffisant, essayer OCR
                if (textContent.length <= 50) {
                  const tessdataPath = path.join(__dirname, 'tessdata');
                  const fraPath = path.join(tessdataPath, 'fra.traineddata');

                  if (fs.existsSync(fraPath)) {
                    try {
                      const worker = await tesseract.createWorker('fra', 1, {
                        langPath: tessdataPath,
                        cachePath: tessdataPath,
                      });
                      const { data: { text: ocrText } } = await worker.recognize(fileBuffer);
                      await worker.terminate();
                      if (ocrText.length > 20) textContent = ocrText;
                    } catch (ocrErr) {
                      console.error(`OCR échoué pour ${fileName}:`, ocrErr.message);
                    }
                  }
                }
              } catch (pdfErr) {
                result.errors.push(`Erreur extraction texte ${fileName}: ${pdfErr.message}`);
                continue;
              }

              if (textContent.length > 50) {
                result.documents.push({
                  filePath: fullPath,
                  fileName: fileName,
                  sourceFolder: folder,
                  textContent: textContent
                });
              }
            } catch (readErr) {
              result.errors.push(`Erreur lecture ${fileName}: ${readErr.message}`);
            }
          }
        } catch (folderErr) {
          result.errors.push(`Erreur scan dossier ${folder}: ${folderErr.message}`);
        }
      }

      return result;
    } catch (error) {
      console.error('Erreur scan PDFs externe:', error);
      return {
        documents: [],
        errors: [`Erreur globale: ${error.message}`],
        foldersScanned: []
      };
    }
  });

  // === EXTRACTION DE TEXTE PDF POUR JLD AVEC OCR (100% OFFLINE) ===
  ipcMain.handle('pdf:extractText', async (event, buffer) => {
    try {
      if (buffer.length > 10 * 1024 * 1024) {
        throw new Error('Fichier PDF trop volumineux (max 10MB)');
      }

      console.log('📄 Tentative extraction texte normale...');

      // 1. Essayer extraction normale d'abord
      const extractionPromise = pdfParse(buffer);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout extraction PDF (30s)')), 30000)
      );

      const pdfData = await Promise.race([extractionPromise, timeoutPromise]);
      const normalText = pdfData.text.trim();

      // 2. Vérifier si le texte est suffisant (plus de 50 caractères utiles)
      if (normalText.length > 50) {
        console.log('✅ Extraction normale réussie, longueur:', normalText.length);
        return normalText;
      }

      console.log('⚠️ Texte insuffisant, tentative OCR offline...');

      // 3. Fallback OCR avec Tesseract v5.1.1 (OFFLINE)
      console.log('🤖 Initialisation OCR offline (v5.1.1)...');

      // Chemin vers le dossier tessdata
      const tessdataPath = path.join(__dirname, 'tessdata');
      const fraTrainedDataPath = path.join(tessdataPath, 'fra.traineddata');

      // Vérifier que le fichier fra.traineddata existe
      if (!fs.existsSync(fraTrainedDataPath)) {
        console.error('❌ Fichier fra.traineddata manquant!');
        console.error(`   Attendu: ${fraTrainedDataPath}`);
        console.log('Retour au texte PDF normal...');
        return normalText;
      }

      console.log('📂 Configuration Tesseract v5.1.1 offline...');

      // Créer le worker (API v5.1.1 avec await)
      const worker = await tesseract.createWorker('fra', 1, {
        langPath: tessdataPath,
        cachePath: tessdataPath,
        logger: m => {
          if (m.status === 'recognizing text') {
            console.log(`📊 OCR progression: ${Math.round(m.progress * 100)}%`);
          }
        }
      });

      console.log('🔍 OCR en cours...');

      const { data: { text: ocrText } } = await worker.recognize(buffer);
      await worker.terminate();

      console.log('✅ OCR terminé, longueur:', ocrText.length);
      return ocrText.length > 20 ? ocrText : normalText;

    } catch (error) {
      console.error('❌ Erreur extraction PDF:', error);
      if (error.message.includes('tessdata')) {
        console.log('💡 Conseil: Téléchargez fra.traineddata et placez-le dans ./tessdata/');
      }
      throw new Error(`Erreur extraction PDF: ${error.message}`);
    }
  });

  // ========================================================================
  // HANDLERS HEARTBEAT, ÉVÉNEMENTS PARTAGÉS, JOURNAL D'AUDIT
  // ========================================================================

  /**
   * Résout le chemin "general" depuis la config serverPaths de users.json.
   * Fallback sur COMMON_SERVER_PATH si non configuré.
   */
  // getGeneralServerPath et ensureDir sont désormais au niveau module (voir plus haut)

  // ── HEARTBEAT ──

  ipcMain.handle('heartbeat:write', async (event, username, heartbeat) => {
    try {
      const dir = ensureDir(path.join(getGeneralServerPath(), 'heartbeats'))
      const filePath = path.join(dir, `${username}.json`)
      fs.writeFileSync(filePath, JSON.stringify(heartbeat, null, 2), 'utf8')
      return true
    } catch (error) {
      console.error('❌ Heartbeat write error:', error.message)
      return false
    }
  })

  ipcMain.handle('heartbeat:remove', async (event, username) => {
    try {
      const filePath = path.join(getGeneralServerPath(), 'heartbeats', `${username}.json`)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
      return true
    } catch (error) {
      console.error('❌ Heartbeat remove error:', error.message)
      return false
    }
  })

  ipcMain.handle('heartbeat:readAll', async () => {
    try {
      const dir = path.join(getGeneralServerPath(), 'heartbeats')
      if (!fs.existsSync(dir)) return []
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
      const heartbeats = []
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(dir, file), 'utf8')
          heartbeats.push(JSON.parse(content))
        } catch {}
      }
      return heartbeats
    } catch (error) {
      console.error('❌ Heartbeat readAll error:', error.message)
      return []
    }
  })

  // ── ÉVÉNEMENTS PARTAGÉS ──

  ipcMain.handle('sharedEvent:write', async (event, sharedEvent) => {
    try {
      const dir = ensureDir(path.join(getGeneralServerPath(), 'events'))
      const filePath = path.join(dir, `${sharedEvent.id}.json`)
      fs.writeFileSync(filePath, JSON.stringify(sharedEvent, null, 2), 'utf8')
      return true
    } catch (error) {
      console.error('❌ SharedEvent write error:', error.message)
      return false
    }
  })

  ipcMain.handle('sharedEvent:cleanup', async (event, ttlMs) => {
    try {
      const dir = path.join(getGeneralServerPath(), 'events')
      if (!fs.existsSync(dir)) return true
      const now = Date.now()
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
      for (const file of files) {
        try {
          const filePath = path.join(dir, file)
          const content = JSON.parse(fs.readFileSync(filePath, 'utf8'))
          if (now - new Date(content.timestamp).getTime() > ttlMs) {
            fs.unlinkSync(filePath)
          }
        } catch {}
      }
      return true
    } catch (error) {
      console.error('❌ SharedEvent cleanup error:', error.message)
      return false
    }
  })

  // File watcher pour les événements partagés (géré au niveau module, voir startEventsWatcher/stopEventsWatcher)

  ipcMain.handle('sharedEvent:startWatcher', async () => {
    startEventsWatcher()
    return true
  })

  // ── JOURNAL D'AUDIT ──

  ipcMain.handle('auditLog:append', async (event, entry, maxEntries) => {
    try {
      const dir = ensureDir(path.join(getGeneralServerPath(), 'audit'))
      const filePath = path.join(dir, 'audit_log.json')
      let entries = []
      if (fs.existsSync(filePath)) {
        try {
          entries = JSON.parse(fs.readFileSync(filePath, 'utf8'))
        } catch {}
      }
      entries.unshift(entry)
      if (entries.length > maxEntries) {
        entries.length = maxEntries
      }
      fs.writeFileSync(filePath, JSON.stringify(entries, null, 2), 'utf8')
      return true
    } catch (error) {
      console.error('❌ AuditLog append error:', error.message)
      return false
    }
  })

  ipcMain.handle('auditLog:read', async () => {
    try {
      const filePath = path.join(getGeneralServerPath(), 'audit', 'audit_log.json')
      if (!fs.existsSync(filePath)) return []
      return JSON.parse(fs.readFileSync(filePath, 'utf8'))
    } catch (error) {
      console.error('❌ AuditLog read error:', error.message)
      return []
    }
  })

  // === MISE À JOUR VIA GITHUB (GitHub API + ZIP, sans git) ===

  const GITHUB_REPO = 'DrCHRVL/APPMETIER';

  // Détection du proxy depuis les variables d'environnement ou .npmrc
  function getProxyUrl() {
    // Variables d'environnement standard
    const envProxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
    if (envProxy) return envProxy;
    // Lecture depuis .npmrc
    try {
      const npmrc = fs.readFileSync(path.join(__dirname, '.npmrc'), 'utf8');
      const match = npmrc.match(/https-proxy\s*=\s*(.+)/i) || npmrc.match(/proxy\s*=\s*(.+)/i);
      if (match) return match[1].trim();
    } catch {}
    return null;
  }

  // Crée un tunnel CONNECT à travers le proxy pour les requêtes HTTPS
  function createProxyTunnel(targetHost, targetPort = 443, timeoutMs = 30000) {
    const proxyUrl = getProxyUrl();
    if (!proxyUrl) return Promise.resolve(null); // Pas de proxy → connexion directe

    return new Promise((resolve, reject) => {
      const proxy = new URL(proxyUrl);
      const req = http.request({
        host: proxy.hostname,
        port: proxy.port || 8080,
        method: 'CONNECT',
        path: `${targetHost}:${targetPort}`,
        timeout: timeoutMs,
        headers: { 'Host': `${targetHost}:${targetPort}` }
      });
      req.on('connect', (res, socket) => {
        if (res.statusCode === 200) {
          resolve(socket);
        } else {
          socket.destroy();
          reject(new Error(`Proxy CONNECT failed: HTTP ${res.statusCode}`));
        }
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Proxy CONNECT timeout')); });
      req.end();
    });
  }

  // Requête HTTPS avec suivi de redirections, retourne le corps en texte
  function httpsGet(url, extraHeaders = {}) {
    return new Promise(async (resolve, reject) => {
      try {
        const makeRequest = async (currentUrl) => {
          const parsed = new URL(currentUrl);
          let socket;
          try { socket = await createProxyTunnel(parsed.hostname); } catch (e) {
            reject(new Error(`Erreur proxy: ${e.message}`)); return;
          }
          const options = {
            hostname: parsed.hostname,
            path: parsed.pathname + parsed.search,
            headers: { 'User-Agent': 'APPMETIER-updater', ...extraHeaders },
            timeout: 30000
          };
          if (socket) { options.socket = socket; options.agent = false; }
          https.get(options, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              res.resume();
              if (socket) socket.destroy();
              makeRequest(res.headers.location);
              return;
            }
            if (res.statusCode !== 200) {
              res.resume();
              if (socket) socket.destroy();
              const msg = res.statusCode === 403
                ? 'HTTP 403 — Limite API GitHub atteinte (60 req/h). Réessayez dans quelques minutes.'
                : `HTTP ${res.statusCode}`;
              reject(new Error(msg));
              return;
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => { if (socket) socket.destroy(); resolve(data); });
            res.on('error', (e) => { if (socket) socket.destroy(); reject(e); });
          }).on('error', (e) => { if (socket) socket.destroy(); reject(e); })
            .on('timeout', function() { this.destroy(); if (socket) socket.destroy(); reject(new Error('Timeout requête API')); });
        };
        await makeRequest(url);
      } catch (e) { reject(e); }
    });
  }

  // Téléchargement binaire avec suivi de redirections et timeout
  function httpsDownload(url, destPath, timeoutMs = 120000) {
    return new Promise(async (resolve, reject) => {
      try {
        const makeRequest = async (currentUrl) => {
          const parsed = new URL(currentUrl);
          let socket;
          try { socket = await createProxyTunnel(parsed.hostname, 443, timeoutMs); } catch (e) {
            reject(new Error(`Erreur proxy: ${e.message}`)); return;
          }
          const options = {
            hostname: parsed.hostname,
            path: parsed.pathname + parsed.search,
            headers: { 'User-Agent': 'APPMETIER-updater' },
            timeout: timeoutMs
          };
          if (socket) { options.socket = socket; options.agent = false; }
          const req = https.get(options, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              res.resume();
              if (socket) socket.destroy();
              makeRequest(res.headers.location);
              return;
            }
            if (res.statusCode !== 200) {
              res.resume();
              if (socket) socket.destroy();
              const msg = res.statusCode === 403
                ? 'HTTP 403 — Limite API GitHub atteinte (60 req/h). Réessayez dans quelques minutes.'
                : `HTTP ${res.statusCode}`;
              reject(new Error(msg));
              return;
            }
            const file = fs.createWriteStream(destPath);
            res.pipe(file);
            file.on('finish', () => { file.close(() => { if (socket) socket.destroy(); resolve(); }); });
            file.on('error', (e) => { if (socket) socket.destroy(); reject(e); });
            res.on('error', (e) => { if (socket) socket.destroy(); reject(e); });
          });
          req.on('error', (e) => { if (socket) socket.destroy(); reject(e); });
          req.on('timeout', () => { req.destroy(); if (socket) socket.destroy(); reject(new Error('Timeout de téléchargement')); });
        };
        await makeRequest(url);
      } catch (e) { reject(e); }
    });
  }

  // Lit le SHA local depuis app-version.txt ou depuis les fichiers .git
  function getLocalSha() {
    const versionFile = path.join(dataFolder, 'app-version.txt');
    if (fs.existsSync(versionFile)) {
      return fs.readFileSync(versionFile, 'utf8').trim();
    }
    // Fallback : lire depuis .git (mode développement)
    for (const ref of ['main', 'master']) {
      const refPath = path.join(__dirname, '.git', 'refs', 'heads', ref);
      if (fs.existsSync(refPath)) {
        const sha = fs.readFileSync(refPath, 'utf8').trim();
        // Persister pour les prochaines vérifications
        try { fs.writeFileSync(versionFile, sha); } catch {}
        return sha;
      }
    }
    // Fallback : lire depuis packed-refs (git pack les refs parfois)
    try {
      const packedRefs = path.join(__dirname, '.git', 'packed-refs');
      if (fs.existsSync(packedRefs)) {
        const content = fs.readFileSync(packedRefs, 'utf8');
        for (const ref of ['main', 'master']) {
          const match = content.match(new RegExp(`^([0-9a-f]{40})\\s+refs/heads/${ref}$`, 'm'));
          if (match) {
            try { fs.writeFileSync(versionFile, match[1]); } catch {}
            return match[1];
          }
        }
      }
    } catch {}
    return null;
  }

  // Copie récursive pour GitHub updater (exclut dossiers d'état / runtimes).
  // Retourne la liste des chemins relatifs copiés pour détection rebuild/install.
  const GITHUB_COPY_SKIP = new Set(['data', '.git', 'node_modules', 'tessdata', '.next', 'nodejs', 'electron']);
  function copyDir(src, dest, rel = '', changedFiles = []) {
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (GITHUB_COPY_SKIP.has(entry.name)) continue;
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        copyDir(srcPath, destPath, relPath, changedFiles);
      } else {
        fs.copyFileSync(srcPath, destPath);
        changedFiles.push(relPath);
      }
    }
    return changedFiles;
  }

  // Déduit les actions post-MAJ (install / rebuild) selon les fichiers modifiés
  function detectPostUpdateActions(changedFiles) {
    const rebuildTriggers = ['app/', 'components/', 'lib/', 'pages/', 'hooks/', 'contexts/', 'stores/', 'services/', 'utils/', 'types/', 'public/', 'styles/'];
    const rebuildExactFiles = ['next.config.mjs', 'tailwind.config.ts', 'postcss.config.js', 'tsconfig.json'];
    const needsInstall = changedFiles.some(f => f === 'package.json' || f === 'package-lock.json');
    const needsRebuild = needsInstall || changedFiles.some(f =>
      rebuildTriggers.some(prefix => f.startsWith(prefix)) ||
      rebuildExactFiles.includes(f)
    );
    return { needsInstall, needsRebuild };
  }

  // Chemin du fichier d'approbation sur le serveur commun
  function getApprovalFilePath() {
    return path.join(getServerRootPath(), 'update-approved.json');
  }

  // Lit l'approbation admin depuis le serveur commun (ou null si absent/erreur)
  function readApprovedUpdate() {
    try {
      const p = getApprovalFilePath();
      if (!fs.existsSync(p)) return null;
      const raw = fs.readFileSync(p, 'utf8');
      const data = JSON.parse(raw);
      if (!data || typeof data.approvedSha !== 'string') return null;
      return data;
    } catch {
      return null;
    }
  }

  // Cache pour éviter de surcharger l'API GitHub (limite : 60 req/h sans token)
  let lastCheckResult = null;
  let lastCheckTime = 0;
  const CHECK_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes entre chaque appel API

  ipcMain.handle('app:checkUpdate', async (_event, forceRefresh = false) => {
    const approval = readApprovedUpdate();
    const approvedSha = approval?.approvedSha || null;
    const approvedBy = approval?.approvedBy || null;
    const approvedAt = approval?.approvedAt || null;

    // Retourner le cache si la dernière vérification est récente,
    // mais fusionner l'approbation courante (qui peut changer sans re-call GitHub)
    if (!forceRefresh && lastCheckResult && (Date.now() - lastCheckTime) < CHECK_COOLDOWN_MS) {
      console.log('[Update] Résultat en cache (encore', Math.round((CHECK_COOLDOWN_MS - (Date.now() - lastCheckTime)) / 1000), 's)');
      return { ...lastCheckResult, approvedSha, approvedBy, approvedAt };
    }
    const noCacheHeaders = { 'Cache-Control': 'no-cache', 'If-None-Match': '' };
    let result;
    try {
      const body = await httpsGet(`https://api.github.com/repos/${GITHUB_REPO}/commits/main`, noCacheHeaders);
      const data = JSON.parse(body);
      const remoteSha = data.sha;
      if (!remoteSha) { result = { hasUpdate: false, commits: 0, error: 'SHA distant non trouvé', localSha: null, remoteSha: null }; lastCheckResult = result; lastCheckTime = Date.now(); return { ...result, approvedSha, approvedBy, approvedAt }; }
      const localSha = getLocalSha();

      // Si pas de SHA local → premier déploiement, on enregistre le SHA distant comme référence
      if (!localSha) {
        console.log('[Update] Pas de SHA local trouvé → premier déploiement, on enregistre le SHA distant:', remoteSha);
        try { fs.writeFileSync(path.join(dataFolder, 'app-version.txt'), remoteSha); } catch {}
        result = { hasUpdate: false, commits: 0, localSha: remoteSha, remoteSha };
        lastCheckResult = result; lastCheckTime = Date.now(); return { ...result, approvedSha, approvedBy, approvedAt };
      }

      // Si identiques → à jour
      if (localSha === remoteSha) {
        console.log('[Update] À jour. SHA:', localSha);
        result = { hasUpdate: false, commits: 0, localSha, remoteSha };
        lastCheckResult = result; lastCheckTime = Date.now(); return { ...result, approvedSha, approvedBy, approvedAt };
      }

      // SHA différents → utiliser l'API compare pour le vrai nombre de commits
      let commits = 1;
      try {
        const compareBody = await httpsGet(
          `https://api.github.com/repos/${GITHUB_REPO}/compare/${localSha}...${remoteSha}`,
          noCacheHeaders
        );
        const compareData = JSON.parse(compareBody);
        if (compareData.ahead_by != null) {
          commits = compareData.ahead_by;
        }
      } catch (compareErr) {
        console.log('[Update] Compare API failed, fallback à 1 commit:', compareErr.message);
      }
      console.log('[Update] Mise à jour disponible:', commits, 'commit(s). Local:', localSha, 'Remote:', remoteSha);
      result = { hasUpdate: true, commits, localSha, remoteSha };
      lastCheckResult = result; lastCheckTime = Date.now(); return { ...result, approvedSha, approvedBy, approvedAt };
    } catch (error) {
      console.log('[Update] Erreur check:', error.message);
      // Ne pas cacher les erreurs pour permettre un retry rapide
      return { hasUpdate: false, commits: 0, error: error.message, localSha: null, remoteSha: null, approvedSha, approvedBy, approvedAt };
    }
  });

  // Renvoie la liste des commits entre localSha et remoteSha (pour le changelog)
  ipcMain.handle('app:getChangelog', async (_event, { localSha, remoteSha } = {}) => {
    try {
      if (!localSha || !remoteSha) {
        return { success: false, error: 'SHA local ou distant manquant', commits: [] };
      }
      if (localSha === remoteSha) {
        return { success: true, commits: [] };
      }
      const body = await httpsGet(
        `https://api.github.com/repos/${GITHUB_REPO}/compare/${localSha}...${remoteSha}`,
        { 'Cache-Control': 'no-cache' }
      );
      const data = JSON.parse(body);
      const commits = Array.isArray(data.commits) ? data.commits.map(c => ({
        sha: c.sha,
        message: c.commit?.message || '',
        author: c.commit?.author?.name || c.author?.login || 'inconnu',
        date: c.commit?.author?.date || null,
        url: c.html_url || null,
      })).reverse() : []; // plus récents en premier
      return { success: true, commits };
    } catch (error) {
      return { success: false, error: error.message, commits: [] };
    }
  });

  // Publie la version courante aux utilisateurs (admin uniquement côté UI).
  // Écrit update-approved.json à la racine du serveur commun.
  ipcMain.handle('app:approveUpdate', async (_event, { sha, approvedBy } = {}) => {
    try {
      if (!sha || typeof sha !== 'string') {
        return { success: false, error: 'SHA manquant' };
      }
      const serverRoot = getServerRootPath();
      if (!serverRoot || !fs.existsSync(serverRoot)) {
        return { success: false, error: 'Serveur commun inaccessible' };
      }
      const payload = {
        approvedSha: sha,
        approvedBy: approvedBy || 'inconnu',
        approvedAt: new Date().toISOString(),
      };
      fs.writeFileSync(getApprovalFilePath(), JSON.stringify(payload, null, 2), 'utf8');
      return { success: true, ...payload };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Retire la publication (supprime update-approved.json)
  ipcMain.handle('app:unapproveUpdate', async () => {
    try {
      const p = getApprovalFilePath();
      if (fs.existsSync(p)) fs.rmSync(p, { force: true });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Lit l'état d'approbation courant (sans appel GitHub)
  ipcMain.handle('app:getApprovedUpdate', async () => {
    const approval = readApprovedUpdate();
    return approval || { approvedSha: null, approvedBy: null, approvedAt: null };
  });

  ipcMain.handle('app:applyUpdate', async () => {
    const zipPath = path.join(os.tmpdir(), 'appmetier-update.zip');
    const extractDir = path.join(os.tmpdir(), 'appmetier-update');
    try {
      // 1. Téléchargement du ZIP via l'API GitHub (plus fiable, même endpoint que le check)
      await httpsDownload(`https://api.github.com/repos/${GITHUB_REPO}/zipball/main`, zipPath);

      // 2. Extraction via PowerShell (toujours disponible sur Windows)
      if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true });
      fs.mkdirSync(extractDir, { recursive: true });
      await new Promise((resolve, reject) => {
        exec(
          `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force"`,
          { timeout: 60000 },
          (err, stdout, stderr) => { if (err) reject(new Error(stderr || err.message)); else resolve(); }
        );
      });

      // 3. Copie des fichiers (sans data/, .git/, node_modules/, tessdata/, .next/)
      // Le zipball API crée un dossier nommé "Owner-Repo-SHA", on prend le premier dossier trouvé
      const extractedItems = fs.readdirSync(extractDir);
      const extractedFolder = extractedItems.find(f => fs.statSync(path.join(extractDir, f)).isDirectory());
      if (!extractedFolder) throw new Error('Dossier extrait introuvable');
      const sourceDir = path.join(extractDir, extractedFolder);
      const changedFiles = copyDir(sourceDir, __dirname);

      // 4. Détection rebuild/install nécessaire → flag lu par launcher.bat
      const { needsInstall, needsRebuild } = detectPostUpdateActions(changedFiles);
      try {
        const flag = {
          needsInstall,
          needsRebuild,
          appliedAt: new Date().toISOString(),
          changedFileCount: changedFiles.length,
        };
        fs.writeFileSync(path.join(dataFolder, 'post-update.flag'), JSON.stringify(flag, null, 2), 'utf8');
        console.log('[Update] Flag post-update:', flag);
      } catch (e) {
        console.warn('[Update] Impossible d\'écrire post-update.flag:', e.message);
      }

      // 5. Sauvegarde du SHA pour la prochaine comparaison
      try {
        const body = await httpsGet(`https://api.github.com/repos/${GITHUB_REPO}/commits/main`);
        const sha = JSON.parse(body).sha;
        if (sha) fs.writeFileSync(path.join(dataFolder, 'app-version.txt'), sha);
      } catch {}

      // 6. Nettoyage
      try { fs.rmSync(zipPath, { force: true }); } catch {}
      try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch {}

      // 7. Redémarrage
      if (needsRebuild) {
        // Rebuild nécessaire → on démarre launcher.bat dans une nouvelle fenêtre cmd détachée.
        // launcher.bat lira post-update.flag, tuera le serveur Next.js existant,
        // refera npm install (si besoin) + next build, puis relancera l'app.
        const launcherPath = path.join(__dirname, 'launcher.bat');
        if (fs.existsSync(launcherPath)) {
          try {
            // Escape double quotes in the path (rare but possible)
            const safeDir = __dirname.replace(/"/g, '\\"');
            exec(`start "APPMETIER" /D "${safeDir}" launcher.bat`, { cwd: __dirname });
          } catch (e) {
            console.error('[Update] Échec relance launcher.bat:', e.message);
          }
        }
        // Petit délai pour laisser cmd.exe démarrer avant qu'on quitte Electron
        setTimeout(() => app.exit(0), 800);
      } else {
        app.relaunch({ args: [__dirname] });
        app.exit(0);
      }
      return { success: true, needsInstall, needsRebuild };
    } catch (error) {
      try { fs.rmSync(zipPath, { force: true }); } catch {}
      try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch {}
      return { success: false, error: error.message };
    }
  });
}
// ── INTÉGRITÉ : vérification anti-tampering au démarrage ──
const INTEGRITY_FILE = path.join(__dirname, '.integrity')
const CRITICAL_FILES = ['main.js', 'preload.js', 'package.json']

function computeFileHash(filePath) {
  try {
    const content = fs.readFileSync(filePath)
    return crypto.createHash('sha256').update(content).digest('hex')
  } catch { return null }
}

function generateIntegrityManifest() {
  const manifest = {}
  CRITICAL_FILES.forEach(f => {
    const fp = path.join(__dirname, f)
    const hash = computeFileHash(fp)
    if (hash) manifest[f] = hash
  })
  fs.writeFileSync(INTEGRITY_FILE, JSON.stringify(manifest, null, 2), 'utf8')
  return manifest
}

function verifyIntegrity() {
  if (!fs.existsSync(INTEGRITY_FILE)) return { valid: true, missing: true }
  try {
    const manifest = JSON.parse(fs.readFileSync(INTEGRITY_FILE, 'utf8'))
    const tampered = []
    for (const [file, expectedHash] of Object.entries(manifest)) {
      const currentHash = computeFileHash(path.join(__dirname, file))
      if (currentHash && currentHash !== expectedHash) {
        tampered.push(file)
      }
    }
    return { valid: tampered.length === 0, tampered }
  } catch { return { valid: true } }
}

app.whenReady().then(async () => {
  setupIpcHandlers()

  // ── Vérification d'intégrité en production ──
  if (IS_PRODUCTION) {
    const integrity = verifyIntegrity()
    if (!integrity.valid) {
      console.error('⚠️ ALERTE INTÉGRITÉ : fichiers modifiés détectés :', integrity.tampered)
      dialog.showMessageBoxSync({
        type: 'warning',
        title: 'Alerte de sécurité',
        message: 'Des fichiers de l\'application semblent avoir été modifiés.\nCette version pourrait ne pas être authentique.',
        buttons: ['Continuer quand même', 'Quitter'],
        defaultId: 1,
        cancelId: 1,
      })
    }
  }


  createWindow()

  // ── Gestion veille/réveil : redémarrer les watchers réseau après le réveil ──
  powerMonitor.on('resume', () => {
    console.log('💤 Retour de veille détecté, redémarrage des watchers dans 3s...')
    setTimeout(() => {
      startEventsWatcher()
    }, 3000)
  })
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
