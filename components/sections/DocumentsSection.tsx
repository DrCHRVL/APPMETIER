import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  Upload,
  FileText,
  File,
  Image,
  Trash2,
  FolderOpen,
  Settings,
  AlertCircle,
  FileCode,
  Mail,
  Phone,
  MapPin,
  Camera,
  ClipboardList,
  ExternalLink,
  CheckCircle,
  XCircle,
  RefreshCw,
  Loader,
  Calendar,
  Copy,
  X
} from 'lucide-react';
import { Enquete, DocumentEnquete } from '@/types/interfaces';
import { useToast } from '@/contexts/ToastContext';
import { DocumentPathModal } from '../modals/DocumentPathModal';
import { DocumentSyncManager, SyncResult } from '@/utils/documents/DocumentSyncManager';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface DocumentsSectionProps {
  enquete: Enquete;
  onUpdate: (id: number, updates: Partial<Enquete>) => void;
  isEditing: boolean;
}

type DocumentCategory = 'geoloc' | 'ecoutes' | 'actes' | 'pv';

interface DocumentZone {
  category: DocumentCategory;
  title: string;
  icon: React.ReactNode;
  description: string;
  color: string;
}

// Représente un fichier en attente de résolution de conflit
interface ConflictItem {
  file: File;
  category: DocumentCategory;
  existingDoc: DocumentEnquete;
}

const DOCUMENT_ZONES: DocumentZone[] = [
  {
    category: 'geoloc',
    title: 'Géolocalisations',
    icon: <MapPin className="h-5 w-5" />,
    description: 'Documents liés aux géolocalisations',
    color: 'border-green-300 bg-green-50 hover:bg-green-100'
  },
  {
    category: 'ecoutes',
    title: 'Écoutes',
    icon: <Phone className="h-5 w-5" />,
    description: 'Documents liés aux écoutes téléphoniques',
    color: 'border-blue-300 bg-blue-50 hover:bg-blue-100'
  },
  {
    category: 'actes',
    title: 'Autres actes',
    icon: <Camera className="h-5 w-5" />,
    description: 'Documents liés aux autres actes d\'enquête',
    color: 'border-purple-300 bg-purple-50 hover:bg-purple-100'
  },
  {
    category: 'pv',
    title: 'PV enquêteurs',
    icon: <ClipboardList className="h-5 w-5" />,
    description: 'PV et documents généraux',
    color: 'border-orange-300 bg-orange-50 hover:bg-orange-100'
  }
];

// Génère un nom de fichier sans conflit en ajoutant un suffixe numérique
const resolveNameConflict = (fileName: string, existingNames: string[]): string => {
  const lastDot = fileName.lastIndexOf('.');
  const base = lastDot !== -1 ? fileName.slice(0, lastDot) : fileName;
  const ext = lastDot !== -1 ? fileName.slice(lastDot) : '';
  let counter = 2;
  let candidate = `${base} (${counter})${ext}`;
  while (existingNames.includes(candidate)) {
    counter++;
    candidate = `${base} (${counter})${ext}`;
  }
  return candidate;
};

