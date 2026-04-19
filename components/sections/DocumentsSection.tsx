import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
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
  X,
  ChevronDown,
  ChevronUp,
  Search
} from 'lucide-react';
import { Enquete, DocumentEnquete } from '@/types/interfaces';
import { useToast } from '@/contexts/ToastContext';
import { DocumentPathModal } from '../modals/DocumentPathModal';
import { AnalyseDocumentsModal } from '../modals/AnalyseDocumentsModal';
import { DocumentSyncManager, SyncResult } from '@/utils/documents/DocumentSyncManager';
import { TooltipRoot, TooltipTrigger, TooltipContent, TooltipProvider } from '../ui/tooltip';
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

interface ConflictItem {
  file: File;
  category: DocumentCategory;
  existingDoc: DocumentEnquete;
}

// Libellés lisibles par type de document (pour le tooltip)
const TYPE_LABELS: Record<string, string> = {
  pdf: 'PDF',
  doc: 'Word',
  docx: 'Word',
  odt: 'LibreOffice',
  image: 'Image',
  html: 'HTML',
  msg: 'Email Outlook',
  txt: 'Texte',
  autre: 'Fichier'
};

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
    description: "Documents liés aux autres actes d'enquête",
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

// ─── Singleton module-level : une seule paire timer/interval par enquête ID ───
// Garantit qu'aucun doublon ne s'accumule quand la modale est ouverte/fermée rapidement.
const _scanTimers = new Map<number, ReturnType<typeof setTimeout>>();
const _scanIntervals = new Map<number, ReturnType<typeof setInterval>>();

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

