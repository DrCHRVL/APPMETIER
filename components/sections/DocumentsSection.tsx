import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
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
import { collectDropEntries, incomingFromFileList, serverRelPath, type Incoming } from '@/lib/web/folderUpload';
import { fileToMarkdown } from '@/lib/web/fileToMarkdown';
import { DocumentPathModal } from '../modals/DocumentPathModal';
import { AnalyseDocumentsModal } from '../modals/AnalyseDocumentsModal';
import { ServerDocumentScanner, type ScannedDocument } from '@/utils/documents/ServerDocumentScanner';
import { useEnquetesStore } from '@/stores/useEnquetesStore';
import { useUserStore } from '@/stores/useUserStore';
import { DocHoverPreview } from '@/components/DocHoverPreview';
import { DocumentSyncManager, SyncResult } from '@/utils/documents/DocumentSyncManager';
import { TooltipRoot, TooltipTrigger, TooltipContent, TooltipProvider } from '../ui/tooltip';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface DocumentsSectionProps {
  enquete: Enquete;
  onUpdate: (id: number, updates: Partial<Enquete>) => void;
  isEditing: boolean;
}

type DocumentCategory = 'geoloc' | 'ecoutes' | 'actes' | 'pv' | 'dml';

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
  },
  {
    category: 'dml',
    title: 'DML',
    icon: <FileText className="h-5 w-5" />,
    description: 'Demandes de mise en liberté — l\'attaché IA s\'appuie sur les anciennes pour actualiser',
    color: 'border-rose-300 bg-rose-50 hover:bg-rose-100'
  }
];

// ─── Singleton module-level : une seule paire timer/interval par enquête ID ───
// Garantit qu'aucun doublon ne s'accumule quand la modale est ouverte/fermée rapidement.
const _scanTimers = new Map<number, ReturnType<typeof setTimeout>>();
const _scanIntervals = new Map<number, ReturnType<typeof setInterval>>();

// ─── Versement d'arborescences : bornes de sécurité ───
// Limite serveur par pièce (au-delà : l'original est refusé — on verse alors
// son TEXTE intégral à la place, pour que l'IA puisse quand même l'analyser).
const MAX_DOC_BYTES = 50 * 1024 * 1024;
// Au-delà, la conversion markdown dans le navigateur devient elle-même risquée
// (mémoire pdf.js) : on laisse l'extraction au serveur (attaché, avec OCR).
const MAX_CONVERT_BYTES = 80 * 1024 * 1024;
// Un fichier « gros » est versé SEUL ; les petits partent par 3 en parallèle.
// C'est ce qui borne la mémoire : chaque pièce vit en ~4 exemplaires le temps
// de son dépôt (buffer, chiffré, base64, corps JSON).
const SOLO_BYTES = 8 * 1024 * 1024;
const PETIT_LOT = 3;
// Sauvegarde intermédiaire de la liste des documents (chaque écriture crée une
// version du coffre : on espace). La reprise répare de toute façon les trous.
const FLUSH_EVERY = 100;

/** Progression d'un versement en cours (arborescence ou lot de fichiers). */
interface UploadProgress { done: number; total: number; errors: number; current?: string }