export const DocumentsSection = ({ enquete, onUpdate, isEditing }: DocumentsSectionProps) => {
  const [dragOverZone, setDragOverZone] = useState<DocumentCategory | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showPathModal, setShowPathModal] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'success' | 'error' | null>(null);

  // États pour la synchronisation
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [lastScanTime, setLastScanTime] = useState<Date | null>(null);

  // États pour la résolution de conflits
  const [conflictQueue, setConflictQueue] = useState<ConflictItem[]>([]);
  const [currentConflict, setCurrentConflict] = useState<ConflictItem | null>(null);
  // Fichiers validés après résolution (nom éventuellement renommé)
  const pendingUploadRef = useRef<{ file: File; renamedTo?: string; category: DocumentCategory }[]>([]);

  const fileInputRefs = useRef<Record<DocumentCategory, HTMLInputElement | null>>({
    geoloc: null,
    ecoutes: null,
    actes: null,
    pv: null
  });

  const { showToast } = useToast();

  // Documents par catégorie mémorisés pour éviter les recalculs inutiles
  const documentsByCategory = useMemo(() => {
    const categoryMapping: Record<DocumentCategory, string> = {
      'geoloc': 'Geoloc',
      'ecoutes': 'Ecoutes',
      'actes': 'Actes',
      'pv': 'PV'
    };
    const result: Record<DocumentCategory, DocumentEnquete[]> = {
      geoloc: [],
      ecoutes: [],
      actes: [],
      pv: []
    };
    for (const cat of Object.keys(categoryMapping) as DocumentCategory[]) {
      const prefix = categoryMapping[cat];
      result[cat] = (enquete.documents || []).filter(doc =>
        doc.cheminRelatif.startsWith(`${prefix}/`)
      );
    }
    return result;
  }, [enquete.documents]);

  // Scan automatique avec délai initial pour ne pas bloquer l'ouverture de la modale
  useEffect(() => {
    // Délai de 1,5 s pour laisser le temps à l'UI de s'afficher avant le scan réseau
    const initialTimer = setTimeout(() => {
      scanForNewDocuments(true);
    }, 1500);

    // Scan périodique toutes les 10 minutes
    const intervalId = setInterval(() => {
      scanForNewDocuments(true);
    }, 600000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(intervalId);
    };
  }, [enquete.id]);

  // Traitement de la file de conflits : afficher le prochain conflit
  useEffect(() => {
    if (!currentConflict && conflictQueue.length > 0) {
      const [next, ...rest] = conflictQueue;
      setCurrentConflict(next);
      setConflictQueue(rest);
    }
  }, [currentConflict, conflictQueue]);

  // Fonction pour scanner les nouveaux documents
  const scanForNewDocuments = async (silent = false) => {
    if (!window.electronAPI) {
      if (!silent) showToast('API Electron non disponible', 'error');
      return;
    }

    if (isScanning) return;

    setIsScanning(true);

    try {
      const existingDocuments = enquete.documents || [];

      const scanResult = await DocumentSyncManager.scanForNewDocuments(
        enquete.numero,
        existingDocuments
      );

      if (scanResult.errors.length > 0 && !silent) {
        scanResult.errors.forEach(error => {
          console.error('Erreur scan documents:', error);
        });
        showToast('Erreur lors du scan des documents', 'error');
      }

      if (scanResult.newDocuments.length > 0) {
        const updatedDocuments = [...existingDocuments, ...scanResult.newDocuments];
        onUpdate(enquete.id, { documents: updatedDocuments });

        if (!silent) {
          showToast(`${scanResult.newDocuments.length} nouveaux documents trouvés`, 'success');
        }
      } else if (!silent) {
        showToast('Aucun nouveau document trouvé', 'info');
      }

      setLastScanTime(new Date());
    } catch (error) {
      console.error('Erreur lors du scan des documents:', error);
      if (!silent) showToast('Erreur lors du scan des documents', 'error');
    } finally {
      setIsScanning(false);
    }
  };

  // Fonction pour synchroniser les documents
  const synchronizeDocuments = async () => {
    if (!window.electronAPI) {
      showToast('API Electron non disponible', 'error');
      return;
    }

    if (!enquete.cheminExterne) {
      showToast('Aucun chemin externe configuré', 'warning');
      return;
    }

    setIsSyncing(true);

    try {
      const syncResult = await DocumentSyncManager.synchronizeDocuments(
        enquete.numero,
        enquete.cheminExterne,
        enquete.useSubfolderForExternal !== false
      );

      setLastSyncResult(syncResult);

      if (!syncResult.externalAccessible) {
        showToast('Chemin externe inaccessible actuellement', 'warning');
        return;
      }

      if (syncResult.errors.length > 0) {
        syncResult.errors.forEach(error => {
          console.error('Erreur synchronisation:', error);
        });
        showToast('Des erreurs sont survenues lors de la synchronisation', 'warning');
      } else {
        if (syncResult.addedToInternal.length === 0 && syncResult.addedToExternal.length === 0) {
          showToast('Tous les documents sont déjà synchronisés', 'success');
        } else {
          showToast(
            `Synchronisation terminée: ${syncResult.addedToInternal.length} ajoutés en interne, ${syncResult.addedToExternal.length} ajoutés en externe`,
            'success'
          );
        }

        if (syncResult.addedToInternal.length > 0) {
          scanForNewDocuments(true);
        }
      }
    } catch (error) {
      console.error('Erreur lors de la synchronisation des documents:', error);
      showToast('Erreur lors de la synchronisation des documents', 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  // Fonction pour obtenir l'icône selon le type de fichier
  const getFileIcon = (type: string, size = 'h-4 w-4') => {
    switch (type) {
      case 'pdf':
        return <FileText className={`${size} text-red-500`} />;
      case 'doc':
      case 'docx':
        return <FileText className={`${size} text-blue-500`} />;
      case 'odt':
        return <FileText className={`${size} text-green-500`} />;
      case 'image':
        return <Image className={`${size} text-purple-500`} />;
      case 'html':
        return <FileCode className={`${size} text-orange-500`} />;
      case 'msg':
        return <Mail className={`${size} text-blue-600`} />;
      case 'txt':
        return <File className={`${size} text-gray-500`} />;
      default:
        return <File className={`${size} text-gray-400`} />;
    }
  };

  // Fonction pour formater la taille des fichiers
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Fonction pour valider les types de fichiers
  const isValidFileType = (file: File): boolean => {
    const validExtensions = [
      '.pdf', '.doc', '.docx', '.odt', '.txt',
      '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp',
      '.html', '.htm', '.msg'
    ];

    const fileName = file.name.toLowerCase();
    return validExtensions.some(ext => fileName.endsWith(ext));
  };

  // Upload effectif d'une liste de fichiers (après résolution de conflits)
  const uploadFiles = async (
    filesToUpload: { file: File; renamedTo?: string }[],
    category: DocumentCategory
  ) => {
    if (!window.electronAPI) {
      showToast('API Electron non disponible', 'error');
      return;
    }

    setIsUploading(true);
    setCopyStatus(null);

    try {
      const categoryMapping: Record<DocumentCategory, string> = {
        'geoloc': 'Geoloc',
        'ecoutes': 'Ecoutes',
        'actes': 'Actes',
        'pv': 'PV'
      };
      const electronCategory = categoryMapping[category];

      const filesData = await Promise.all(
        filesToUpload.map(async ({ file, renamedTo }) => ({
          name: renamedTo || file.name,
          arrayBuffer: await file.arrayBuffer()
        }))
      );

      const savedFiles = await window.electronAPI.saveDocuments(
        enquete.numero,
        filesData,
        electronCategory
      );

      if (savedFiles && savedFiles.length > 0) {
        const currentDocuments = enquete.documents || [];
        const updatedDocuments = [...currentDocuments, ...savedFiles];
        onUpdate(enquete.id, { documents: updatedDocuments });
        showToast(
          `${savedFiles.length} document(s) ajoutés dans ${DOCUMENT_ZONES.find(z => z.category === category)?.title}`,
          'success'
        );

        if (enquete.cheminExterne) {
          try {
            const copySuccess = await window.electronAPI.copyToExternalPath(
              enquete.numero,
              enquete.cheminExterne,
              savedFiles,
              electronCategory,
              enquete.useSubfolderForExternal ?? true
            );
            setCopyStatus(copySuccess ? 'success' : 'error');
          } catch (error) {
            console.error('Erreur copie externe:', error);
            setCopyStatus('error');
          }
        }
      } else {
        showToast('Erreur lors de la sauvegarde des documents', 'error');
      }
    } catch (error) {
      console.error('Erreur lors de l\'upload:', error);
      showToast('Erreur lors de l\'upload des documents', 'error');
    } finally {
      setIsUploading(false);
    }
  };

  // Fonction pour traiter les fichiers uploadés dans une catégorie spécifique
  const handleFiles = async (files: FileList | File[], category: DocumentCategory) => {
    if (!window.electronAPI) {
      showToast('API Electron non disponible', 'error');
      return;
    }

    const validFiles: File[] = [];
    const invalidFiles: string[] = [];

    Array.from(files).forEach(file => {
      if (isValidFileType(file)) {
        validFiles.push(file);
      } else {
        invalidFiles.push(file.name);
      }
    });

    if (invalidFiles.length > 0) {
      showToast(`Fichiers non supportés: ${invalidFiles.join(', ')}`, 'error');
    }

    if (validFiles.length === 0) return;

    // Vérification des conflits de noms avec les documents existants de la même catégorie
    const existingDocsInCategory = documentsByCategory[category];
    const existingNames = existingDocsInCategory.map(d => d.nomOriginal);

    const noConflict: { file: File; renamedTo?: string }[] = [];
    const conflicts: ConflictItem[] = [];

    for (const file of validFiles) {
      const conflict = existingDocsInCategory.find(d => d.nomOriginal === file.name);
      if (conflict) {
        conflicts.push({ file, category, existingDoc: conflict });
      } else {
        noConflict.push({ file });
      }
    }

    // Upload immédiat des fichiers sans conflit
    if (noConflict.length > 0) {
      await uploadFiles(noConflict, category);
    }

    // Mettre les conflits dans la file
    if (conflicts.length > 0) {
      setConflictQueue(prev => [...prev, ...conflicts]);
    }
  };

  // Action : remplacer le fichier existant
  const handleConflictReplace = async () => {
    if (!currentConflict) return;
    const { file, category } = currentConflict;
    setCurrentConflict(null);

    // Supprimer l'ancien document puis uploader le nouveau avec le même nom
    try {
      const deleted = await window.electronAPI?.deleteDocument(
        enquete.numero,
        currentConflict.existingDoc.cheminRelatif,
        enquete.cheminExterne,
        enquete.useSubfolderForExternal ?? true
      );
      if (deleted) {
        const updatedDocuments = (enquete.documents || []).filter(
          d => d.id !== currentConflict.existingDoc.id
        );
        onUpdate(enquete.id, { documents: updatedDocuments });
      }
    } catch (err) {
      console.error('Erreur suppression avant remplacement:', err);
    }

    await uploadFiles([{ file }], category);
  };

  // Action : renommer automatiquement (style Windows)
  const handleConflictRename = async () => {
    if (!currentConflict) return;
    const { file, category } = currentConflict;
    setCurrentConflict(null);

    const existingNames = (enquete.documents || []).map(d => d.nomOriginal);
    const newName = resolveNameConflict(file.name, existingNames);
    await uploadFiles([{ file, renamedTo: newName }], category);
    showToast(`Document renommé en "${newName}"`, 'info');
  };

  // Action : ignorer le fichier
  const handleConflictSkip = () => {
    setCurrentConflict(null);
    showToast(`"${currentConflict?.file.name}" ignoré`, 'info');
  };

  // Gestionnaires pour le glisser-déposer
  const handleDrop = (e: React.DragEvent, category: DocumentCategory) => {
    e.preventDefault();
    setDragOverZone(null);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFiles(files, category);
    }
  };

  const handleDragOver = (e: React.DragEvent, category: DocumentCategory) => {
    e.preventDefault();
    setDragOverZone(category);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverZone(null);
  };

  // Gestionnaire pour le sélecteur de fichiers
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, category: DocumentCategory) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFiles(files, category);
    }
    if (fileInputRefs.current[category]) {
      fileInputRefs.current[category]!.value = '';
    }
  };

  // Fonction pour ouvrir un document
  const handleOpenDocument = async (document: DocumentEnquete) => {
    if (!window.electronAPI) {
      showToast('API Electron non disponible', 'error');
      return;
    }

    try {
      const success = await window.electronAPI.openDocument(enquete.numero, document.cheminRelatif);
      if (!success) {
        showToast(`Impossible d'ouvrir le document "${document.nomOriginal}"`, 'error');
      }
    } catch (error) {
      console.error('Erreur lors de l\'ouverture du document:', error);
      showToast('Erreur lors de l\'ouverture du document', 'error');
    }
  };

  // Fonction pour supprimer un document
  const handleDeleteDocument = async (document: DocumentEnquete) => {
    if (!window.electronAPI) {
      showToast('API Electron non disponible', 'error');
      return;
    }

    if (!confirm(`Êtes-vous sûr de vouloir supprimer le document "${document.nomOriginal}" ?`)) {
      return;
    }

    try {
      const success = await window.electronAPI.deleteDocument(
        enquete.numero,
        document.cheminRelatif,
        enquete.cheminExterne,
        enquete.useSubfolderForExternal ?? true
      );

      if (success) {
        const updatedDocuments = (enquete.documents || []).filter(doc => doc.id !== document.id);
        onUpdate(enquete.id, { documents: updatedDocuments });
        showToast('Document supprimé', 'success');
      } else {
        showToast('Erreur lors de la suppression du document', 'error');
      }
    } catch (error) {
      console.error('Erreur lors de la suppression:', error);
      showToast('Erreur lors de la suppression du document', 'error');
    }
  };

  // Fonction pour ouvrir le dossier externe
  const handleOpenExternalFolder = async () => {
    if (!enquete.cheminExterne) {
      showToast('Aucun chemin externe configuré', 'warning');
      return;
    }

    if (!window.electronAPI) {
      showToast('API Electron non disponible', 'error');
      return;
    }

    try {
      const success = await window.electronAPI.openExternalFolder(
        enquete.cheminExterne,
        enquete.numero,
        enquete.useSubfolderForExternal ?? true
      );
      if (!success) {
        showToast('Impossible d\'ouvrir le dossier externe', 'error');
      }
    } catch (error) {
      console.error('Erreur ouverture dossier externe:', error);
      showToast('Erreur lors de l\'ouverture du dossier externe', 'error');
    }
  };

  // Fonction pour sauvegarder le nouveau chemin externe
  const handleSaveExternalPath = async (newPath: string, useSubfolder: boolean) => {
    const oldPath = enquete.cheminExterne;
    const oldUseSubfolder = enquete.useSubfolderForExternal ?? true;

    onUpdate(enquete.id, {
      cheminExterne: newPath,
      useSubfolderForExternal: useSubfolder
    });

    if (oldPath && (oldPath !== newPath || oldUseSubfolder !== useSubfolder)) {
      const oldFinalPath = oldUseSubfolder ? `${oldPath}/${enquete.numero}` : oldPath;
      const newFinalPath = useSubfolder && newPath ? `${newPath}/${enquete.numero}` : newPath;

      showToast(
        `Configuration modifiée. Déplacez manuellement les fichiers de "${oldFinalPath}" vers "${newFinalPath}" si nécessaire.`,
        'warning'
      );
    } else {
      showToast('Chemin externe configuré', 'success');
    }
  };

  // Formatage de la date de dernière synchronisation
  const formatLastScanTime = () => {
    if (!lastScanTime) return null;

    try {
      return format(lastScanTime, 'dd/MM/yyyy HH:mm:ss', { locale: fr });
    } catch (error) {
      console.error('Erreur de formatage de date:', error);
      return lastScanTime.toLocaleString();
    }
  };

  return (
    <>
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-medium flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Documents ({(enquete.documents || []).length})
              {copyStatus && (
                <div className="flex items-center gap-1">
                  {copyStatus === 'success' ? (
                    <CheckCircle className="h-4 w-4 text-green-600" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-600" />
                  )}
                  <span className="text-xs text-gray-600">
                    {copyStatus === 'success' ? 'Copie externe OK' : 'Erreur copie externe'}
                  </span>
                </div>
              )}

              {/* Affichage du dernier scan */}
              {lastScanTime && (
                <div className="flex items-center gap-1 ml-2 text-xs text-gray-500">
                  <Calendar className="h-3 w-3" />
                  <span>Scan: {formatLastScanTime()}</span>
                </div>
              )}
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              {/* Bouton de scan des nouveaux documents */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => scanForNewDocuments()}
                disabled={isScanning}
                className="flex items-center gap-2"
                title="Rechercher les nouveaux documents ajoutés manuellement"
              >
                {isScanning ? (
                  <Loader className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {isScanning ? 'Recherche...' : 'Actualiser'}
              </Button>

              {/* Bouton de synchronisation - uniquement visible si un chemin externe est configuré */}
              {enquete.cheminExterne && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={synchronizeDocuments}
                  disabled={isSyncing}
                  className="flex items-center gap-2"
                  title="Synchroniser les documents entre interne et externe"
                >
                  {isSyncing ? (
                    <Loader className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  {isSyncing ? 'Synchro...' : 'Synchroniser'}
                </Button>
              )}

              {enquete.cheminExterne && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleOpenExternalFolder}
                  className="flex items-center gap-2"
                  title="Ouvrir le dossier externe"
                >
                  <FolderOpen className="h-4 w-4" />
                  Ouvrir dossier
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowPathModal(true)}
                className="flex items-center gap-2"
                title="Configurer le chemin de sauvegarde externe"
              >
                <Settings className="h-4 w-4" />
                {enquete.cheminExterne ? 'Modifier chemin' : 'Configurer chemin'}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Afficher le résultat de synchronisation si disponible */}
          {lastSyncResult && (
            <div className="bg-blue-50 p-3 rounded-lg border border-blue-200 mb-4">
              <h3 className="font-medium text-blue-800 mb-1">Dernière synchronisation</h3>
              <div className="text-xs text-blue-700 space-y-1">
                <p>Documents internes: {lastSyncResult.totalInternal}</p>
                <p>Documents externes: {lastSyncResult.totalExternal}</p>
                {lastSyncResult.addedToInternal.length > 0 && (
                  <p>Ajoutés en interne: {lastSyncResult.addedToInternal.length}</p>
                )}
                {lastSyncResult.addedToExternal.length > 0 && (
                  <p>Ajoutés en externe: {lastSyncResult.addedToExternal.length}</p>
                )}
                {lastSyncResult.errors.length > 0 && (
                  <div className="text-red-600">
                    <p>Erreurs: {lastSyncResult.errors.length}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Dialogue de résolution de conflit (style Explorateur Windows) */}
          {currentConflict && (
            <div className="border-2 border-amber-300 bg-amber-50 rounded-lg p-4 space-y-3">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="font-semibold text-amber-900 text-sm">
                    Conflit de nom de fichier
                  </p>
                  <p className="text-xs text-amber-800 mt-1">
                    Le fichier <strong>"{currentConflict.file.name}"</strong> existe déjà dans{' '}
                    <strong>{DOCUMENT_ZONES.find(z => z.category === currentConflict.category)?.title}</strong>.
                  </p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    Que souhaitez-vous faire ?
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleConflictReplace}
                  className="flex items-center gap-1 text-xs"
                  title="Remplacer le fichier existant par le nouveau"
                >
                  <XCircle className="h-3 w-3" />
                  Remplacer
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleConflictRename}
                  className="flex items-center gap-1 text-xs border-amber-400 text-amber-800 hover:bg-amber-100"
                  title="Garder les deux en renommant le nouveau fichier"
                >
                  <Copy className="h-3 w-3" />
                  Garder les deux
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleConflictSkip}
                  className="flex items-center gap-1 text-xs text-gray-600"
                  title="Ne pas copier ce fichier"
                >
                  <X className="h-3 w-3" />
                  Ignorer
                </Button>
              </div>
              {conflictQueue.length > 0 && (
                <p className="text-xs text-amber-600">
                  {conflictQueue.length} autre(s) conflit(s) en attente
                </p>
              )}
            </div>
          )}

          {/* Grille des 4 zones de documents */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {DOCUMENT_ZONES.map((zone) => {
              const documentsInZone = documentsByCategory[zone.category];
              const isDragOver = dragOverZone === zone.category;

              return (
                <div key={zone.category} className="space-y-3">
                  {/* Zone de glisser-déposer */}
                  <div
                    className={`
                      border-2 border-dashed rounded-lg p-4 text-center transition-all relative
                      ${isDragOver
                        ? `${zone.color} border-solid shadow-md`
                        : `border-gray-300 hover:border-gray-400 hover:bg-gray-50`
                      }
                      ${isUploading ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}
                    `}
                    onDrop={(e) => handleDrop(e, zone.category)}
                    onDragOver={(e) => handleDragOver(e, zone.category)}
                    onDragLeave={handleDragLeave}
                    onClick={() => fileInputRefs.current[zone.category]?.click()}
                  >
                    <div className="flex flex-col items-center gap-2">
                      <div className={`p-2 rounded-full ${zone.color.replace('hover:', '')}`}>
                        {zone.icon}
                      </div>
                      <div>
                        <h3 className="font-medium text-sm">{zone.title}</h3>
                        <p className="text-xs text-gray-600 mb-2">{zone.description}</p>
                        <p className="text-xs text-gray-500">
                          {isUploading ? 'Upload...' : 'Cliquer ou glisser-déposer'}
                        </p>
                        <Badge variant="outline" className="mt-1 text-xs">
                          {documentsInZone.length} document{documentsInZone.length !== 1 ? 's' : ''}
                        </Badge>
                      </div>
                    </div>
                    <input
                      ref={(el) => fileInputRefs.current[zone.category] = el}
                      type="file"
                      multiple
                      accept=".pdf,.doc,.docx,.odt,.txt,.jpg,.jpeg,.png,.gif,.bmp,.webp,.html,.htm,.msg"
                      onChange={(e) => handleFileSelect(e, zone.category)}
                      className="hidden"
                    />
                  </div>

                  {/* Liste des documents de cette zone */}
                  {documentsInZone.length > 0 && (
                    <div className="space-y-2 max-h-32 overflow-y-auto">
                      {documentsInZone.map((document) => (
                        <div
                          key={document.id}
                          className="flex items-center justify-between p-2 bg-gray-50 rounded-md hover:bg-gray-100 transition-colors"
                        >
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            {getFileIcon(document.type, 'h-3 w-3')}
                            <div
                              className="flex-1 min-w-0 cursor-pointer"
                              onClick={() => handleOpenDocument(document)}
                              title="Cliquer pour ouvrir le document"
                            >
                              <p className="text-xs font-medium text-gray-900 break-words line-clamp-2">
                                {document.nomOriginal}
                              </p>
                              <div className="flex items-center gap-1 text-xs text-gray-500">
                                <span>{formatFileSize(document.taille)}</span>
                                <ExternalLink className="h-2 w-2" />
                              </div>
                            </div>
                          </div>

                          {isEditing && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                              onClick={() => handleDeleteDocument(document)}
                              title="Supprimer le document"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Informations de configuration */}
          <div className="space-y-2">
            {enquete.cheminExterne ? (
              <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-green-800">Chemin externe configuré</p>
                  <p className="text-xs text-green-700 break-all">
                    {enquete.cheminExterne}
                    {enquete.useSubfolderForExternal !== false && ` / ${enquete.numero}`}
                  </p>
                  <p className="text-xs text-green-600 mt-1">
                    Mode: {enquete.useSubfolderForExternal !== false ? 'Sous-dossier enquête' : 'Dossier direct'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <AlertCircle className="h-4 w-4 text-yellow-600" />
                <div className="flex-1">
                  <p className="text-sm text-yellow-800">
                    Aucun chemin externe configuré - les documents sont sauvegardés uniquement en interne
                  </p>
                </div>
              </div>
            )}

            {/* Alerte si API non disponible */}
            {!window.electronAPI && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <XCircle className="h-4 w-4 text-red-600" />
                <p className="text-sm text-red-800">
                  Fonctionnalité documents non disponible (API Electron requise)
                </p>
              </div>
            )}
          </div>

          {/* Aide */}
          <div className="text-xs text-gray-500 space-y-1">
            <p><strong>Formats supportés :</strong> PDF, DOC, DOCX, ODT, TXT, Images, HTML, MSG</p>
            <p><strong>Organisation :</strong> Les documents sont automatiquement classés dans des dossiers selon leur catégorie</p>
            {enquete.cheminExterne && (
              <p><strong>Sauvegarde double :</strong> Documents sauvegardés en interne + copie externe</p>
            )}
            <p><strong>Conflits :</strong> En cas de doublon de nom, une boîte de dialogue propose de remplacer, renommer ou ignorer</p>
            <p><strong>Synchronisation :</strong> Cliquez sur "Synchroniser" pour vérifier que tous les documents sont présents aux deux endroits</p>
            <p><strong>Actualisation :</strong> Cliquez sur "Actualiser" pour détecter les documents ajoutés manuellement</p>
          </div>
        </CardContent>
      </Card>

      {/* Modal de configuration du chemin */}
      <DocumentPathModal
        isOpen={showPathModal}
        onClose={() => setShowPathModal(false)}
        currentPath={enquete.cheminExterne || ''}
        currentUseSubfolder={enquete.useSubfolderForExternal ?? true}
        onSave={handleSaveExternalPath}
        enqueteNumero={enquete.numero}
      />
    </>
  );
};
