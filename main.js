const path = require('path')
const fs = require('fs')
const os = require('os')
const https = require('https')
const { exec } = require('child_process')
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
// Ajout pour l'extraction PDF
const pdfParse = require('pdf-parse')
const tesseract = require('tesseract.js')
console.log('User Data Path:', app.getPath('userData'));
// Création des dossiers pour les données
const dataFolder = path.join(__dirname, 'data')
const casiersFolder = path.join(dataFolder, 'casiers')
const backupsFolder = path.join(dataFolder, 'backups')
const documentsEnquetesFolder = path.join(dataFolder, 'documentenquete')
const userDataPath = path.join(dataFolder, 'data.json')
// Chemin serveur commun (utilisé pour documents ET sync des données)
const COMMON_SERVER_PATH = "P:\\TGI\\Parquet\\P17 - STUP - CRIM ORG\\GESTION DE SERVICE\\10_App METIER"
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
// Fonction pour charger toutes les données
function loadData() {
  try {
    return fs.existsSync(userDataPath)
      ? JSON.parse(fs.readFileSync(userDataPath, 'utf8'))
      : {}
  } catch (error) {
    console.error('Erreur de chargement:', error)
    return {}
  }
}
// Fonction pour sauvegarder toutes les données
function saveData(data) {
  try {
    fs.writeFileSync(userDataPath, JSON.stringify(data, null, 2))
    return true
  } catch (error) {
    console.error('Erreur de sauvegarde:', error)
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
  mainWindow.webContents.openDevTools()
  mainWindow.loadURL('http://localhost:3000')
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

  // === MISE À JOUR DE L'APPLICATION (GitHub API + ZIP, sans git) ===

  const GITHUB_REPO = 'DrCHRVL/APPMETIER';
  const SKIP_ON_UPDATE = new Set(['data', '.git', 'node_modules', 'tessdata', '.next']);

  // Requête HTTPS avec suivi de redirections, retourne le corps en texte
  function httpsGet(url) {
    return new Promise((resolve, reject) => {
      const makeRequest = (currentUrl) => {
        https.get(currentUrl, { headers: { 'User-Agent': 'APPMETIER-updater' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            makeRequest(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve(data));
          res.on('error', reject);
        }).on('error', reject);
      };
      makeRequest(url);
    });
  }

  // Téléchargement binaire avec suivi de redirections
  function httpsDownload(url, destPath) {
    return new Promise((resolve, reject) => {
      const makeRequest = (currentUrl) => {
        https.get(currentUrl, { headers: { 'User-Agent': 'APPMETIER-updater' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            makeRequest(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          const file = fs.createWriteStream(destPath);
          res.pipe(file);
          file.on('finish', () => file.close(resolve));
          file.on('error', reject);
          res.on('error', reject);
        }).on('error', reject);
      };
      makeRequest(url);
    });
  }

  // Lit le SHA local depuis app-version.txt ou depuis les fichiers .git
  function getLocalSha() {
    const versionFile = path.join(dataFolder, 'app-version.txt');
    if (fs.existsSync(versionFile)) {
      return fs.readFileSync(versionFile, 'utf8').trim();
    }
    for (const ref of ['main', 'master']) {
      const refPath = path.join(__dirname, '.git', 'refs', 'heads', ref);
      if (fs.existsSync(refPath)) {
        return fs.readFileSync(refPath, 'utf8').trim();
      }
    }
    return null;
  }

  // Copie récursive d'un dossier source vers dest, en ignorant SKIP_ON_UPDATE
  function copyDir(src, dest) {
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (SKIP_ON_UPDATE.has(entry.name)) continue;
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  ipcMain.handle('app:checkUpdate', async () => {
    try {
      const body = await httpsGet(`https://api.github.com/repos/${GITHUB_REPO}/commits/main`);
      const data = JSON.parse(body);
      const remoteSha = data.sha;
      if (!remoteSha) return { hasUpdate: false, commits: 0, error: 'SHA distant non trouvé' };
      const localSha = getLocalSha();
      const hasUpdate = localSha !== remoteSha;
      return { hasUpdate, commits: hasUpdate ? 1 : 0 };
    } catch (error) {
      return { hasUpdate: false, commits: 0, error: error.message };
    }
  });

  ipcMain.handle('app:applyUpdate', async () => {
    const zipPath = path.join(os.tmpdir(), 'appmetier-update.zip');
    const extractDir = path.join(os.tmpdir(), 'appmetier-update');
    try {
      // 1. Téléchargement du ZIP
      await httpsDownload(`https://github.com/${GITHUB_REPO}/archive/refs/heads/main.zip`, zipPath);

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
      const sourceDir = path.join(extractDir, 'APPMETIER-main');
      copyDir(sourceDir, __dirname);

      // 4. Sauvegarde du SHA pour la prochaine comparaison
      try {
        const body = await httpsGet(`https://api.github.com/repos/${GITHUB_REPO}/commits/main`);
        const sha = JSON.parse(body).sha;
        if (sha) fs.writeFileSync(path.join(dataFolder, 'app-version.txt'), sha);
      } catch {}

      // 5. Nettoyage
      try { fs.rmSync(zipPath, { force: true }); } catch {}
      try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch {}

      // 6. Redémarrage
      app.relaunch();
      app.exit(0);
      return { success: true };
    } catch (error) {
      try { fs.rmSync(zipPath, { force: true }); } catch {}
      try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch {}
      return { success: false, error: error.message };
    }
  });
}
app.whenReady().then(() => {
  setupIpcHandlers()
  createWindow()
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