/** Bilan de fin de versement d'arborescence — affiché sous forme dépliable. */
interface UploadReport {
  zone: string;
  ok: number;          // pièces versées (originaux, ou texte seul pour les > 50 Mo)
  dejaLa: number;      // sautées : déjà présentes à l'identique (reprise)
  md: number;          // copies texte pour l'IA disponibles
  nonPrisEnCharge: number;
  interrompu: boolean; // arrêt manuel ou session expirée
  avertissements: string[];
  echecs: string[];
}

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
  // Versements volumineux : progression visible, bilan détaillé, arrêt propre.
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [uploadReport, setUploadReport] = useState<UploadReport | null>(null);
  const cancelUploadRef = useRef(false);
  const [showPathModal, setShowPathModal] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'success' | 'error' | null>(null);
  const [pendingCommun, setPendingCommun] = useState(0);
  // Analyse IA des pièces téléversées (admin + attaché actif) : après un
  // dépôt dans une zone d'actes, une bannière PROPOSE l'analyse — détection
  // d'actes, incohérences (n° de procédure, NATINF), CR de réception. Le
  // texte des pièces est celui converti au téléversement (copies markdown) :
  // aucun scan de dossier réseau (l'édition bureau a disparu).
  const [showAnalyseModal, setShowAnalyseModal] = useState(false);
  const [autoAnalyseDocs, setAutoAnalyseDocs] = useState<ScannedDocument[] | null>(null);
  const [analyseSuggestion, setAnalyseSuggestion] = useState<ScannedDocument[] | null>(null);
  const aiOkRef = useRef<boolean | null>(null);

  // compteur de copies « dossier commun » en attente pour cette enquête
  const refreshPendingCommun = useCallback(async () => {
    try {
      if (typeof window === 'undefined') return;
      const fsa = await import('@/lib/web/folderAccess');
      const all = await fsa.pendingCopies();
      setPendingCommun(all.filter(j => j.enquete === String(enquete.numero)).length);
    } catch { /* IndexedDB indisponible */ }
  }, [enquete.numero]);
  useEffect(() => { refreshPendingCommun(); }, [refreshPendingCommun, copyStatus]);

  const retryPendingCommun = async () => {
    if (!enquete.cheminExterne) return;
    const ok = await window.siralBridge.validatePath(enquete.cheminExterne); // déclenche le rejeu de la file
    await refreshPendingCommun();
    if (ok) {
      const fsa = await import('@/lib/web/folderAccess');
      const left = (await fsa.pendingCopies()).filter(j => j.enquete === String(enquete.numero)).length;
      if (left === 0) {
        const docs = enquete.documents || [];
        if (docs.some(d => d.copieCommun === 'attente')) {
          onUpdate(enquete.id, { documents: docs.map(d => d.copieCommun === 'attente' ? { ...d, copieCommun: 'ok' as const } : d) });
        }
        showToast('Copies en attente déposées dans le dossier commun', 'success');
      }
    } else {
      showToast('Dossier commun toujours inaccessible', 'warning');
    }
  };

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
    pv: null,
    dml: null
  });
  // Sélecteurs de DOSSIERS entiers (webkitdirectory) — arborescence préservée
  const folderInputRefs = useRef<Record<DocumentCategory, HTMLInputElement | null>>({
    geoloc: null,
    ecoutes: null,
    actes: null,
    pv: null,
    dml: null
  });

  const { showToast } = useToast();

  // Liste de documents TOUJOURS à jour (prop re-rendue) : les sauvegardes
  // intermédiaires d'un long versement partent de là, pour ne jamais écraser
  // ce que la synchro automatique aurait ajouté entre-temps.
  const docsRef = useRef<DocumentEnquete[]>(enquete.documents || []);
  docsRef.current = enquete.documents || [];

  // Documents par catégorie — mémoïsés pour éviter les recalculs inutiles
  const documentsByCategory = useMemo(() => {
    // 1 seule passe au lieu de 4 .filter() — plus rapide pour les grosses listes
    const result: Record<DocumentCategory, DocumentEnquete[]> = {
      geoloc: [], ecoutes: [], actes: [], pv: [], dml: []
    };
    for (const doc of (enquete.documents || [])) {
      const path = doc.cheminRelatif;
      if (path.startsWith('MD/')) continue; // copies markdown pour l'IA : jamais listées
      if (path.startsWith('Geoloc/')) result.geoloc.push(doc);
      else if (path.startsWith('Ecoutes/')) result.ecoutes.push(doc);
      else if (path.startsWith('Actes/')) result.actes.push(doc);
      else if (path.startsWith('PV/')) result.pv.push(doc);
      else if (path.startsWith('DML/')) result.dml.push(doc);
    }
    return result;
  }, [enquete.documents]);

  // Ref toujours à jour vers scanForNewDocuments pour que l'interval appelle
  // la dernière version (et lise la liste de documents actuelle, pas celle du 1er render).
  const scanRef = useRef<(silent?: boolean) => void>(() => {});

  // ── useEffect : scan initial (délayé) + scan périodique — singleton par enquête ID ──
  useEffect(() => {
    // Ne créer un timer/interval que s'il n'en existe pas encore pour cette enquête
    if (!_scanIntervals.has(enquete.id)) {
      const timer = setTimeout(() => {
        scanRef.current(true);
      }, 1500);
      _scanTimers.set(enquete.id, timer);

      const interval = setInterval(() => {
        scanRef.current(true);
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

  // Fermer l'onglet pendant un versement = perdre le travail en cours :
  // le navigateur demande confirmation tant qu'un téléversement tourne.
  useEffect(() => {
    if (!isUploading) return;
    const garde = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', garde);
    return () => window.removeEventListener('beforeunload', garde);
  }, [isUploading]);

  // Passer au conflit suivant dans la file
  useEffect(() => {
    if (!currentConflict && conflictQueue.length > 0) {
      const [next, ...rest] = conflictQueue;
      setCurrentConflict(next);
      setConflictQueue(rest);
    }
  }, [currentConflict, conflictQueue]);

  // Ref pour lire l'état scanning à jour depuis l'interval singleton
  const isScanningRef = useRef(false);

  // ── Scan des nouveaux documents ──
  const scanForNewDocuments = async (silent = false) => {
    if (!window.siralBridge) {
      if (!silent) showToast('Pont de données indisponible', 'error');
      return;
    }
    if (isScanningRef.current) return;

    isScanningRef.current = true;
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
      isScanningRef.current = false;
      setIsScanning(false);
    }
  };

  // Tenir la ref du scan à jour à chaque render pour que l'interval lise la dernière version
  scanRef.current = scanForNewDocuments;

  // ── Synchronisation externe ──
  // `silent` : pas de toast ni d'indicateur (utilisé par la synchro automatique).
  const synchronizeDocuments = async (silent = false) => {
    if (!window.siralBridge) { if (!silent) showToast('Pont de données indisponible', 'error'); return; }
    if (!enquete.cheminExterne) { if (!silent) showToast('Aucun chemin externe configuré', 'warning'); return; }

    if (!silent) setIsSyncing(true);
    try {
      const syncResult = await DocumentSyncManager.synchronizeDocuments(
        enquete.numero,
        enquete.cheminExterne,
        enquete.useSubfolderForExternal !== false
      );
      if (!silent) setLastSyncResult(syncResult);

      if (!syncResult.externalAccessible) {
        if (!silent) showToast('Chemin externe inaccessible actuellement', 'warning');
        return;
      }

      const { addedToInternal: ai, addedToExternal: ae, importedDocs } = syncResult;

      // Fusionner les documents importés depuis le commun (P:\) dans la liste de
      // l'enquête, puis marquer l'ensemble comme copié au commun. Dédup par chemin.
      const current = enquete.documents || [];
      const knownRels = new Set(current.map(d => d.cheminRelatif));
      const toAdd = (importedDocs || []).filter(d => !knownRels.has(d.cheminRelatif));
      // Documents présents en interne mais introuvables / non copiés sur le commun :
      // ils reçoivent le statut 'absent' (badge « ✗ commun » rouge). Les autres sont 'ok'.
      const notOnCommun = new Set(syncResult.notOnCommun || []);
      const statusFor = (rel: string): 'ok' | 'absent' => (notOnCommun.has(rel) ? 'absent' : 'ok');
      const changed = toAdd.length > 0 || current.some(d => d.copieCommun !== statusFor(d.cheminRelatif));
      if (changed) {
        const merged = [...current, ...toAdd].map(d => ({ ...d, copieCommun: statusFor(d.cheminRelatif) }));
        onUpdate(enquete.id, { documents: merged });
      }

      if (!silent) {
        if (syncResult.errors.length > 0) {
          syncResult.errors.forEach(e => console.error('Erreur sync:', e));
          showToast('Des erreurs sont survenues lors de la synchronisation', 'warning');
        } else if (ai.length === 0 && ae.length === 0) {
          showToast('Tous les documents sont déjà synchronisés', 'success');
        } else {
          showToast(`Synchronisation terminée : ${ai.length} ajoutés en interne, ${ae.length} en externe`, 'success');
        }
      }
    } catch (err) {
      console.error('Erreur synchronisation:', err);
      if (!silent) showToast('Erreur lors de la synchronisation des documents', 'error');
    } finally {
      if (!silent) setIsSyncing(false);
    }
  };

  // Ref toujours à jour vers la synchro, pour que la boucle automatique appelle
  // la dernière version (liste de documents et chemin courants).
  const syncRef = useRef<(silent?: boolean) => void>(() => {});
  syncRef.current = synchronizeDocuments;

  // ── Synchro automatique (web uniquement) ──
  // Tant que l'app est ouverte sur un poste qui voit le dossier commun (P:\) connecté
  // au navigateur, on réconcilie P:\ ↔ serveur en silence, en boucle — à condition
  // que le chemin soit une poignée de dossier choisie dans le navigateur (fsa://).
  // Un ancien chemin Windows brut (P:\…) n'est pas exploitable : on n'essaie pas.
  useEffect(() => {
    const p = enquete.cheminExterne || '';
    if (!p.startsWith('fsa://')) return;
    let cancelled = false;
    const run = () => { if (!cancelled) syncRef.current(true); };
    const first = setTimeout(run, 4000);             // une fois, peu après l'ouverture
    const loop = setInterval(run, 5 * 60 * 1000);    // puis toutes les 5 minutes
    return () => { cancelled = true; clearTimeout(first); clearInterval(loop); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enquete.cheminExterne, enquete.id]);

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
    const valid = ['.pdf','.doc','.docx','.odt','.txt','.md','.rtf','.eml','.xlsx','.xlsm','.xls','.ods','.csv','.jpg','.jpeg','.png','.gif','.bmp','.webp','.html','.htm','.msg'];
    return valid.some(ext => file.name.toLowerCase().endsWith(ext));
  };

  // ── Upload effectif après résolution de conflits ──
  const uploadFiles = async (
    filesToUpload: { file: File; renamedTo?: string }[],
    category: DocumentCategory
  ) => {
    if (!window.siralBridge) { showToast('Pont de données indisponible', 'error'); return; }

    setIsUploading(true);
    setCopyStatus(null);

    const categoryMapping: Record<DocumentCategory, string> = {
      geoloc: 'Geoloc', ecoutes: 'Ecoutes', actes: 'Actes', pv: 'PV', dml: 'DML'
    };
    const serverCategory = categoryMapping[category];

    if (filesToUpload.length > 1) {
      setUploadProgress({ done: 0, total: filesToUpload.length, errors: 0 });
    }
    try {
      // Par petits lots : ne JAMAIS charger tous les fichiers en mémoire d'un
      // coup (un dépôt de dizaines de PDF saturait l'onglet avant le premier octet envoyé).
      // Un lot en échec n'efface pas les précédents : tout ce qui a été déposé
      // est enregistré dans la liste — jamais de pièces orphelines sur le serveur.
      const savedFiles: DocumentEnquete[] = [];
      const savedSpecs: { file: File; renamedTo?: string }[] = [];
      let chunkError: string | null = null;
      const CHUNK = 4;
      for (let i = 0; i < filesToUpload.length; i += CHUNK) {
        const tranche = filesToUpload.slice(i, i + CHUNK);
        try {
          const filesData = await Promise.all(
            tranche.map(async ({ file, renamedTo }) => ({
              name: renamedTo || file.name,
              arrayBuffer: await file.arrayBuffer()
            }))
          );
          const saved = ((await window.siralBridge.saveDocuments(
            enquete.numero, filesData, serverCategory
          )) || []) as DocumentEnquete[];
          savedFiles.push(...saved);
          savedSpecs.push(...tranche.slice(0, saved.length));
        } catch (err) {
          chunkError = err instanceof Error ? err.message : String(err);
          break;
        }
        setUploadProgress((p) => (p ? { ...p, done: Math.min(p.total, i + tranche.length) } : p));
      }

      if (chunkError) {
        console.error('Erreur upload:', chunkError);
        showToast(
          savedFiles.length > 0
            ? `Dépôt interrompu après ${savedFiles.length} document(s) : ${chunkError}`
            : `Erreur lors de l'upload : ${chunkError}`,
          'error'
        );
      }

      if (savedFiles && savedFiles.length > 0) {
        // Copie vers le dossier commun d'abord, pour annoter chaque document
        // du badge « copié ✓ » ou « en attente » dès son apparition dans la liste.
        let copieCommun: 'ok' | 'attente' | undefined;
        if (enquete.cheminExterne) {
          try {
            const ok = await window.siralBridge.copyToExternalPath(
              enquete.numero, enquete.cheminExterne, savedFiles,
              serverCategory, enquete.useSubfolderForExternal ?? true
            );
            copieCommun = ok ? 'ok' : 'attente';
            setCopyStatus(ok ? 'success' : 'error');
          } catch {
            copieCommun = 'attente';
            setCopyStatus('error');
          }
        }
        const annotated = copieCommun
          ? savedFiles.map((f: DocumentEnquete) => ({ ...f, copieCommun }))
          : savedFiles;
        onUpdate(enquete.id, { documents: [...(enquete.documents || []), ...annotated] });
        if (!chunkError) {
          showToast(
            `${savedFiles.length} document(s) ajoutés dans ${DOCUMENT_ZONES.find(z => z.category === category)?.title}`,
            'success'
          );
        }

        // Copie markdown « pour l'IA » de chaque document (best-effort, silencieux).
        // Le texte converti sert AUSSI à la proposition d'analyse ci-dessous —
        // mais on ne le GARDE en mémoire que si la zone y est éligible, et
        // borné (la proposition n'affiche que les 40 premières pièces).
        const convertis: ScannedDocument[] = [];
        const suivrePourAnalyse = ANALYSE_CATEGORIES.includes(category);
        for (let i = 0; i < annotated.length; i++) {
          const rel = String(annotated[i]?.cheminRelatif || '');
          const spec = savedSpecs[i];
          if (!rel || !spec) continue;
          setUploadProgress((p) => (p ? { ...p, current: `Conversion texte : ${spec.file.name}` } : p));
          const markdown = await deposerCopieMarkdown(spec.file, rel);
          if (markdown && markdown.trim().length >= 40 && suivrePourAnalyse && convertis.length < 40) {
            convertis.push({
              filePath: rel,
              fileName: spec.renamedTo || spec.file.name,
              sourceFolder: serverCategory,
              textContent: markdown,
            });
          }
        }

        // Synchro automatique au téléversement : réconcilie aussi P:\ → serveur
        // si des fichiers y ont été déposés à la main. Silencieux, dédupliqué.
        if (enquete.cheminExterne?.startsWith('fsa://')) {
          setTimeout(() => syncRef.current(true), 1500);
        }

        // L'analyse au téléversement ne se LANCE pas toute seule (trop
        // intrusif) : quand l'analyse IA de l'attaché est disponible (admin),
        // une bannière PROPOSE d'analyser les pièces déposées — détection
        // d'actes, incohérences, CR de réception. Un clic, rien d'automatique.
        await suggererAnalyse(convertis, category);
      } else if (!chunkError) {
        showToast('Erreur lors de la sauvegarde des documents', 'error');
      }
    } catch (err) {
      console.error('Erreur upload:', err);
      showToast(err instanceof Error && err.message ? `Erreur lors de l'upload : ${err.message}` : "Erreur lors de l'upload des documents", 'error');
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
    }
  };

  /**
   * Copie markdown « pour l'IA » d'un document téléversé : convertie dans CE
   * navigateur, déposée sous MD/<chemin>.md — invisible dans les zones, mais
   * lue en priorité par l'attaché (zéro ré-extraction, tokens économisés).
   * Best-effort : un échec de conversion n'empêche jamais le dépôt du fichier.
   */
  const deposerCopieMarkdown = async (file: File, relOriginal: string): Promise<string | null> => {
    if (/\.(jpg|jpeg|png|gif|bmp|webp|msg)$/i.test(file.name)) return null;
    try {
      const { markdown } = await fileToMarkdown(file);
      if (!markdown.trim()) return null;
      const mdRel = 'MD/' + relOriginal.replace(/\.[^./]+$/, '') + '.md';
      const bytes = new TextEncoder().encode(markdown);
      await window.siralBridge.depositDocument(
        enquete.numero, mdRel,
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        'MD', file.name
      );
      return markdown;
    } catch { return null; /* conversion impossible (scan, format exotique) : l'original suffit */ }
  };

  /**
   * Après un téléversement dans une zone d'ACTES (Actes, Geoloc, Écoutes, DML) :
   * propose l'analyse IA des pièces déposées — détection d'actes, chaîne
   * légale, incohérences (n° de procédure ≠ enquête, NATINF absents) et CR de
   * réception. NON intrusif : une bannière propose, le magistrat décide.
   * Réservé à l'administrateur quand l'attaché est actif (sonde en cache).
   */
  const ANALYSE_CATEGORIES: DocumentCategory[] = ['actes', 'geoloc', 'ecoutes', 'dml'];
  const suggererAnalyse = async (docs: ScannedDocument[], category: DocumentCategory) => {
    if (!docs.length || !ANALYSE_CATEGORIES.includes(category)) return;
    if (aiOkRef.current === null) {
      aiOkRef.current = await ServerDocumentScanner.isAIAvailable().catch(() => false);
    }
    if (!aiOkRef.current) return;
    setAnalyseSuggestion(prev => {
      const seen = new Set((prev || []).map(d => d.fileName));
      return [...(prev || []), ...docs.filter(d => !seen.has(d.fileName))].slice(0, 40);
    });
  };

  /**
   * Versement d'une ARBORESCENCE dans une zone : chaque fichier garde son
   * chemin relatif (sous-pochettes comprises) sous <Zone>/… + copie markdown.
   *
   * Conçu pour des dossiers d'enquête ENTIERS (milliers de pièces) :
   *  - pas de plafond silencieux : tout est traité, dans l'ordre ;
   *  - mémoire bornée — petits fichiers par 3, les gros (≥ 8 Mo) un par un ;
   *  - progression visible, arrêt propre, bilan détaillé des échecs ;
   *  - REPRISE : re-déposer le même dossier saute les pièces déjà versées
   *    (comparaison chemin + taille avec l'index serveur) et complète le
   *    reste — aucun doublon, même après un onglet fermé en cours de route ;
   *  - pièce > 50 Mo (limite serveur) : son TEXTE intégral est versé à la
   *    place, pour que l'IA puisse quand même l'analyser.
   */
  const uploadTree = async (incoming: Incoming[], category: DocumentCategory) => {
    if (!window.siralBridge) { showToast('Pont de données indisponible', 'error'); return; }
    const categoryMapping: Record<DocumentCategory, string> = {
      geoloc: 'Geoloc', ecoutes: 'Ecoutes', actes: 'Actes', pv: 'PV', dml: 'DML'
    };
    const zone = categoryMapping[category];
    const valid = incoming.filter(({ file }) => isValidFileType(file));
    const ecartes = incoming.filter(({ file }) => !isValidFileType(file));
    const nonPrisEnCharge = ecartes.length;
    if (!valid.length) {
      showToast('Aucun fichier pris en charge dans ce dossier', 'warning');
      return;
    }

    setIsUploading(true);
    cancelUploadRef.current = false;
    setUploadReport(null);
    setUploadProgress({ done: 0, total: valid.length, errors: 0 });

    try {
      // Index serveur : base de la déduplication ET de la reprise. Une pièce
      // déjà déposée à l'identique (même chemin, même taille) est sautée.
      let serverIndex = new Map<string, number>();
      try {
        const metas = await window.siralBridge.listServerDocuments(enquete.numero) as Array<{ rel: string; size: number }>;
        serverIndex = new Map((metas || []).map((m) => [String(m.rel), Number(m.size) || 0]));
      } catch { /* index injoignable : les dépôts échoueront de toute façon avec un motif clair */ }

      // taille stockée = taille réelle + 32 octets (magic + IV + tag GCM)
      const ENC_OVERHEAD = 32;
      const stateDocs = enquete.documents || [];
      const stateRels = new Set(stateDocs.map(d => d.cheminRelatif));
      const plannedRels = new Set<string>([...stateRels, ...serverIndex.keys()]);

      interface PlanItem { file: File; rel: string; dejaVerse: boolean }
      const plan: PlanItem[] = [];
      const echecs: string[] = [];
      const avertissements: string[] = [];
      // fichiers écartés : nommés dans le bilan (le compte seul ne dit rien)
      for (const { path } of ecartes.slice(0, 30)) {
        avertissements.push(`${path} — format non pris en charge, fichier non versé`);
      }
      if (ecartes.length > 30) avertissements.push(`… et ${ecartes.length - 30} autre(s) fichier(s) non pris en charge`);
      for (const { file, path } of valid) {
        const relIdeal = serverRelPath(zone, path);
        if (!relIdeal) { echecs.push(`${path} — chemin invalide après nettoyage`); continue; }
        const dotIdeal = relIdeal.lastIndexOf('.');
        const hasExt = dotIdeal > relIdeal.lastIndexOf('/');
        let rel = relIdeal;
        let counter = 1;
        let dejaVerse = false;
        for (;;) {
          // même chemin (suffixé ou non) + même taille sur le serveur = même
          // pièce déjà versée lors d'un passage précédent : on la saute (reprise)
          if (serverIndex.get(rel) === file.size + ENC_OVERHEAD) { dejaVerse = true; break; }
          if (!plannedRels.has(rel)) break;
          rel = hasExt ? `${relIdeal.slice(0, dotIdeal)}_${counter}${relIdeal.slice(dotIdeal)}` : `${relIdeal}_${counter}`;
          counter++;
        }
        if (!dejaVerse) plannedRels.add(rel);
        plan.push({ file, rel, dejaVerse });
      }
      // total réel après planification (chemins dégénérés déjà en échec)
      setUploadProgress({ done: 0, total: plan.length, errors: echecs.length });

      // Groupes bornés en mémoire : gros fichiers seuls, petits par 3.
      const groups: PlanItem[][] = [];
      let lot: PlanItem[] = [];
      for (const item of plan) {
        if (item.file.size >= SOLO_BYTES) {
          if (lot.length) { groups.push(lot); lot = []; }
          groups.push([item]);
        } else {
          lot.push(item);
          if (lot.length >= PETIT_LOT) { groups.push(lot); lot = []; }
        }
      }
      if (lot.length) groups.push(lot);

      // Sauvegarde de la liste au fil de l'eau (par paliers) : repart TOUJOURS
      // de la liste courante (docsRef) et dédoublonne par chemin — ni écrasement
      // de la synchro automatique, ni entrée en double d'un flush à l'autre.
      const added: DocumentEnquete[] = [];
      let flushed = 0;
      const flushState = () => {
        if (added.length > flushed) {
          const base = docsRef.current || [];
          const seen = new Set(base.map(d => d.cheminRelatif));
          const fresh = added.filter(d => !seen.has(d.cheminRelatif));
          if (fresh.length) onUpdate(enquete.id, { documents: [...base, ...fresh] });
          flushed = added.length;
        }
      };

      const convertis: ScannedDocument[] = [];
      const suivrePourAnalyse = ANALYSE_CATEGORIES.includes(category);
      let ok = 0, dejaLa = 0, md = 0;
      let sessionPerdue = false;

      const convertible = (f: File) => !/\.(jpg|jpeg|png|gif|bmp|webp|msg)$/i.test(f.name);
      const relCourt = (rel: string) => rel.slice(zone.length + 1);
      const buildMeta = (rel: string, nomOriginal: string, taille: number): DocumentEnquete => ({
        id: Date.now() + added.length,
        nom: rel.split('/').pop() || nomOriginal,
        nomOriginal,
        extension: '.' + (rel.split('.').pop() || ''),
        taille,
        dateAjout: new Date().toISOString(),
        cheminRelatif: rel,
        type: (rel.toLowerCase().endsWith('.pdf') ? 'pdf'
          : /\.docx$/i.test(rel) ? 'docx'
          : /\.doc$/i.test(rel) ? 'doc'
          : /\.odt$/i.test(rel) ? 'odt'
          : /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(rel) ? 'image'
          : /\.html?$/i.test(rel) ? 'html'
          : /\.msg$/i.test(rel) ? 'msg'
          : /\.(txt|md)$/i.test(rel) ? 'txt' : 'autre') as DocumentEnquete['type'],
      });

      /** Copie markdown pour l'IA — sautée si déjà sur le serveur (reprise). */
      const verserCopieTexte = async (file: File, rel: string) => {
        if (!convertible(file)) return;
        const mdRel = 'MD/' + rel.replace(/\.[^./]+$/, '') + '.md';
        if (serverIndex.has(mdRel)) { md++; return; }
        if (file.size > MAX_CONVERT_BYTES) {
          avertissements.push(`${relCourt(rel)} — trop volumineux pour la conversion texte dans le navigateur (l'attaché fera l'extraction côté serveur, OCR si besoin)`);
          return;
        }
        const markdown = await deposerCopieMarkdown(file, rel);
        if (markdown) {
          md++;
          if (suivrePourAnalyse && markdown.trim().length >= 40 && convertis.length < 40) {
            convertis.push({ filePath: rel, fileName: file.name, sourceFolder: zone, textContent: markdown });
          }
        } else {
          avertissements.push(`${relCourt(rel)} — conversion texte impossible (scan sans couche texte ? l'attaché fera l'extraction côté serveur, OCR si besoin)`);
        }
      };

      const traiterUn = async ({ file, rel, dejaVerse }: PlanItem) => {
        setUploadProgress((p) => (p ? { ...p, current: file.name } : p));
        try {
          if (dejaVerse) {
            dejaLa++;
            // pièce déjà sur le serveur mais absente de la liste (versement
            // interrompu avant sauvegarde) : on répare la liste sans re-téléverser
            if (!stateRels.has(rel)) added.push(buildMeta(rel, file.name, file.size));
            await verserCopieTexte(file, rel);
          } else if (file.size > MAX_DOC_BYTES) {
            // Original au-delà de la limite serveur (50 Mo/pièce) : versement
            // du TEXTE intégral à la place — la pièce reste analysable par l'IA.
            if (!convertible(file) || file.size > MAX_CONVERT_BYTES) {
              throw new Error(`dépasse la limite de 50 Mo par pièce (${Math.round(file.size / 1024 / 1024)} Mo) — à scinder avant versement`);
            }
            const texteRel = rel.replace(/\.[^./]+$/, '') + '_TEXTE.md';
            if (serverIndex.has(texteRel)) {
              // texte déjà versé lors d'un passage précédent (reprise)
              dejaLa++; md++;
              if (!stateRels.has(texteRel)) added.push(buildMeta(texteRel, file.name, serverIndex.get(texteRel) || 0));
              setUploadProgress((p) => (p ? { ...p, done: p.done + 1, errors: echecs.length } : p));
              return;
            }
            // plafond de conversion relevé : ce texte devient LA pièce conservée
            const { markdown } = await fileToMarkdown(file, { maxChars: 1_500_000 });
            if (!markdown.trim()) throw new Error('dépasse 50 Mo et aucun texte extractible — à scinder avant versement');
            const bytes = new TextEncoder().encode(markdown);
            const cleanRel = String(await window.siralBridge.depositDocument(
              enquete.numero, texteRel,
              bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
              zone, file.name
            ));
            ok++; md++;
            added.push(buildMeta(cleanRel, file.name, bytes.length));
            avertissements.push(`${relCourt(rel)} — original de ${Math.round(file.size / 1024 / 1024)} Mo non conservé (limite : 50 Mo par pièce) ; son texte intégral a été versé à la place`);
            if (suivrePourAnalyse && markdown.trim().length >= 40 && convertis.length < 40) {
              convertis.push({ filePath: cleanRel, fileName: file.name, sourceFolder: zone, textContent: markdown });
            }
          } else {
            const buf = await file.arrayBuffer();
            let cleanRel: string;
            try {
              cleanRel = String(await window.siralBridge.depositDocument(enquete.numero, rel, buf, zone, file.name));
            } catch (e1) {
              // un seul rejeu, pour les aléas réseau — jamais sur une session
              // expirée ni une erreur de programmation (TypeError), où rejouer ne peut rien
              if (e1 instanceof TypeError || (e1 instanceof Error && /session expirée/i.test(e1.message))) throw e1;
              await new Promise(r => setTimeout(r, 2000));
              cleanRel = String(await window.siralBridge.depositDocument(enquete.numero, rel, buf, zone, file.name));
            }
            ok++;
            added.push(buildMeta(cleanRel, file.name, file.size));
            await verserCopieTexte(file, cleanRel);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/session expirée/i.test(msg)) sessionPerdue = true;
          echecs.push(`${relCourt(rel)} — ${msg}`);
        }
        setUploadProgress((p) => (p ? { ...p, done: p.done + 1, errors: echecs.length } : p));
      };

      let panneGenerale = false;
      for (const group of groups) {
        if (cancelUploadRef.current || sessionPerdue) break;
        // panne générale (serveur KO, bug…) : rien ne passe et tout échoue —
        // on s'arrête au lieu de mouliner des centaines de dépôts perdus d'avance
        if (echecs.length >= 8 && ok === 0 && dejaLa === 0) { panneGenerale = true; break; }
        await Promise.all(group.map(traiterUn));
        if (added.length - flushed >= FLUSH_EVERY) flushState();
      }
      flushState();

      const interrompu = cancelUploadRef.current || sessionPerdue || panneGenerale;
      await suggererAnalyse(convertis, category);
      setUploadReport({
        zone: DOCUMENT_ZONES.find(z => z.category === category)?.title || zone,
        ok, dejaLa, md, nonPrisEnCharge, interrompu,
        avertissements, echecs,
      });
      showToast(
        interrompu
          ? `Versement ${sessionPerdue ? 'interrompu (session expirée — reconnectez-vous)' : panneGenerale ? 'arrêté : les premiers dépôts ont tous échoué (voir le détail des échecs)' : 'arrêté'} : ${ok} pièce(s) versée(s). Re-déposez le même dossier pour terminer, rien ne sera dupliqué.`
          : `${ok} pièce(s) versée(s) dans ${DOCUMENT_ZONES.find(z => z.category === category)?.title}` +
            `${dejaLa ? ` · ${dejaLa} déjà présente(s) (reprise)` : ''}` +
            `${nonPrisEnCharge ? ` · ${nonPrisEnCharge} non pris en charge` : ''}` +
            `${echecs.length ? ` · ${echecs.length} échec(s) — détail sous les zones` : ''}`,
        interrompu || echecs.length ? 'warning' : 'success'
      );
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
    }
  };

  // ── Traitement des fichiers (validation + détection conflits) ──
  const handleFiles = async (files: FileList | File[], category: DocumentCategory) => {
    if (!window.siralBridge) { showToast('Pont de données indisponible', 'error'); return; }

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
      const deleted = await window.siralBridge?.deleteDocument(
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

  // ── Drag & drop — fichiers OU dossiers entiers (récursif, sous-pochettes) ──
  const handleDrop = async (e: React.DragEvent, category: DocumentCategory) => {
    e.preventDefault();
    setDragOverZone(null);
    if (isUploading) { showToast('Un versement est déjà en cours — attendez la fin ou arrêtez-le', 'warning'); return; }
    const items = e.dataTransfer.items;
    const flatFiles = e.dataTransfer.files;
    // Parcours récursif : détecte les dossiers déposés et préserve l'arborescence.
    // Résilient : une entrée illisible (fichier verrouillé, partage réseau
    // décroché) est comptée et signalée, jamais bloquante.
    let illisibles = 0;
    let incoming: Incoming[] = [];
    try {
      incoming = items?.length ? await collectDropEntries(items, () => { illisibles++; }) : [];
    } catch { incoming = []; }
    if (illisibles > 0) {
      showToast(`${illisibles} élément(s) illisible(s) ignoré(s) (fichier verrouillé ou partage réseau décroché)`, 'warning');
    }
    if (incoming.some((i) => i.path.includes('/'))) {
      await uploadTree(incoming, category);
      return;
    }
    if (flatFiles.length > 0) handleFiles(flatFiles, category);
    else if (incoming.length > 0) handleFiles(incoming.map((i) => i.file), category);
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
    if (!window.siralBridge) { showToast('Pont de données indisponible', 'error'); return; }
    try {
      const ok = await window.siralBridge.openDocument(enquete.numero, doc.cheminRelatif);
      if (!ok) showToast(`Impossible d'ouvrir "${doc.nomOriginal}"`, 'error');
    } catch { showToast("Erreur lors de l'ouverture du document", 'error'); }
  };

  const handleDeleteDocument = async (doc: DocumentEnquete) => {
    if (!window.siralBridge) { showToast('Pont de données indisponible', 'error'); return; }
    if (!confirm(`Êtes-vous sûr de vouloir supprimer "${doc.nomOriginal}" ?`)) return;
    try {
      const ok = await window.siralBridge.deleteDocument(
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
              {enquete.cheminExterne && (
                <Button
                  variant="outline" size="sm"
                  onClick={() => synchronizeDocuments()}
                  disabled={isSyncing}
                  className="flex items-center gap-2"
                  title="Synchroniser les documents entre interne et externe"
                >
                  {isSyncing ? <Loader className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {isSyncing ? 'Synchro...' : 'Synchroniser'}
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
          {/* Progression du versement en cours (arborescences et gros lots) :
              compteur, pièce en cours, arrêt propre — et rappel que la reprise
              est possible sans doublon si l'onglet se ferme. */}
          {uploadProgress && (
            <div className="space-y-1.5 rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-2">
              <div className="flex items-center gap-2">
                <Loader className="h-4 w-4 flex-shrink-0 animate-spin text-blue-600" />
                <p className="min-w-0 flex-1 text-xs text-blue-900">
                  <span className="font-semibold">
                    Versement en cours — {uploadProgress.done}/{uploadProgress.total}
                  </span>
                  {uploadProgress.errors > 0 && (
                    <span className="font-medium text-red-600"> · {uploadProgress.errors} échec(s)</span>
                  )}
                  {uploadProgress.current && (
                    <span className="block truncate text-blue-700/80">{uploadProgress.current}</span>
                  )}
                </p>
                <Button
                  size="sm" variant="ghost"
                  className="h-7 flex-shrink-0 text-xs text-blue-600 hover:text-blue-800"
                  onClick={() => { cancelUploadRef.current = true; }}
                  title="Arrêter après la pièce en cours — re-déposer le même dossier reprendra où le versement s'est arrêté"
                >
                  <X className="h-3 w-3" /> Arrêter
                </Button>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-blue-100">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all"
                  style={{ width: `${Math.round((uploadProgress.done / Math.max(1, uploadProgress.total)) * 100)}%` }}
                />
              </div>
              <p className="text-[10.5px] text-blue-700/70">
                Gardez cet onglet ouvert. Chaque pièce est convertie en texte pour l&apos;IA au passage.
                Un versement interrompu se reprend en re-déposant le même dossier — aucun doublon.
              </p>
            </div>
          )}

          {/* Bilan du dernier versement d'arborescence : chiffres + détail
              dépliable des échecs et avertissements (pièce par pièce). */}
          {uploadReport && !uploadProgress && (
            <div className="space-y-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1">
                  <span className="font-semibold">{uploadReport.zone}</span> : {uploadReport.ok} pièce(s) versée(s)
                  {uploadReport.dejaLa > 0 && <> · {uploadReport.dejaLa} déjà présente(s), sautée(s)</>}
                  {uploadReport.md > 0 && <> · {uploadReport.md} copie(s) texte pour l&apos;IA</>}
                  {uploadReport.nonPrisEnCharge > 0 && <> · {uploadReport.nonPrisEnCharge} format(s) non pris en charge</>}
                  {uploadReport.interrompu && (
                    <span className="font-medium text-amber-700"> · interrompu — re-déposez le même dossier pour terminer (reprise sans doublon)</span>
                  )}
                </p>
                <button
                  onClick={() => setUploadReport(null)}
                  className="flex-shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                  title="Fermer ce bilan"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {uploadReport.echecs.length > 0 && (
                <details>
                  <summary className="cursor-pointer font-medium text-red-600">
                    {uploadReport.echecs.length} échec(s) — détail
                  </summary>
                  <ul className="mt-1 list-inside list-disc space-y-0.5 text-[11px] text-red-700/90">
                    {uploadReport.echecs.slice(0, 50).map((s, i) => <li key={i} className="break-all">{s}</li>)}
                    {uploadReport.echecs.length > 50 && <li>… et {uploadReport.echecs.length - 50} autre(s)</li>}
                  </ul>
                </details>
              )}
              {uploadReport.avertissements.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-amber-600">
                    {uploadReport.avertissements.length} avertissement(s)
                  </summary>
                  <ul className="mt-1 list-inside list-disc space-y-0.5 text-[11px] text-gray-500">
                    {uploadReport.avertissements.slice(0, 50).map((s, i) => <li key={i} className="break-all">{s}</li>)}
                    {uploadReport.avertissements.length > 50 && <li>… et {uploadReport.avertissements.length - 50} autre(s)</li>}
                  </ul>
                </details>
              )}
            </div>
          )}

          {/* Proposition d'analyse IA des pièces qui viennent d'être téléversées
              (admin + attaché actif) : détection d'actes, incohérences de numéro
              de procédure / NATINF, CR de réception. Un clic — jamais automatique. */}
          {analyseSuggestion && analyseSuggestion.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2">
              <Search className="h-4 w-4 text-violet-600 flex-shrink-0" />
              <p className="min-w-0 flex-1 text-xs text-violet-900">
                <span className="font-semibold">{analyseSuggestion.length} pièce(s) téléversée(s)</span>{' '}
                prête(s) pour l&apos;analyse IA : détection des actes, contrôle du numéro de procédure et des NATINF, CR de réception.
              </p>
              <Button
                size="sm"
                className="h-7 gap-1 bg-violet-600 text-white hover:bg-violet-700"
                onClick={() => { setAutoAnalyseDocs(analyseSuggestion); setAnalyseSuggestion(null); setShowAnalyseModal(true); }}
              >
                <Search className="h-3 w-3" />
                Analyser (IA)
              </Button>
              <Button
                size="sm" variant="ghost"
                className="h-7 text-xs text-violet-500 hover:text-violet-700"
                onClick={() => setAnalyseSuggestion(null)}
              >
                Ignorer
              </Button>
            </div>
          )}

          {/* Résultat de la dernière synchronisation */}
          {lastSyncResult && (
            <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
              <h3 className="font-medium text-blue-800 mb-1">Dernière synchronisation</h3>
              <div className="text-xs text-blue-700 space-y-1">
                <p>Documents internes : {lastSyncResult.totalInternal}</p>
                <p>Documents externes : {lastSyncResult.totalExternal}</p>
                {lastSyncResult.addedToInternal.length > 0 && <p>Ajoutés en interne : {lastSyncResult.addedToInternal.length}</p>}
                {lastSyncResult.addedToExternal.length > 0 && <p>Ajoutés en externe : {lastSyncResult.addedToExternal.length}</p>}
                {lastSyncResult.errors.length > 0 && (
                  <div className="text-red-600">
                    <p className="font-medium">Erreurs : {lastSyncResult.errors.length}</p>
                    {/* Détail concis des erreurs : pour la plupart, des documents non copiés sur le commun. */}
                    <ul className="mt-0.5 space-y-0.5 text-[11px] leading-tight text-red-600/90">
                      {lastSyncResult.errors.map((e, i) => (
                        <li key={i} className="truncate" title={e}>• {e}</li>
                      ))}
                    </ul>
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

          {/* Grille des zones — la zone DML (détention provisoire) n'a de sens
              que pour un dossier À L'INSTRUCTION : masquée ailleurs, sauf si des
              DML y ont déjà été déposées (jamais de documents inaccessibles). */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {DOCUMENT_ZONES.filter((zone) =>
              zone.category !== 'dml'
              || enquete.statut === 'instruction'
              || documentsByCategory.dml.length > 0
            ).map((zone) => {
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
                          {isUploading ? 'Upload...' : 'Cliquer ou glisser-déposer — dossiers entiers acceptés (sous-pochettes préservées)'}
                        </p>
                        <div className="mt-1 flex items-center justify-center gap-1.5">
                          <Badge variant="outline" className="text-xs">
                            {docsInZone.length} document{docsInZone.length !== 1 ? 's' : ''}
                          </Badge>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); folderInputRefs.current[zone.category]?.click(); }}
                            className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[10.5px] font-medium text-gray-600 hover:bg-gray-100"
                            title="Téléverser un DOSSIER entier — sous-pochettes comprises, organisation préservée, copies markdown pour l'IA"
                          >
                            <FolderOpen className="h-3 w-3" />Dossier
                          </button>
                        </div>
                      </div>
                    </div>
                    <input
                      ref={(el) => { fileInputRefs.current[zone.category] = el; }}
                      type="file" multiple
                      accept=".pdf,.doc,.docx,.odt,.txt,.xlsx,.xlsm,.xls,.ods,.csv,.jpg,.jpeg,.png,.gif,.bmp,.webp,.html,.htm,.msg"
                      onChange={(e) => handleFileSelect(e, zone.category)}
                      className="hidden"
                    />
                    <input
                      ref={(el) => { folderInputRefs.current[zone.category] = el; }}
                      type="file" multiple
                      {...({ webkitdirectory: '' } as Record<string, string>)}
                      onChange={(e) => {
                        const incoming = incomingFromFileList(e.target.files);
                        if (incoming.length) uploadTree(incoming, zone.category);
                        if (folderInputRefs.current[zone.category]) folderInputRefs.current[zone.category]!.value = '';
                      }}
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
                                      {/* fichier versé en arborescence : montrer la sous-pochette */}
                                      {doc.cheminRelatif.split('/').length > 2
                                        ? doc.cheminRelatif.split('/').slice(1).join(' / ')
                                        : doc.nomOriginal}
                                    </p>
                                    <div className="flex items-center gap-1 text-xs text-gray-500">
                                      <span>{formatFileSize(doc.taille)}</span>
                                      <ExternalLink className="h-2 w-2" />
                                      {doc.copieCommun === 'ok' && (
                                        <span className="text-green-600 font-medium" title="Copié dans le dossier commun">✓ commun</span>
                                      )}
                                      {doc.copieCommun === 'attente' && (
                                        <span className="text-amber-600 font-medium" title="Copie vers le dossier commun en attente (dossier injoignable)">⏳ commun</span>
                                      )}
                                      {doc.copieCommun === 'absent' && (
                                        <span className="text-red-600 font-medium" title="Introuvable sur le dossier commun (non copié lors de la dernière synchronisation)">✗ commun</span>
                                      )}
                                    </div>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent
                                  side="right"
                                  className="bg-white text-gray-800 border border-gray-200 shadow-lg p-0 max-w-xs"
                                >
                                  <div className="p-2.5 space-y-1">
                                    {doc.type === 'pdf' && (
                                      <DocHoverPreview enquete={String(enquete.numero)} rel={doc.cheminRelatif} />
                                    )}
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
                  <p className="text-sm font-medium text-green-800">Dossier commun configuré</p>
                  <p className="text-xs text-green-700 break-all">
                    {enquete.cheminExterne.replace(/^fsa:\/\//, '')}
                    {enquete.useSubfolderForExternal !== false && ` / ${enquete.numero}`}
                  </p>
                  <p className="text-xs text-green-600 mt-1">
                    Mode : {enquete.useSubfolderForExternal !== false ? 'Sous-dossier enquête' : 'Dossier direct'}
                  </p>
                  {/* Signaler la synchro automatique, ou inviter à reconnecter
                      un ancien chemin bureau (P:\) non exploitable par le navigateur. */}
                  {enquete.cheminExterne.startsWith('fsa://') && (
                    <p className="text-xs text-green-600 mt-1">
                      ↻ Synchronisation automatique active (toutes les 5 min, tant que cet onglet est ouvert)
                    </p>
                  )}
                  {!enquete.cheminExterne.startsWith('fsa://') && (
                    <p className="text-xs text-amber-700 mt-1">
                      ⚠️ Ce dossier vient de la version bureau et n'est pas reconnu par le navigateur.
                      Cliquez sur « Modifier chemin » puis « Choisir le dossier » pour activer la synchronisation.
                    </p>
                  )}
                  {pendingCommun > 0 && (
                    <p className="text-xs text-amber-700 mt-1 flex items-center gap-2">
                      ⏳ {pendingCommun} copie{pendingCommun > 1 ? 's' : ''} en attente vers le commun
                      <button className="underline font-medium hover:text-amber-900" onClick={retryPendingCommun}>
                        Réessayer
                      </button>
                    </p>
                  )}
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

            {!window.siralBridge && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <XCircle className="h-4 w-4 text-red-600" />
                <p className="text-sm text-red-800">
                  Fonctionnalité documents non disponible (pont de données requis)
                </p>
              </div>
            )}
          </div>

          {/* Aide */}
          <div className="text-xs text-gray-500 space-y-1">
            <p><strong>Formats supportés :</strong> PDF, DOC, DOCX, ODT, TXT, Images, HTML, MSG</p>
            <p><strong>Organisation :</strong> Classement automatique dans des dossiers par catégorie</p>
            <p><strong>Dossiers entiers :</strong> Déposez une ou plusieurs arborescences complètes (sous-pochettes préservées, texte converti pour l&apos;IA au passage). Limite : 50 Mo par pièce — au-delà, le texte intégral est versé à la place. Un versement interrompu se reprend en re-déposant le même dossier, sans doublon.</p>
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
        precomputedDocs={autoAnalyseDocs ?? undefined}
        isOpen={showAnalyseModal}
        onClose={() => { setShowAnalyseModal(false); setAutoAnalyseDocs(null); }}
        enquete={enquete}
        onApplyActes={(updates) => onUpdate(enquete.id, updates)}
        onAddCR={(contenu) => {
          // CR de réception suggéré par l'IA : classé par la MÊME voie que la
          // saisie manuelle (ajoutCR — co-saisine et attribution comprises),
          // signé du nom de l'utilisateur connecté.
          const auteur = useUserStore.getState().user?.displayName || 'Parquet';
          const html = contenu
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>');
          useEnquetesStore.getState().ajoutCR(enquete.id, {
            date: new Date().toISOString().slice(0, 10),
            enqueteur: auteur,
            description: html,
            createdBy: auteur,
          });
        }}
      />

    </>
  );
});

DocumentsSection.displayName = 'DocumentsSection';
