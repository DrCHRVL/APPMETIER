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
// Sauvegarde non bloquante : écriture asynchrone + atomique (tmp → rename) pour
// éviter de geler le main process pendant l'écriture du JSON et pour protéger
// le fichier d'une corruption en cas de crash en cours d'écriture. Le cache
// mémoire est mis à jour immédiatement pour que les `getData` qui suivent
// n'attendent pas la fin du write disque.
async function saveData(data) {
  _dataCache = data
  const tmpPath = userDataPath + '.tmp'
  try {
    await fs.promises.writeFile(tmpPath, JSON.stringify(data))
    await fs.promises.rename(tmpPath, userDataPath)
    return true
  } catch (error) {
    console.error('Erreur de sauvegarde:', error)
    _dataCache = null
    try { await fs.promises.unlink(tmpPath) } catch {}
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

// Timeouts spécifiques au réseau (SMB peut être lent ou injoignable). Au-delà,
// la promesse rejette et la couche appelante traite ça comme un échec
// silencieux (le `try/catch` des handlers retourne false / []).
const NET_READ_TIMEOUT_MS = 2000
const NET_WRITE_TIMEOUT_MS = 3000

// Race une promesse contre un timeout. L'opération sous-jacente continue
// d'exister en arrière-plan, on ne fait qu'arrêter d'attendre — ce qui suffit
// à débloquer le main process et la file IPC.
function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout ${label} (${ms}ms)`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

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

// ── DÉTECTEUR D'ÉTAT RÉSEAU ────────────────────────────────────────────────
// Sonde périodique du partage SMB pour adapter le comportement de l'app à la
// latence réelle. Trois états :
//   - 'healthy'      : latence < 800ms, opérations réseau normales
//   - 'slow'         : 800ms ≤ latence ≤ 3s, on continue mais l'UI prévient
//   - 'unreachable'  : latence > 3s ou échec, on suspend les pushes (outbox)
//
// La sonde fait un fs.stat sur le dossier events/, opération minimale qui
// reflète bien la latence d'accès SMB sans charge supplémentaire.

const NETWORK_PROBE_INTERVAL_MS = 20_000
const NETWORK_HEALTHY_MAX_MS = 800
const NETWORK_SLOW_MAX_MS = 3000

let _networkStatus = { state: 'healthy', latency: 0, lastProbeAt: 0 }
let _networkProbeTimer = null

async function probeNetwork() {
  const start = Date.now()
  try {
    const dir = path.join(getGeneralServerPath(), 'events')
    // readdir plutôt que stat : SMB met fréquemment en cache les métadonnées
    // de répertoire (stat retourne en quelques ms même quand les vraies
    // opérations sont lentes). readdir doit lister, ce qui reflète bien la
    // latence réelle d'accès au partage.
    await withTimeout(
      fs.promises.readdir(dir).catch(err => {
        if (err.code === 'ENOENT') return []
        throw err
      }),
      NETWORK_SLOW_MAX_MS,
      'probeNetwork'
    )
    const latency = Date.now() - start
    const state = latency <= NETWORK_HEALTHY_MAX_MS ? 'healthy' : 'slow'
    return { state, latency, lastProbeAt: Date.now() }
  } catch {
    return { state: 'unreachable', latency: Date.now() - start, lastProbeAt: Date.now() }
  }
}

async function runNetworkProbe() {
  const previousState = _networkStatus.state
  const next = await probeNetwork()
  const changed =
    next.state !== previousState ||
    Math.abs(next.latency - _networkStatus.latency) > 200
  _networkStatus = next
  if (changed && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('network:status', _networkStatus)
  }
  // Si on revient à un état utilisable depuis 'unreachable', vider l'outbox.
  if (previousState === 'unreachable' && next.state !== 'unreachable') {
    flushOutbox().catch(() => {})
  }
}

function startNetworkMonitor() {
  if (_networkProbeTimer) return
  runNetworkProbe()
  _networkProbeTimer = setInterval(runNetworkProbe, NETWORK_PROBE_INTERVAL_MS)
  // Démarrer aussi le flusher de l'outbox : il a besoin du même cycle de vie.
  startOutboxFlusher()
}

function stopNetworkMonitor() {
  if (_networkProbeTimer) {
    clearInterval(_networkProbeTimer)
    _networkProbeTimer = null
  }
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

// ── OUTBOX ÉVÉNEMENTS PARTAGÉS ─────────────────────────────────────────────
// File d'attente locale pour les événements à pousser sur le partage SMB.
// Permet de découpler l'expérience utilisateur de la latence réseau :
//   - L'enqueue est instantané (ajout en mémoire + persistance locale).
//   - Le flush vers events/ tourne en arrière-plan.
//   - Si le réseau est injoignable, les events s'accumulent localement
//     jusqu'au retour du réseau, puis se vident automatiquement.
//
// Persistance : pending-events.json dans dataFolder local (PAS sur le réseau).
// Garantit zéro perte y compris en cas de crash : au prochain démarrage on
// reprend la file là où elle était.

const OUTBOX_PATH = path.join(dataFolder, 'pending-events.json')
const OUTBOX_FLUSH_INTERVAL_MS = 30_000

let _outboxQueue = []
let _outboxLoaded = false
let _outboxFlushing = false
let _outboxFlushTimer = null

async function loadOutbox() {
  if (_outboxLoaded) return
  _outboxLoaded = true
  try {
    const raw = await fs.promises.readFile(OUTBOX_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed?.events)) _outboxQueue = parsed.events
  } catch {
    // Fichier absent ou illisible → on part d'une file vide.
    _outboxQueue = []
  }
}

async function persistOutbox() {
  // Écriture locale uniquement, atomique (tmp + rename) pour éviter la
  // corruption de la file en cas de crash entre l'écriture et le rename.
  const tmp = OUTBOX_PATH + '.tmp'
  try {
    await fs.promises.writeFile(tmp, JSON.stringify({ events: _outboxQueue }), 'utf8')
    await fs.promises.rename(tmp, OUTBOX_PATH)
  } catch (error) {
    console.error('❌ Outbox persist error:', error.message)
    try { await fs.promises.unlink(tmp) } catch {}
  }
}

async function flushOutbox() {
  if (_outboxFlushing) return
  if (_networkStatus.state === 'unreachable') return
  if (_outboxQueue.length === 0) return

  _outboxFlushing = true
  try {
    while (_outboxQueue.length > 0) {
      // Re-vérifier l'état réseau à chaque itération : si le réseau bascule
      // en 'unreachable' au milieu du flush, on s'arrête proprement.
      if (_networkStatus.state === 'unreachable') break

      const event = _outboxQueue[0]
      try {
        const dir = ensureDir(path.join(getGeneralServerPath(), 'events'))
        const filePath = path.join(dir, `${event.id}.json`)
        await withTimeout(
          fs.promises.writeFile(filePath, JSON.stringify(event), 'utf8'),
          NET_WRITE_TIMEOUT_MS,
          'outbox flush'
        )
        // Succès : retirer de la file et persister.
        _outboxQueue.shift()
        await persistOutbox()
      } catch {
        // Échec : on garde l'event en tête de file et on s'arrête. La
        // prochaine sonde réseau ou le timer de fallback retentera.
        break
      }
    }
  } finally {
    _outboxFlushing = false
  }
}

async function enqueueOutbox(event) {
  await loadOutbox()
  _outboxQueue.push(event)
  await persistOutbox()
  // Tentative de flush immédiate (fire-and-forget). Si le réseau est sain
  // ça part tout de suite ; sinon ça restera dans la file.
  flushOutbox().catch(() => {})
}

function startOutboxFlusher() {
  if (_outboxFlushTimer) return
  loadOutbox().then(() => flushOutbox().catch(() => {}))
  // Filet de sécurité : retenter périodiquement même si aucun changement
  // d'état réseau n'est intervenu (ex. un timeout silencieux).
  _outboxFlushTimer = setInterval(() => {
    flushOutbox().catch(() => {})
  }, OUTBOX_FLUSH_INTERVAL_MS)
}

function startEventsWatcher() {
  try {
    const dir = ensureDir(path.join(getGeneralServerPath(), 'events'))
    stopEventsWatcher()
    eventsWatcher = fs.watch(dir, async (eventType, filename) => {
      if (eventType !== 'rename' || !filename || !filename.endsWith('.json')) return
      const filePath = path.join(dir, filename)
      try {
        const raw = await withTimeout(
          fs.promises.readFile(filePath, 'utf8'),
          NET_READ_TIMEOUT_MS,
          'watcher readFile'
        )
        const content = JSON.parse(raw)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('sharedEvent:received', content)
        }
      } catch {
        // Le fichier peut avoir disparu (rename de suppression), être en cours
        // d'écriture, ou le réseau peut être lent — on ignore silencieusement.
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

  // Ouverture d'une URL http(s) dans le navigateur par défaut.
  // Restreint aux schémas http/https pour éviter d'exécuter file://, javascript:, etc.
  ipcMain.handle('open:externalUrl', async (event, url) => {
    try {
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
        console.error('URL externe refusée (schéma non autorisé):', url)
        return false
      }
      await shell.openExternal(url)
      return true
    } catch (error) {
      console.error('Erreur lors de l\'ouverture de l\'URL externe:', error)
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
    if (skipIfUnreachable()) return false
    try {
      await withTimeout(
        fs.promises.access(COMMON_SERVER_PATH, fs.constants.F_OK),
        NET_READ_TIMEOUT_MS,
        'dataSync:checkAccess'
      )
      return true
    } catch {
      return false
    }
  });

  ipcMain.handle('dataSync:pull', async () => {
    if (skipIfUnreachable()) return null
    try {
      const dataContent = await withTimeout(
        fs.promises.readFile(DATA_SYNC_PATH, 'utf8').catch(err => {
          if (err.code === 'ENOENT') return ''
          throw err
        }),
        NET_READ_TIMEOUT_MS,
        'dataSync:pull data'
      );
      if (!dataContent || !dataContent.trim()) return null;
      const data = JSON.parse(dataContent);
      let metadata = null;
      try {
        const metadataContent = await withTimeout(
          fs.promises.readFile(DATA_SYNC_METADATA_PATH, 'utf8'),
          NET_READ_TIMEOUT_MS,
          'dataSync:pull meta'
        );
        if (metadataContent && metadataContent.trim()) metadata = JSON.parse(metadataContent);
      } catch {
        // Pas de metadata, OK
      }
      return { data, metadata };
    } catch (error) {
      console.error('❌ DataSync: Erreur lecture serveur:', error.message);
      throw new Error(`Erreur lecture serveur: ${error.message}`);
    }
  });

  ipcMain.handle('dataSync:push', async (event, data, metadata) => {
    if (skipIfUnreachable()) {
      throw new Error('Serveur injoignable, push reporté');
    }
    try {
      await Promise.all([
        withTimeout(
          fs.promises.writeFile(DATA_SYNC_PATH, JSON.stringify(data), 'utf8'),
          NET_WRITE_TIMEOUT_MS,
          'dataSync:push data'
        ),
        withTimeout(
          fs.promises.writeFile(DATA_SYNC_METADATA_PATH, JSON.stringify(metadata), 'utf8'),
          NET_WRITE_TIMEOUT_MS,
          'dataSync:push meta'
        ),
      ]);
      return true;
    } catch (error) {
      console.error('❌ DataSync: Erreur envoi serveur:', error.message);
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
   * Liste les fichiers backup présents dans admin/backups/ (les nouveaux
   * fichiers : user-preferences-*, contentieux-alerts-*, tag-data-*,
   * audience-data-*, alerts-data-*, deleted-ids-*). Retourne une liste
   * d'objets { filename, kind, identifier, timestamp } pour faciliter
   * l'affichage groupé. Le tri est du plus récent au plus ancien.
   */
  ipcMain.handle('dataSync:listAdminBackups', async () => {
    try {
      const backupDir = globalBackupDir()
      if (!fs.existsSync(backupDir)) return []
      const files = fs.readdirSync(backupDir)
      const parsed = []
      const pattern = /^(user-preferences|contentieux-alerts|tag-data|audience-data|alerts-data|deleted-ids|cartographie-overlays)(?:-(.+?))?-(\d{4}-\d{2}-\d{2}T[\d.\-]+Z)\.json$/
      for (const f of files) {
        const m = f.match(pattern)
        if (!m) continue
        parsed.push({
          filename: f,
          kind: m[1],
          identifier: m[2] || null,
          timestamp: m[3].replace(/-/g, ':').replace('T', 'T').replace(/^(.{10}):/, '$1T'),
          rawTimestamp: m[3],
        })
      }
      parsed.sort((a, b) => (a.rawTimestamp < b.rawTimestamp ? 1 : -1))
      return parsed
    } catch (error) {
      console.error('❌ DataSync: Erreur listage admin/backups:', error)
      return []
    }
  })

  /**
   * Restaure un backup admin vers son emplacement d'origine. La destination
   * est déduite du nom de fichier :
   *   - user-preferences-{user}-{ts}.json → user-preferences/{user}.json
   *   - contentieux-alerts-{id}-{ts}.json → contentieux-alerts/{id}.json
   *   - tag-data-{ts}.json                → tag-data.json
   *   - audience-data-{ts}.json           → audience-data.json
   *   - alerts-data-{ts}.json             → alerts-data.json
   *   - deleted-ids-{ts}.json             → deleted-ids.json
   * Avant écriture, l'état actuel est lui-même sauvegardé dans admin/backups/
   * pour pouvoir revenir en arrière.
   */
  ipcMain.handle('dataSync:restoreAdminBackup', async (event, filename) => {
    try {
      if (!filename || typeof filename !== 'string') return false
      // Sécurité : pas de path traversal, fichier doit exister dans admin/backups/
      if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) return false
      const backupDir = globalBackupDir()
      const sourcePath = path.join(backupDir, filename)
      if (!fs.existsSync(sourcePath)) {
        console.error(`❌ DataSync: backup introuvable : ${filename}`)
        return false
      }

      const pattern = /^(user-preferences|contentieux-alerts|tag-data|audience-data|alerts-data|deleted-ids|cartographie-overlays)(?:-(.+?))?-(\d{4}-\d{2}-\d{2}T[\d.\-]+Z)\.json$/
      const m = filename.match(pattern)
      if (!m) {
        console.error(`❌ DataSync: nom de backup non reconnu : ${filename}`)
        return false
      }
      const kind = m[1]
      const identifier = m[2]

      let destPath = null
      let backupBaseName = null
      if (kind === 'user-preferences' && identifier) {
        const safe = sanitizeUsername(identifier)
        if (!safe) return false
        const folder = userPrefsFolder()
        if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true })
        destPath = path.join(folder, `${safe}.json`)
        backupBaseName = `user-preferences-${safe}`
      } else if (kind === 'contentieux-alerts' && identifier) {
        const safe = sanitizeContentieuxId(identifier)
        if (!safe) return false
        const folder = contentieuxAlertsFolder()
        if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true })
        destPath = path.join(folder, `${safe}.json`)
        backupBaseName = `contentieux-alerts-${safe}`
      } else if (kind === 'tag-data' || kind === 'audience-data' || kind === 'alerts-data' || kind === 'deleted-ids' || kind === 'cartographie-overlays') {
        destPath = path.join(COMMON_SERVER_PATH, `${kind}.json`)
        backupBaseName = kind
      } else {
        console.error(`❌ DataSync: type de backup non géré : ${kind}`)
        return false
      }

      // Backup de l'état courant avant écrasement.
      if (fs.existsSync(destPath)) {
        const ts = new Date().toISOString().replace(/:/g, '-')
        fs.copyFileSync(destPath, path.join(backupDir, `${backupBaseName}-${ts}.json`))
        pruneGlobalBackups(backupBaseName, 10)
      }

      fs.copyFileSync(sourcePath, destPath)
      console.log(`✅ DataSync: backup admin restauré → ${destPath}`)
      return true
    } catch (error) {
      console.error('❌ DataSync: Erreur restauration admin backup:', error)
      return false
    }
  })

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
  // Retourne un statut explicite pour que le client puisse distinguer
  // "fichier absent" (légitime → init par défaut) de "serveur injoignable"
  // (transitoire → ne PAS écraser le users.json existant).
  ipcMain.handle('dataSync:pullUsersConfig', async () => {
    if (skipIfUnreachable()) return { status: 'unreachable' }
    let fileMissing = false
    try {
      const content = await withTimeout(
        fs.promises.readFile(USERS_CONFIG_PATH, 'utf8').catch(err => {
          if (err.code === 'ENOENT') {
            fileMissing = true
            return ''
          }
          throw err
        }),
        NET_READ_TIMEOUT_MS,
        'pullUsersConfig'
      )
      if (fileMissing) return { status: 'missing' }
      if (!content || !content.trim()) return { status: 'missing' }
      return { status: 'ok', config: JSON.parse(content) }
    } catch (error) {
      console.error('❌ MultiSync: Erreur lecture users.json:', error.message)
      return { status: 'unreachable', error: error.message }
    }
  })

  ipcMain.handle('dataSync:pushUsersConfig', async (event, config) => {
    if (skipIfUnreachable()) return false
    try {
      const backupPath = path.join(COMMON_SERVER_PATH, 'admin', 'backups')
      await withTimeout(
        fs.promises.mkdir(backupPath, { recursive: true }).catch(() => {}),
        NET_WRITE_TIMEOUT_MS,
        'pushUsersConfig mkdir'
      )
      // Backup non bloquant : si users.json n'existe pas, copyFile rejette
      // ENOENT et on continue.
      try {
        const timestamp = new Date().toISOString().replace(/:/g, '-')
        await withTimeout(
          fs.promises.copyFile(USERS_CONFIG_PATH, path.join(backupPath, `users-${timestamp}.json`)),
          NET_WRITE_TIMEOUT_MS,
          'pushUsersConfig copy'
        )
      } catch {
        // Premier write
      }
      await withTimeout(
        fs.promises.writeFile(USERS_CONFIG_PATH, JSON.stringify(config), 'utf8'),
        NET_WRITE_TIMEOUT_MS,
        'pushUsersConfig write'
      )
      return true
    } catch (error) {
      console.error('❌ MultiSync: Erreur écriture users.json:', error.message)
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

  // Si l'état réseau est 'unreachable' on ne tente même pas l'opération : le
  // moniteur a déjà constaté que le partage ne répond pas. Économise un
  // timeout complet (jusqu'à NET_*_TIMEOUT_MS bloqué) à chaque appel.
  const skipIfUnreachable = () => _networkStatus.state === 'unreachable'

  const readGlobalFile = async (name) => {
    if (skipIfUnreachable()) return null
    try {
      const filePath = globalFilePath(name)
      const content = await withTimeout(
        fs.promises.readFile(filePath, 'utf8').catch(err => {
          if (err.code === 'ENOENT') return ''
          throw err
        }),
        NET_READ_TIMEOUT_MS,
        `readGlobalFile ${name}`
      )
      if (!content || !content.trim()) return null
      return JSON.parse(content)
    } catch (error) {
      console.error(`❌ GlobalSync: Erreur lecture ${name}:`, error.message)
      return null
    }
  }

  const writeGlobalFile = async (name, payload) => {
    if (skipIfUnreachable()) {
      throw new Error('Serveur commun injoignable (réseau)')
    }
    const filePath = globalFilePath(name)
    const backupDir = globalBackupDir()
    // mkdir -p : pas d'erreur si le dossier existe déjà.
    await withTimeout(
      fs.promises.mkdir(backupDir, { recursive: true }).catch(() => {}),
      NET_WRITE_TIMEOUT_MS,
      `writeGlobalFile mkdir ${name}`
    )
    // Backup non bloquant : si le fichier n'existe pas, copyFile échoue avec
    // ENOENT, on continue. Sinon copie avant écriture.
    try {
      const timestamp = new Date().toISOString().replace(/:/g, '-')
      const base = name.replace(/\.json$/i, '')
      await withTimeout(
        fs.promises.copyFile(filePath, path.join(backupDir, `${base}-${timestamp}.json`)),
        NET_WRITE_TIMEOUT_MS,
        `writeGlobalFile copy ${name}`
      )
    } catch {
      // Pas de fichier source → premier write, normal
    }
    await withTimeout(
      fs.promises.writeFile(filePath, JSON.stringify(payload), 'utf8'),
      NET_WRITE_TIMEOUT_MS,
      `writeGlobalFile write ${name}`
    )
    return true
  }

  // Nettoyage : on ne garde que les N backups les plus récents par type.
  // Async + non bloquant : si le réseau est lent, on abandonne et on retentera
  // au prochain push. Pas critique.
  const pruneGlobalBackups = async (basename, keep = 20) => {
    if (skipIfUnreachable()) return
    try {
      const backupDir = globalBackupDir()
      const allFiles = await withTimeout(
        fs.promises.readdir(backupDir).catch(err => { if (err.code === 'ENOENT') return []; throw err }),
        NET_READ_TIMEOUT_MS,
        `pruneGlobalBackups readdir ${basename}`
      )
      if (allFiles.length === 0) return
      const prefix = `${basename}-`
      const matching = allFiles.filter(f => f.startsWith(prefix) && f.endsWith('.json'))
      if (matching.length <= keep) return
      // stat parallélisé avec timeout par opération
      const stats = await Promise.all(matching.map(async name => {
        try {
          const s = await withTimeout(
            fs.promises.stat(path.join(backupDir, name)),
            NET_READ_TIMEOUT_MS,
            `pruneGlobalBackups stat ${name}`
          )
          return { name, mtime: s.mtimeMs }
        } catch {
          return null
        }
      }))
      const sorted = stats.filter(Boolean).sort((a, b) => b.mtime - a.mtime)
      // Suppression parallèle des backups au-delà de la fenêtre de rétention
      await Promise.all(sorted.slice(keep).map(f =>
        withTimeout(
          fs.promises.unlink(path.join(backupDir, f.name)).catch(() => {}),
          NET_WRITE_TIMEOUT_MS,
          `pruneGlobalBackups unlink ${f.name}`
        ).catch(() => {})
      ))
    } catch {
      // non bloquant : les backups seront réessayés au prochain push
    }
  }

  ipcMain.handle('globalSync:pullTags', async () => {
    return await readGlobalFile('tag-data.json')
  })

  ipcMain.handle('globalSync:pushTags', async (event, payload) => {
    try {
      await writeGlobalFile('tag-data.json', payload)
      pruneGlobalBackups('tag-data').catch(() => {})
      return true
    } catch (error) {
      console.error('❌ GlobalSync: Erreur écriture tag-data.json:', error.message)
      return false
    }
  })

  ipcMain.handle('globalSync:pullAudience', async () => {
    return await readGlobalFile('audience-data.json')
  })

  ipcMain.handle('globalSync:pushAudience', async (event, payload) => {
    try {
      await writeGlobalFile('audience-data.json', payload)
      pruneGlobalBackups('audience-data').catch(() => {})
      return true
    } catch (error) {
      console.error('❌ GlobalSync: Erreur écriture audience-data.json:', error.message)
      return false
    }
  })

  ipcMain.handle('globalSync:pullAlerts', async () => {
    return await readGlobalFile('alerts-data.json')
  })

  ipcMain.handle('globalSync:pushAlerts', async (event, payload) => {
    try {
      await writeGlobalFile('alerts-data.json', payload)
      pruneGlobalBackups('alerts-data').catch(() => {})
      return true
    } catch (error) {
      console.error('❌ GlobalSync: Erreur écriture alerts-data.json:', error.message)
      return false
    }
  })

  ipcMain.handle('globalSync:pullDeletedIds', async () => {
    return await readGlobalFile('deleted-ids.json')
  })

  ipcMain.handle('globalSync:pushDeletedIds', async (event, payload) => {
    try {
      await writeGlobalFile('deleted-ids.json', payload)
      pruneGlobalBackups('deleted-ids').catch(() => {})
      return true
    } catch (error) {
      console.error('❌ GlobalSync: Erreur écriture deleted-ids.json:', error.message)
      return false
    }
  })

  // Cartographie : annotations manuelles partagées (MEC ex nihilo, dossiers
  // ex nihilo, liens renseignement, annotations de cluster, boosts de score,
  // épinglages Top10). Tout poste qui ouvre le module récupère les ajouts
  // de ses collègues via ce fichier.
  ipcMain.handle('globalSync:pullCartographie', async () => {
    return await readGlobalFile('cartographie-overlays.json')
  })

  ipcMain.handle('globalSync:pushCartographie', async (event, payload) => {
    try {
      await writeGlobalFile('cartographie-overlays.json', payload)
      pruneGlobalBackups('cartographie-overlays').catch(() => {})
      return true
    } catch (error) {
      console.error('❌ GlobalSync: Erreur écriture cartographie-overlays.json:', error.message)
      return false
    }
  })

  // ─── Préférences utilisateur (1 fichier JSON par utilisateur) ──────────────
  // Dossier : user-preferences/{windowsUsername}.json
  // Backups : admin/backups/user-preferences-{username}-{timestamp}.json
  // Sanitize le username pour éviter tout path traversal.
  const userPrefsFolder = () => path.join(COMMON_SERVER_PATH, 'user-preferences')
  const sanitizeUsername = (u) => String(u || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64)

  ipcMain.handle('globalSync:pullUserPreferences', async (event, username) => {
    if (skipIfUnreachable()) return null
    try {
      const safe = sanitizeUsername(username)
      if (!safe) return null
      const filePath = path.join(userPrefsFolder(), `${safe}.json`)
      const content = await withTimeout(
        fs.promises.readFile(filePath, 'utf8').catch(err => {
          if (err.code === 'ENOENT') return ''
          throw err
        }),
        NET_READ_TIMEOUT_MS,
        `pullUserPreferences ${safe}`
      )
      if (!content || !content.trim()) return null
      return JSON.parse(content)
    } catch (error) {
      console.error('❌ GlobalSync: Erreur lecture user-preferences:', error.message)
      return null
    }
  })

  ipcMain.handle('globalSync:pushUserPreferences', async (event, username, payload) => {
    if (skipIfUnreachable()) return false
    try {
      const safe = sanitizeUsername(username)
      if (!safe) return false
      const folder = userPrefsFolder()
      const filePath = path.join(folder, `${safe}.json`)
      const backupDir = globalBackupDir()
      // mkdir parallèles, idempotents
      await Promise.all([
        withTimeout(fs.promises.mkdir(folder, { recursive: true }).catch(() => {}), NET_WRITE_TIMEOUT_MS, 'mkdir user-prefs'),
        withTimeout(fs.promises.mkdir(backupDir, { recursive: true }).catch(() => {}), NET_WRITE_TIMEOUT_MS, 'mkdir backups'),
      ])
      // Backup non bloquant
      try {
        const timestamp = new Date().toISOString().replace(/:/g, '-')
        await withTimeout(
          fs.promises.copyFile(filePath, path.join(backupDir, `user-preferences-${safe}-${timestamp}.json`)),
          NET_WRITE_TIMEOUT_MS,
          'copy user-prefs'
        )
      } catch {
        // Premier write : pas de fichier source, normal
      }
      await withTimeout(
        fs.promises.writeFile(filePath, JSON.stringify(payload), 'utf8'),
        NET_WRITE_TIMEOUT_MS,
        `pushUserPreferences write ${safe}`
      )
      pruneGlobalBackups(`user-preferences-${safe}`, 10).catch(() => {})
      return true
    } catch (error) {
      console.error('❌ GlobalSync: Erreur écriture user-preferences:', error.message)
      return false
    }
  })

  // ─── Alertes partagées par contentieux ─────────────────────────────────────
  // Dossier : contentieux-alerts/{contentieuxId}.json
  // Backups : admin/backups/contentieux-alerts-{id}-{timestamp}.json
  // Sanitize le contentieuxId pour éviter tout path traversal.
  const contentieuxAlertsFolder = () => path.join(COMMON_SERVER_PATH, 'contentieux-alerts')
  const sanitizeContentieuxId = (id) => String(id || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64)

  ipcMain.handle('globalSync:pullContentieuxAlerts', async (event, contentieuxId) => {
    if (skipIfUnreachable()) return null
    try {
      const safe = sanitizeContentieuxId(contentieuxId)
      if (!safe) return null
      const filePath = path.join(contentieuxAlertsFolder(), `${safe}.json`)
      const content = await withTimeout(
        fs.promises.readFile(filePath, 'utf8').catch(err => {
          if (err.code === 'ENOENT') return ''
          throw err
        }),
        NET_READ_TIMEOUT_MS,
        `pullContentieuxAlerts ${safe}`
      )
      if (!content || !content.trim()) return null
      return JSON.parse(content)
    } catch (error) {
      console.error('❌ GlobalSync: Erreur lecture contentieux-alerts:', error.message)
      return null
    }
  })

  ipcMain.handle('globalSync:pushContentieuxAlerts', async (event, contentieuxId, payload) => {
    if (skipIfUnreachable()) return false
    try {
      const safe = sanitizeContentieuxId(contentieuxId)
      if (!safe) return false
      const folder = contentieuxAlertsFolder()
      const filePath = path.join(folder, `${safe}.json`)
      const backupDir = globalBackupDir()
      await Promise.all([
        withTimeout(fs.promises.mkdir(folder, { recursive: true }).catch(() => {}), NET_WRITE_TIMEOUT_MS, 'mkdir alerts'),
        withTimeout(fs.promises.mkdir(backupDir, { recursive: true }).catch(() => {}), NET_WRITE_TIMEOUT_MS, 'mkdir backups'),
      ])
      try {
        const timestamp = new Date().toISOString().replace(/:/g, '-')
        await withTimeout(
          fs.promises.copyFile(filePath, path.join(backupDir, `contentieux-alerts-${safe}-${timestamp}.json`)),
          NET_WRITE_TIMEOUT_MS,
          'copy alerts'
        )
      } catch {
        // Premier write
      }
      await withTimeout(
        fs.promises.writeFile(filePath, JSON.stringify(payload), 'utf8'),
        NET_WRITE_TIMEOUT_MS,
        `pushContentieuxAlerts write ${safe}`
      )
      pruneGlobalBackups(`contentieux-alerts-${safe}`, 10).catch(() => {})
      return true
    } catch (error) {
      console.error('❌ GlobalSync: Erreur écriture contentieux-alerts:', error.message)
      return false
    }
  })

  /**
   * Lit app-data.json racine en fallback pour la migration one-shot
   * (renvoie la clé customTags telle qu'elle existe, format legacy ou non)
   */
  ipcMain.handle('globalSync:readLegacyAppData', async () => {
    if (skipIfUnreachable()) return null
    try {
      const legacyPath = globalFilePath('app-data.json')
      const content = await withTimeout(
        fs.promises.readFile(legacyPath, 'utf8').catch(err => {
          if (err.code === 'ENOENT') return ''
          throw err
        }),
        NET_READ_TIMEOUT_MS,
        'readLegacyAppData'
      )
      if (!content || !content.trim()) return null
      return JSON.parse(content)
    } catch (error) {
      console.error('❌ GlobalSync: Erreur lecture app-data.json legacy:', error.message)
      return null
    }
  })

  /**
   * Vérifie l'accès au dossier d'un contentieux.
   * Si l'état réseau global est 'unreachable', on retourne false sans tenter
   * d'accès — évite un timeout complet à chaque sync.
   */
  ipcMain.handle('dataSync:checkContentieuxAccess', async (event, contentieuxId) => {
    if (skipIfUnreachable()) return false
    try {
      const folder = getContentieuxFolder(contentieuxId)
      if (!folder) return false
      const parentDir = path.dirname(folder)
      await withTimeout(
        fs.promises.access(parentDir, fs.constants.F_OK),
        NET_READ_TIMEOUT_MS,
        'checkContentieuxAccess'
      )
      return true
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
    if (skipIfUnreachable()) return null
    try {
      const folder = getContentieuxFolder(contentieuxId)
      const dataPath = path.join(folder, 'app-data.json')
      const content = await withTimeout(
        fs.promises.readFile(dataPath, 'utf8').catch(err => {
          if (err.code === 'ENOENT') return ''
          throw err
        }),
        NET_READ_TIMEOUT_MS,
        `pullContentieux ${contentieuxId}`
      )
      if (!content || !content.trim()) return null
      const parsed = JSON.parse(content)
      return {
        data: parsed.data || parsed,
        metadata: parsed.metadata || null
      }
    } catch (error) {
      console.error(`❌ MultiSync[${contentieuxId}]: Erreur lecture:`, error.message)
      throw new Error(`Erreur lecture serveur ${contentieuxId}: ${error.message}`)
    }
  })

  ipcMain.handle('dataSync:pushContentieux', async (event, contentieuxId, data, metadata) => {
    if (skipIfUnreachable()) {
      throw new Error(`Réseau injoignable, push ${contentieuxId} reporté`)
    }
    try {
      const folder = getContentieuxFolder(contentieuxId)
      const dataPath = path.join(folder, 'app-data.json')
      const payload = { data, metadata }
      await withTimeout(
        fs.promises.writeFile(dataPath, JSON.stringify(payload), 'utf8'),
        NET_WRITE_TIMEOUT_MS,
        `pushContentieux ${contentieuxId}`
      )
      return true
    } catch (error) {
      console.error(`❌ MultiSync[${contentieuxId}]: Erreur écriture:`, error.message)
      throw new Error(`Erreur envoi serveur ${contentieuxId}: ${error.message}`)
    }
  })

  ipcMain.handle('dataSync:backupContentieux', async (event, contentieuxId, backupFilename) => {
    if (skipIfUnreachable()) return false
    try {
      const folder = getContentieuxFolder(contentieuxId)
      const dataPath = path.join(folder, 'app-data.json')
      const backupDir = getContentieuxBackupFolder(contentieuxId)
      await withTimeout(
        fs.promises.copyFile(dataPath, path.join(backupDir, backupFilename)).catch(err => {
          if (err.code === 'ENOENT') return null
          throw err
        }),
        NET_WRITE_TIMEOUT_MS,
        `backupContentieux ${contentieuxId}`
      )
      return true
    } catch (error) {
      console.error(`❌ MultiSync[${contentieuxId}]: Erreur backup:`, error.message)
      return false
    }
  })

  /**
   * Liste les fichiers backup d'un contentieux (<contentieux>/backups/).
   * Ne retourne que les fichiers {contentieuxId}-backup-*.json, du plus récent
   * au plus ancien (le nom contient un timestamp ISO).
   */
  ipcMain.handle('dataSync:listContentieuxBackups', async (event, contentieuxId) => {
    try {
      const backupDir = getContentieuxBackupFolder(contentieuxId)
      if (!fs.existsSync(backupDir)) return []
      const prefix = `${contentieuxId}-backup-`
      return fs.readdirSync(backupDir)
        .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
        .sort()
        .reverse()
    } catch (error) {
      console.error(`❌ MultiSync[${contentieuxId}]: Erreur listage backups:`, error.message)
      return []
    }
  })

  /**
   * Lit un fichier backup d'un contentieux et retourne { data, metadata }.
   * Sécurité : seuls les {contentieuxId}-backup-*.json sont lisibles.
   */
  ipcMain.handle('dataSync:readContentieuxBackup', async (event, contentieuxId, filename) => {
    try {
      const prefix = `${contentieuxId}-backup-`
      if (!filename || !filename.startsWith(prefix) || !filename.endsWith('.json')) {
        console.error(`❌ MultiSync[${contentieuxId}]: Lecture refusée pour "${filename}" (nom non autorisé)`)
        return null
      }
      const backupDir = getContentieuxBackupFolder(contentieuxId)
      const filePath = path.join(backupDir, filename)
      if (!fs.existsSync(filePath)) {
        console.error(`❌ MultiSync[${contentieuxId}]: Backup introuvable : ${filename}`)
        return null
      }
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      // Les backups sont des copies de app-data.json, donc au format { data, metadata }.
      return {
        data: parsed.data || parsed,
        metadata: parsed.metadata || null,
      }
    } catch (error) {
      console.error(`❌ MultiSync[${contentieuxId}]: Erreur lecture backup:`, error.message)
      return null
    }
  })

  // ========================================================================
  // SYNCHRONISATION DU MODULE INSTRUCTION (privée par utilisateur)
  // ========================================================================
  // Les dossiers d'instruction sont propres à chaque magistrat. Chaque
  // utilisateur choisit son propre dossier réseau (basePath) dans les
  // paramètres ; ses dossiers y sont sauvegardés dans un fichier dédié
  // <safeUser>-instructions.json, isolé de ceux des autres utilisateurs.
  // Aucune fusion inter-utilisateurs : c'est une sauvegarde réseau + une
  // synchro multi-postes pour un seul et même utilisateur.
  const instructionFileName = (username) => `${sanitizeUsername(username)}-instructions.json`
  const instructionBackupDir = (basePath) => path.join(basePath, 'backups')

  ipcMain.handle('instructionSync:check', async (event, basePath) => {
    if (skipIfUnreachable()) return false
    try {
      if (!basePath || typeof basePath !== 'string') return false
      await withTimeout(
        fs.promises.access(basePath, fs.constants.F_OK),
        NET_READ_TIMEOUT_MS,
        'instructionSync check'
      )
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('instructionSync:pull', async (event, basePath, username) => {
    if (skipIfUnreachable()) return null
    try {
      if (!basePath || !sanitizeUsername(username)) return null
      const filePath = path.join(basePath, instructionFileName(username))
      const content = await withTimeout(
        fs.promises.readFile(filePath, 'utf8').catch(err => {
          if (err.code === 'ENOENT') return ''
          throw err
        }),
        NET_READ_TIMEOUT_MS,
        'instructionSync pull'
      )
      if (!content || !content.trim()) return null
      return JSON.parse(content)
    } catch (error) {
      console.error('❌ InstructionSync: Erreur lecture:', error.message)
      throw new Error(`Erreur lecture serveur instruction: ${error.message}`)
    }
  })

  ipcMain.handle('instructionSync:push', async (event, basePath, username, payload) => {
    if (skipIfUnreachable()) {
      throw new Error('Réseau injoignable, sauvegarde instruction reportée')
    }
    try {
      if (!basePath) throw new Error('Chemin réseau non configuré')
      if (!sanitizeUsername(username)) throw new Error('Utilisateur invalide')
      const filePath = path.join(basePath, instructionFileName(username))
      const backupDir = instructionBackupDir(basePath)
      await withTimeout(
        fs.promises.mkdir(backupDir, { recursive: true }).catch(() => {}),
        NET_WRITE_TIMEOUT_MS,
        'instructionSync mkdir'
      )
      // Backup non bloquant de la version précédente avant écrasement
      try {
        const timestamp = new Date().toISOString().replace(/:/g, '-')
        const base = instructionFileName(username).replace(/\.json$/i, '')
        await withTimeout(
          fs.promises.copyFile(filePath, path.join(backupDir, `${base}-backup-${timestamp}.json`)),
          NET_WRITE_TIMEOUT_MS,
          'instructionSync backup'
        )
      } catch {
        // Premier write : pas de fichier source, normal
      }
      await withTimeout(
        fs.promises.writeFile(filePath, JSON.stringify(payload), 'utf8'),
        NET_WRITE_TIMEOUT_MS,
        'instructionSync push'
      )
      return true
    } catch (error) {
      console.error('❌ InstructionSync: Erreur écriture:', error.message)
      throw new Error(`Erreur sauvegarde réseau instruction: ${error.message}`)
    }
  })

  ipcMain.handle('instructionSync:listBackups', async (event, basePath, username) => {
    try {
      if (!basePath || !sanitizeUsername(username)) return []
      const backupDir = instructionBackupDir(basePath)
      if (!fs.existsSync(backupDir)) return []
      const prefix = `${instructionFileName(username).replace(/\.json$/i, '')}-backup-`
      return fs.readdirSync(backupDir)
        .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
        .sort()
        .reverse()
    } catch (error) {
      console.error('❌ InstructionSync: Erreur listage backups:', error.message)
      return []
    }
  })

  ipcMain.handle('instructionSync:readBackup', async (event, basePath, username, filename) => {
    try {
      if (!basePath || !sanitizeUsername(username)) return null
      const prefix = `${instructionFileName(username).replace(/\.json$/i, '')}-backup-`
      if (!filename || !filename.startsWith(prefix) || !filename.endsWith('.json')) {
        console.error(`❌ InstructionSync: Lecture refusée pour "${filename}" (nom non autorisé)`)
        return null
      }
      const filePath = path.join(instructionBackupDir(basePath), filename)
      if (!fs.existsSync(filePath)) return null
      return JSON.parse(fs.readFileSync(filePath, 'utf8'))
    } catch (error) {
      console.error('❌ InstructionSync: Erreur lecture backup:', error.message)
      return null
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
      await withTimeout(
        fs.promises.writeFile(filePath, JSON.stringify(heartbeat), 'utf8'),
        NET_WRITE_TIMEOUT_MS,
        'heartbeat:write'
      )
      return true
    } catch (error) {
      console.error('❌ Heartbeat write error:', error.message)
      return false
    }
  })

  ipcMain.handle('heartbeat:remove', async (event, username) => {
    try {
      const filePath = path.join(getGeneralServerPath(), 'heartbeats', `${username}.json`)
      await withTimeout(
        fs.promises.unlink(filePath).catch(err => { if (err.code !== 'ENOENT') throw err }),
        NET_WRITE_TIMEOUT_MS,
        'heartbeat:remove'
      )
      return true
    } catch (error) {
      console.error('❌ Heartbeat remove error:', error.message)
      return false
    }
  })

  ipcMain.handle('heartbeat:readAll', async () => {
    try {
      const dir = path.join(getGeneralServerPath(), 'heartbeats')
      const files = await withTimeout(
        fs.promises.readdir(dir).catch(err => { if (err.code === 'ENOENT') return []; throw err }),
        NET_READ_TIMEOUT_MS,
        'heartbeat:readAll readdir'
      )
      const jsonFiles = files.filter(f => f.endsWith('.json'))
      // Lectures parallèles avec timeout global cumulé via Promise.all + map(withTimeout)
      const reads = jsonFiles.map(file =>
        withTimeout(
          fs.promises.readFile(path.join(dir, file), 'utf8'),
          NET_READ_TIMEOUT_MS,
          `heartbeat:readAll ${file}`
        ).then(content => JSON.parse(content)).catch(() => null)
      )
      const results = await Promise.all(reads)
      return results.filter(r => r !== null)
    } catch (error) {
      console.error('❌ Heartbeat readAll error:', error.message)
      return []
    }
  })

  // ── ÉVÉNEMENTS PARTAGÉS ──

  // L'écriture d'un event passe désormais par l'outbox : retour instantané
  // à l'utilisateur, push réseau en arrière-plan avec retry automatique.
  ipcMain.handle('sharedEvent:write', async (event, sharedEvent) => {
    try {
      await enqueueOutbox(sharedEvent)
      return true
    } catch (error) {
      console.error('❌ SharedEvent enqueue error:', error.message)
      return false
    }
  })

  ipcMain.handle('sharedEvent:cleanup', async (event, ttlMs) => {
    try {
      const dir = path.join(getGeneralServerPath(), 'events')
      const files = await withTimeout(
        fs.promises.readdir(dir).catch(err => { if (err.code === 'ENOENT') return []; throw err }),
        NET_READ_TIMEOUT_MS,
        'sharedEvent:cleanup readdir'
      )
      const now = Date.now()
      const jsonFiles = files.filter(f => f.endsWith('.json'))
      // Lecture + suppression en parallèle, chaque opération avec son propre timeout
      await Promise.all(jsonFiles.map(async file => {
        const filePath = path.join(dir, file)
        try {
          const raw = await withTimeout(
            fs.promises.readFile(filePath, 'utf8'),
            NET_READ_TIMEOUT_MS,
            `sharedEvent:cleanup read ${file}`
          )
          const content = JSON.parse(raw)
          if (now - new Date(content.timestamp).getTime() > ttlMs) {
            await withTimeout(
              fs.promises.unlink(filePath),
              NET_WRITE_TIMEOUT_MS,
              `sharedEvent:cleanup unlink ${file}`
            )
          }
        } catch {}
      }))
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

  // Lecture en lot des événements partagés récents (sync prioritaire au lancement).
  // Le watcher ne voit que les nouveaux fichiers (rename) ; au démarrage on doit
  // récupérer ce qui existe déjà dans events/ pour rattraper l'activité des
  // collègues. Plafonné à 8 s : au-delà on rend la main et le watcher prendra
  // le relais en arrière-plan.
  ipcMain.handle('sharedEvent:readRecent', async (event, maxAgeMs) => {
    const LAUNCH_SYNC_BUDGET_MS = 8000
    const start = Date.now()
    try {
      const dir = path.join(getGeneralServerPath(), 'events')
      const files = await withTimeout(
        fs.promises.readdir(dir).catch(err => { if (err.code === 'ENOENT') return []; throw err }),
        NET_READ_TIMEOUT_MS,
        'sharedEvent:readRecent readdir'
      )
      const jsonFiles = files.filter(f => f.endsWith('.json'))
      const cutoff = Date.now() - (maxAgeMs || 24 * 60 * 60 * 1000)
      const events = []
      // Lectures parallèles, mais on s'interrompt si on dépasse le budget global.
      const reads = jsonFiles.map(file =>
        withTimeout(
          fs.promises.readFile(path.join(dir, file), 'utf8'),
          NET_READ_TIMEOUT_MS,
          `sharedEvent:readRecent ${file}`
        ).then(raw => {
          if (Date.now() - start > LAUNCH_SYNC_BUDGET_MS) return null
          const content = JSON.parse(raw)
          const ts = new Date(content.timestamp).getTime()
          if (ts >= cutoff) return content
          return null
        }).catch(() => null)
      )
      const results = await withTimeout(
        Promise.all(reads),
        LAUNCH_SYNC_BUDGET_MS,
        'sharedEvent:readRecent global'
      ).catch(() => [])
      for (const r of results) if (r) events.push(r)
      events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      return { events, partial: Date.now() - start > LAUNCH_SYNC_BUDGET_MS }
    } catch (error) {
      console.error('❌ SharedEvent readRecent error:', error.message)
      return { events: [], partial: true }
    }
  })

  // Sonde réseau à la demande (utilisée par le renderer au démarrage).
  ipcMain.handle('network:probe', async () => {
    return probeNetwork()
  })

  // Démarrer / arrêter le moniteur réseau (appelé après login).
  ipcMain.handle('network:startMonitor', async () => {
    startNetworkMonitor()
    return _networkStatus
  })

  ipcMain.handle('network:stopMonitor', async () => {
    stopNetworkMonitor()
    return true
  })

  ipcMain.handle('network:getStatus', async () => {
    return _networkStatus
  })

  // ── JOURNAL D'AUDIT ──

  ipcMain.handle('auditLog:append', async (event, entry, maxEntries) => {
    try {
      const dir = ensureDir(path.join(getGeneralServerPath(), 'audit'))
      const filePath = path.join(dir, 'audit_log.json')
      let entries = []
      try {
        const raw = await withTimeout(
          fs.promises.readFile(filePath, 'utf8'),
          NET_READ_TIMEOUT_MS,
          'auditLog:append read'
        )
        entries = JSON.parse(raw)
      } catch {
        // Fichier absent, illisible ou réseau lent → on repart de []
      }
      entries.unshift(entry)
      if (entries.length > maxEntries) {
        entries.length = maxEntries
      }
      await withTimeout(
        fs.promises.writeFile(filePath, JSON.stringify(entries), 'utf8'),
        NET_WRITE_TIMEOUT_MS,
        'auditLog:append write'
      )
      return true
    } catch (error) {
      console.error('❌ AuditLog append error:', error.message)
      return false
    }
  })

  ipcMain.handle('auditLog:read', async () => {
    try {
      const filePath = path.join(getGeneralServerPath(), 'audit', 'audit_log.json')
      const raw = await withTimeout(
        fs.promises.readFile(filePath, 'utf8').catch(err => {
          if (err.code === 'ENOENT') return '[]'
          throw err
        }),
        NET_READ_TIMEOUT_MS,
        'auditLog:read'
      )
      return JSON.parse(raw)
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