export const DocumentsSection = React.memo(({ enquete, onUpdate, isEditing }: DocumentsSectionProps) => {
  const [dragOverZone, setDragOverZone] = useState<DocumentCategory | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showPathModal, setShowPathModal] = useState(false);
  const [showAnalyseModal, setShowAnalyseModal] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'success' | 'error' | null>(null);

  // Synchronisation
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [lastScanTime, setLastScanTime] = useState<Date | null>(null);

  // Résolution de conflits de noms
  const [conflictQueue, setConflictQueue] = useState<ConflictItem[]>([]);
  const [currentConflict, setCurrentConflict] = useState<ConflictItem | null>(null);

  // Vue expandable par catégorie
  const [expandedCategories, setExpandedCategories] = useState<Set<DocumentCategory>>(new Set());

  const fileInputRefs = useRef<Record<DocumentCategory, HTMLInputElement | null>>({
    geoloc: null,
    ecoutes: null,
    actes: null,
    pv: null
  });

  const { showToast } = useToast();

  // Documents par catégorie — mémoïsés pour éviter les recalculs inutiles
  const documentsByCategory = useMemo(() => {
    // 1 seule passe au lieu de 4 .filter() — plus rapide pour les grosses listes
    const result: Record<DocumentCategory, DocumentEnquete[]> = {
      geoloc: [], ecoutes: [], actes: [], pv: []
    };
    for (const doc of (enquete.documents || [])) {
      const path = doc.cheminRelatif;
      if (path.startsWith('Geoloc/')) result.geoloc.push(doc);
      else if (path.startsWith('Ecoutes/')) result.ecoutes.push(doc);
      else if (path.startsWith('Actes/')) result.actes.push(doc);
      else if (path.startsWith('PV/')) result.pv.push(doc);
    }
    return result;
  }, [enquete.documents]);

  // ── useEffect : scan initial (délayé) + scan périodique — singleton par enquête ID ──
  useEffect(() => {
    // Ne créer un timer/interval que s'il n'en existe pas encore pour cette enquête
    if (!_scanIntervals.has(enquete.id)) {
      const timer = setTimeout(() => {
        scanForNewDocuments(true);
      }, 1500);
      _scanTimers.set(enquete.id, timer);

      const interval = setInterval(() => {
        scanForNewDocuments(true);
      }, 600000);
      _scanIntervals.set(enquete.id, interval);
    }

    return () => {
      const t = _scanTimers.get(enquete.id);
      if (t !== undefined) { clearTimeout(t); _scanTimers.delete(enquete.id); }
      const i = _scanIntervals.get(enquete.id);
      if (i !== undefined) { clearInterval(i); _scanIntervals.delete(enquete.id); }
    };
  }, [enquete.id]);

  // Passer au conflit suivant dans la file
  useEffect(() => {
    if (!currentConflict && conflictQueue.length > 0) {
      const [next, ...rest] = conflictQueue;
      setCurrentConflict(next);
      setConflictQueue(rest);
    }
  }, [currentConflict, conflictQueue]);

  // ── Scan des nouveaux documents ──
  const scanForNewDocuments = async (silent = false) => {
    if (!window.electronAPI) {
      if (!silent) showToast('API Electron non disponible', 'error');
      return;
    }
    if (isScanning) return;

    setIsScanning(true);
    try {
      const existing = enquete.documents || [];
      const result = await DocumentSyncManager.scanForNewDocuments(enquete.numero, existing);

      if (result.errors.length > 0 && !silent) {
        result.errors.forEach(e => console.error('Erreur scan:', e));
        showToast('Erreur lors du scan des documents', 'error');
      }

      if (result.newDocuments.length > 0) {
        onUpdate(enquete.id, { documents: [...existing, ...result.newDocuments] });
        if (!silent) showToast(`${result.newDocuments.length} nouveaux documents trouvés`, 'success');
      } else if (!silent) {
        showToast('Aucun nouveau document trouvé', 'info');
      }

      setLastScanTime(new Date());
    } catch (err) {
      console.error('Erreur scan documents:', err);
      if (!silent) showToast('Erreur lors du scan des documents', 'error');
    } finally {
      setIsScanning(false);
    }
  };

  // ── Synchronisation externe ──
  const synchronizeDocuments = async () => {
    if (!window.electronAPI) { showToast('API Electron non disponible', 'error'); return; }
    if (!enquete.cheminExterne) { showToast('Aucun chemin externe configuré', 'warning'); return; }

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
        syncResult.errors.forEach(e => console.error('Erreur sync:', e));
        showToast('Des erreurs sont survenues lors de la synchronisation', 'warning');
      } else {
        const { addedToInternal: ai, addedToExternal: ae } = syncResult;
        if (ai.length === 0 && ae.length === 0) {
          showToast('Tous les documents sont déjà synchronisés', 'success');
        } else {
          showToast(`Synchronisation terminée : ${ai.length} ajoutés en interne, ${ae.length} en externe`, 'success');
        }
        if (ai.length > 0) scanForNewDocuments(true);
      }
    } catch (err) {
      console.error('Erreur synchronisation:', err);
      showToast('Erreur lors de la synchronisation des documents', 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  // ── Icône selon type de fichier ──
  const getFileIcon = (type: string, size = 'h-4 w-4') => {
    switch (type) {
      case 'pdf':   return <FileText className={`${size} text-red-500`} />;
      case 'doc':
      case 'docx':  return <FileText className={`${size} text-blue-500`} />;
      case 'odt':   return <FileText className={`${size} text-green-500`} />;
      case 'image': return <Image    className={`${size} text-purple-500`} />;
      case 'html':  return <FileCode className={`${size} text-orange-500`} />;
      case 'msg':   return <Mail     className={`${size} text-blue-600`} />;
      case 'txt':   return <File     className={`${size} text-gray-500`} />;
      default:      return <File     className={`${size} text-gray-400`} />;
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const isValidFileType = (file: File): boolean => {
    const valid = ['.pdf','.doc','.docx','.odt','.txt','.jpg','.jpeg','.png','.gif','.bmp','.webp','.html','.htm','.msg'];
    return valid.some(ext => file.name.toLowerCase().endsWith(ext));
  };

  // ── Upload effectif après résolution de conflits ──
  const uploadFiles = async (
    filesToUpload: { file: File; renamedTo?: string }[],
    category: DocumentCategory
  ) => {
    if (!window.electronAPI) { showToast('API Electron non disponible', 'error'); return; }

    setIsUploading(true);
    setCopyStatus(null);

    const categoryMapping: Record<DocumentCategory, string> = {
      geoloc: 'Geoloc', ecoutes: 'Ecoutes', actes: 'Actes', pv: 'PV'
    };
    const electronCategory = categoryMapping[category];

    try {
      const filesData = await Promise.all(
        filesToUpload.map(async ({ file, renamedTo }) => ({
          name: renamedTo || file.name,
          arrayBuffer: await file.arrayBuffer()
        }))
      );

      const savedFiles = await window.electronAPI.saveDocuments(
        enquete.numero, filesData, electronCategory
      );

      if (savedFiles && savedFiles.length > 0) {
        onUpdate(enquete.id, { documents: [...(enquete.documents || []), ...savedFiles] });
        showToast(
          `${savedFiles.length} document(s) ajoutés dans ${DOCUMENT_ZONES.find(z => z.category === category)?.title}`,
          'success'
        );

        if (enquete.cheminExterne) {
          try {
            const ok = await window.electronAPI.copyToExternalPath(
              enquete.numero, enquete.cheminExterne, savedFiles,
              electronCategory, enquete.useSubfolderForExternal ?? true
            );
            setCopyStatus(ok ? 'success' : 'error');
          } catch {
            setCopyStatus('error');
          }
        }
      } else {
        showToast('Erreur lors de la sauvegarde des documents', 'error');
      }
    } catch (err) {
      console.error('Erreur upload:', err);
      showToast("Erreur lors de l'upload des documents", 'error');
    } finally {
      setIsUploading(false);
    }
  };

  // ── Traitement des fichiers (validation + détection conflits) ──
  const handleFiles = async (files: FileList | File[], category: DocumentCategory) => {
    if (!window.electronAPI) { showToast('API Electron non disponible', 'error'); return; }

    const validFiles: File[] = [];
    const invalidFiles: string[] = [];
    Array.from(files).forEach(f => {
      isValidFileType(f) ? validFiles.push(f) : invalidFiles.push(f.name);
    });

    if (invalidFiles.length > 0) showToast(`Fichiers non supportés : ${invalidFiles.join(', ')}`, 'error');
    if (validFiles.length === 0) return;

    const existingInCat = documentsByCategory[category];
    const noConflict: { file: File }[] = [];
    const conflicts: ConflictItem[] = [];

    for (const file of validFiles) {
      const dup = existingInCat.find(d => d.nomOriginal === file.name);
      dup ? conflicts.push({ file, category, existingDoc: dup }) : noConflict.push({ file });
    }

    if (noConflict.length > 0) await uploadFiles(noConflict, category);
    if (conflicts.length > 0) setConflictQueue(prev => [...prev, ...conflicts]);
  };

  // ── Résolution de conflits ──
  const handleConflictReplace = async () => {
    if (!currentConflict) return;
    const { file, category, existingDoc } = currentConflict;
    setCurrentConflict(null);
    try {
      const deleted = await window.electronAPI?.deleteDocument(
        enquete.numero, existingDoc.cheminRelatif,
        enquete.cheminExterne, enquete.useSubfolderForExternal ?? true
      );
      if (deleted) {
        onUpdate(enquete.id, {
          documents: (enquete.documents || []).filter(d => d.id !== existingDoc.id)
        });
      }
    } catch (err) { console.error('Erreur suppression avant remplacement:', err); }
    await uploadFiles([{ file }], category);
  };

  const handleConflictRename = async () => {
    if (!currentConflict) return;
    const { file, category } = currentConflict;
    setCurrentConflict(null);
    const existingNames = (enquete.documents || []).map(d => d.nomOriginal);
    const newName = resolveNameConflict(file.name, existingNames);
    await uploadFiles([{ file, renamedTo: newName }], category);
    showToast(`Document renommé en "${newName}"`, 'info');
  };

  const handleConflictSkip = () => {
    const name = currentConflict?.file.name;
    setCurrentConflict(null);
    showToast(`"${name}" ignoré`, 'info');
  };

  // ── Drag & drop ──
  const handleDrop = (e: React.DragEvent, category: DocumentCategory) => {
    e.preventDefault();
    setDragOverZone(null);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files, category);
  };
  const handleDragOver = (e: React.DragEvent, category: DocumentCategory) => {
    e.preventDefault();
    setDragOverZone(category);
  };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setDragOverZone(null); };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, category: DocumentCategory) => {
    if (e.target.files?.length) handleFiles(e.target.files, category);
    if (fileInputRefs.current[category]) fileInputRefs.current[category]!.value = '';
  };

  // ── Ouvrir / supprimer un document ──
  const handleOpenDocument = async (doc: DocumentEnquete) => {
    if (!window.electronAPI) { showToast('API Electron non disponible', 'error'); return; }
    try {
      const ok = await window.electronAPI.openDocument(enquete.numero, doc.cheminRelatif);
      if (!ok) showToast(`Impossible d'ouvrir "${doc.nomOriginal}"`, 'error');
    } catch { showToast("Erreur lors de l'ouverture du document", 'error'); }
  };

  const handleDeleteDocument = async (doc: DocumentEnquete) => {
    if (!window.electronAPI) { showToast('API Electron non disponible', 'error'); return; }
    if (!confirm(`Êtes-vous sûr de vouloir supprimer "${doc.nomOriginal}" ?`)) return;
    try {
      const ok = await window.electronAPI.deleteDocument(
        enquete.numero, doc.cheminRelatif,
        enquete.cheminExterne, enquete.useSubfolderForExternal ?? true
      );
      if (ok) {
        onUpdate(enquete.id, { documents: (enquete.documents || []).filter(d => d.id !== doc.id) });
        showToast('Document supprimé', 'success');
      } else {
        showToast('Erreur lors de la suppression', 'error');
      }
    } catch { showToast('Erreur lors de la suppression du document', 'error'); }
  };

  const handleOpenExternalFolder = async () => {
    if (!enquete.cheminExterne) { showToast('Aucun chemin externe configuré', 'warning'); return; }
    if (!window.electronAPI) { showToast('API Electron non disponible', 'error'); return; }
    try {
      const ok = await window.electronAPI.openExternalFolder(
        enquete.cheminExterne, enquete.numero, enquete.useSubfolderForExternal ?? true
      );
      if (!ok) showToast("Impossible d'ouvrir le dossier externe", 'error');
    } catch { showToast("Erreur lors de l'ouverture du dossier externe", 'error'); }
  };

  const handleSaveExternalPath = (newPath: string, useSubfolder: boolean) => {
    const oldPath = enquete.cheminExterne;
    const oldSub = enquete.useSubfolderForExternal ?? true;
    onUpdate(enquete.id, { cheminExterne: newPath, useSubfolderForExternal: useSubfolder });
    if (oldPath && (oldPath !== newPath || oldSub !== useSubfolder)) {
      const from = oldSub ? `${oldPath}/${enquete.numero}` : oldPath;
      const to   = useSubfolder && newPath ? `${newPath}/${enquete.numero}` : newPath;
      showToast(`Configuration modifiée. Déplacez manuellement les fichiers de "${from}" vers "${to}" si nécessaire.`, 'warning');
    } else {
      showToast('Chemin externe configuré', 'success');
    }
  };

  // ── Vue expandable ──
  const toggleExpand = (cat: DocumentCategory) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  };

  const formatLastScanTime = () => {
    if (!lastScanTime) return null;
    try { return format(lastScanTime, 'dd/MM/yyyy HH:mm:ss', { locale: fr }); }
    catch { return lastScanTime.toLocaleString(); }
  };

  // ─────────────────────────────── JSX ───────────────────────────────
  return (
    <>
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-medium flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Documents ({(enquete.documents || []).length})

              {/* Indicateur de scan silencieux — discret, juste à côté du titre */}
              {isScanning && (
                <span className="inline-flex items-center gap-1 text-xs text-gray-400 font-normal ml-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
                  vérification...
                </span>
              )}

              {copyStatus && (
                <div className="flex items-center gap-1">
                  {copyStatus === 'success'
                    ? <CheckCircle className="h-4 w-4 text-green-600" />
                    : <XCircle    className="h-4 w-4 text-red-600" />}
                  <span className="text-xs text-gray-600">
                    {copyStatus === 'success' ? 'Copie externe OK' : 'Erreur copie externe'}
                  </span>
                </div>
              )}

              {lastScanTime && (
                <div className="flex items-center gap-1 ml-2 text-xs text-gray-500">
                  <Calendar className="h-3 w-3" />
                  <span>Scan : {formatLastScanTime()}</span>
                </div>
              )}
            </CardTitle>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline" size="sm"
                onClick={() => scanForNewDocuments()}
                disabled={isScanning}
                className="flex items-center gap-2"
                title="Rechercher les nouveaux documents ajoutés manuellement"
              >
                {isScanning ? <Loader className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {isScanning ? 'Recherche...' : 'Actualiser'}
              </Button>

              {enquete.cheminExterne && (
                <Button
                  variant="outline" size="sm"
                  onClick={synchronizeDocuments}
                  disabled={isSyncing}
                  className="flex items-center gap-2"
                  title="Synchroniser les documents entre interne et externe"
                >
                  {isSyncing ? <Loader className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {isSyncing ? 'Synchro...' : 'Synchroniser'}
                </Button>
              )}

              {enquete.cheminExterne && (
                <Button
                  variant="outline" size="sm"
                  onClick={() => setShowAnalyseModal(true)}
                  className="flex items-center gap-2 border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                  title="Analyser les PDF du serveur pour détecter et créer automatiquement les actes"
                >
                  <Search className="h-4 w-4" />
                  Analyser actes
                </Button>
              )}

              {enquete.cheminExterne && (
                <Button
                  variant="outline" size="sm"
                  onClick={handleOpenExternalFolder}
                  className="flex items-center gap-2"
                  title="Ouvrir le dossier externe"
                >
                  <FolderOpen className="h-4 w-4" />
                  Ouvrir dossier
                </Button>
              )}

              <Button
                variant="outline" size="sm"
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
          {/* Résultat de la dernière synchronisation */}
          {lastSyncResult && (
            <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
              <h3 className="font-medium text-blue-800 mb-1">Dernière synchronisation</h3>
              <div className="text-xs text-blue-700 space-y-1">
                <p>Documents internes : {lastSyncResult.totalInternal}</p>
                <p>Documents externes : {lastSyncResult.totalExternal}</p>
                {lastSyncResult.addedToInternal.length > 0 && <p>Ajoutés en interne : {lastSyncResult.addedToInternal.length}</p>}
                {lastSyncResult.addedToExternal.length > 0 && <p>Ajoutés en externe : {lastSyncResult.addedToExternal.length}</p>}
                {lastSyncResult.errors.length > 0 && <p className="text-red-600">Erreurs : {lastSyncResult.errors.length}</p>}
              </div>
            </div>
          )}

          {/* Dialogue de résolution de conflit (style Explorateur Windows) */}
          {currentConflict && (
            <div className="border-2 border-amber-300 bg-amber-50 rounded-lg p-4 space-y-3">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="font-semibold text-amber-900 text-sm">Conflit de nom de fichier</p>
                  <p className="text-xs text-amber-800 mt-1">
                    Le fichier <strong>"{currentConflict.file.name}"</strong> existe déjà dans{' '}
                    <strong>{DOCUMENT_ZONES.find(z => z.category === currentConflict.category)?.title}</strong>.
                  </p>
                  <p className="text-xs text-amber-700 mt-0.5">Que souhaitez-vous faire ?</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="destructive" onClick={handleConflictReplace}
                  className="flex items-center gap-1 text-xs" title="Remplacer le fichier existant">
                  <XCircle className="h-3 w-3" /> Remplacer
                </Button>
                <Button size="sm" variant="outline" onClick={handleConflictRename}
                  className="flex items-center gap-1 text-xs border-amber-400 text-amber-800 hover:bg-amber-100"
                  title="Garder les deux (renommage automatique)">
                  <Copy className="h-3 w-3" /> Garder les deux
                </Button>
                <Button size="sm" variant="ghost" onClick={handleConflictSkip}
                  className="flex items-center gap-1 text-xs text-gray-600" title="Ne pas copier ce fichier">
                  <X className="h-3 w-3" /> Ignorer
                </Button>
              </div>
              {conflictQueue.length > 0 && (
                <p className="text-xs text-amber-600">{conflictQueue.length} autre(s) conflit(s) en attente</p>
              )}
            </div>
          )}

          {/* Grille des 4 zones */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {DOCUMENT_ZONES.map((zone) => {
              const docsInZone = documentsByCategory[zone.category];
              const isDragOver = dragOverZone === zone.category;
              const isExpanded = expandedCategories.has(zone.category);
              const PREVIEW_COUNT = 3;
              const visibleDocs = isExpanded ? docsInZone : docsInZone.slice(0, PREVIEW_COUNT);
              const hiddenCount = docsInZone.length - PREVIEW_COUNT;

              return (
                <div key={zone.category} className="space-y-3">
                  {/* Zone de dépôt */}
                  <div
                    className={`
                      border-2 border-dashed rounded-lg p-4 text-center transition-all
                      ${isDragOver
                        ? `${zone.color} border-solid shadow-md`
                        : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'}
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
                          {docsInZone.length} document{docsInZone.length !== 1 ? 's' : ''}
                        </Badge>
                      </div>
                    </div>
                    <input
                      ref={(el) => { fileInputRefs.current[zone.category] = el; }}
                      type="file" multiple
                      accept=".pdf,.doc,.docx,.odt,.txt,.jpg,.jpeg,.png,.gif,.bmp,.webp,.html,.htm,.msg"
                      onChange={(e) => handleFileSelect(e, zone.category)}
                      className="hidden"
                    />
                  </div>

                  {/* Liste des documents (expandable) */}
                  {docsInZone.length > 0 && (
                    <div className="space-y-1.5">
                      <TooltipProvider>
                        {visibleDocs.map((doc) => (
                          <div
                            key={doc.id}
                            className="flex items-center justify-between px-2 py-1.5 bg-gray-50 rounded-md hover:bg-gray-100 transition-colors"
                          >
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              {getFileIcon(doc.type, 'h-3 w-3')}

                              {/* Zone cliquable avec tooltip au survol */}
                              <TooltipRoot delayDuration={400}>
                                <TooltipTrigger asChild>
                                  <div
                                    className="flex-1 min-w-0 cursor-pointer"
                                    onClick={() => handleOpenDocument(doc)}
                                  >
                                    <p className="text-xs font-medium text-gray-900 truncate">
                                      {doc.nomOriginal}
                                    </p>
                                    <div className="flex items-center gap-1 text-xs text-gray-500">
                                      <span>{formatFileSize(doc.taille)}</span>
                                      <ExternalLink className="h-2 w-2" />
                                    </div>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent
                                  side="right"
                                  className="bg-white text-gray-800 border border-gray-200 shadow-lg p-0 max-w-xs"
                                >
                                  <div className="p-2.5 space-y-1">
                                    <p className="font-semibold text-xs leading-tight break-all">
                                      {doc.nomOriginal}
                                    </p>
                                    <p className="text-xs text-gray-500">
                                      {TYPE_LABELS[doc.type] ?? 'Fichier'} · {formatFileSize(doc.taille)}
                                    </p>
                                    {doc.dateAjout && (
                                      <p className="text-xs text-gray-400">
                                        Ajouté le{' '}
                                        {format(new Date(doc.dateAjout), 'dd/MM/yyyy', { locale: fr })}
                                      </p>
                                    )}
                                    <p className="text-xs text-blue-500 mt-0.5">Cliquer pour ouvrir</p>
                                  </div>
                                </TooltipContent>
                              </TooltipRoot>
                            </div>

                            {isEditing && (
                              <Button
                                variant="ghost" size="sm"
                                className="h-6 w-6 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 flex-shrink-0"
                                onClick={() => handleDeleteDocument(doc)}
                                title="Supprimer le document"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        ))}
                      </TooltipProvider>

                      {/* Bouton expand / réduire */}
                      {docsInZone.length > PREVIEW_COUNT && (
                        <button
                          onClick={() => toggleExpand(zone.category)}
                          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline mt-1 ml-1 transition-colors"
                        >
                          {isExpanded ? (
                            <><ChevronUp className="h-3 w-3" /> Réduire</>
                          ) : (
                            <><ChevronDown className="h-3 w-3" /> Voir {hiddenCount} autre{hiddenCount > 1 ? 's' : ''}...</>
                          )}
                        </button>
                      )}
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
                    Mode : {enquete.useSubfolderForExternal !== false ? 'Sous-dossier enquête' : 'Dossier direct'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <AlertCircle className="h-4 w-4 text-yellow-600" />
                <p className="text-sm text-yellow-800">
                  Aucun chemin externe configuré — documents sauvegardés uniquement en interne
                </p>
              </div>
            )}

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
            <p><strong>Organisation :</strong> Classement automatique dans des dossiers par catégorie</p>
            {enquete.cheminExterne && (
              <p><strong>Sauvegarde double :</strong> Documents sauvegardés en interne + copie externe</p>
            )}
            <p><strong>Conflits :</strong> En cas de doublon, une bannière propose de remplacer, renommer ou ignorer</p>
            <p><strong>Survol :</strong> Passer la souris sur un document affiche ses informations détaillées</p>
            <p><strong>Synchronisation :</strong> "Synchroniser" vérifie que tous les documents sont présents aux deux endroits</p>
            <p><strong>Actualisation :</strong> "Actualiser" détecte les documents ajoutés manuellement dans le dossier</p>
          </div>
        </CardContent>
      </Card>

      <DocumentPathModal
        isOpen={showPathModal}
        onClose={() => setShowPathModal(false)}
        currentPath={enquete.cheminExterne || ''}
        currentUseSubfolder={enquete.useSubfolderForExternal ?? true}
        onSave={handleSaveExternalPath}
        enqueteNumero={enquete.numero}
      />

      <AnalyseDocumentsModal
        isOpen={showAnalyseModal}
        onClose={() => setShowAnalyseModal(false)}
        enquete={enquete}
        onApplyActes={(updates) => onUpdate(enquete.id, updates)}
      />
    </>
  );
});
