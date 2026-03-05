import React, { useState, useRef, useEffect } from 'react';
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
  Info
} from 'lucide-react';
import { Enquete, DocumentEnquete, EcouteData } from '@/types/interfaces';
import { useToast } from '@/contexts/ToastContext';
import { DocumentPathModal } from '../modals/DocumentPathModal';
import { DocumentSyncManager, SyncResult } from '@/utils/documents/DocumentSyncManager';
import { JLDOrderAnalyzer, JLDAnalysisResult } from '@/utils/documents/JLDOrderAnalyzer';
import { JLDConfirmationModal } from '../modals/JLDConfirmationModal';
import { JLDEcoutesCreationModal } from '../modals/JLDEcoutesCreationModal';
import { SimpleJLDConfirmationModal } from '../modals/SimpleJLDConfirmationModal';
import { Alert, AlertDescription } from '../ui/alert';
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

export const DocumentsSection = ({ enquete, onUpdate, isEditing }: DocumentsSectionProps) => {
  const [dragOverZone, setDragOverZone] = useState<DocumentCategory | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showPathModal, setShowPathModal] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'success' | 'error' | null>(null);
  
  // Nouveaux états pour la synchronisation
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [lastScanTime, setLastScanTime] = useState<Date | null>(null);
  
  // États pour l'analyse JLD - NOUVEAUX
  const [showJLDConfirmation, setShowJLDConfirmation] = useState(false);
  const [showJLDCreation, setShowJLDCreation] = useState(false);
  const [currentJLDAnalysis, setCurrentJLDAnalysis] = useState<JLDAnalysisResult | null>(null);
  const [currentJLDFile, setCurrentJLDFile] = useState<File | null>(null);
  const [isAnalyzingJLD, setIsAnalyzingJLD] = useState(false);
  
  const fileInputRefs = useRef<Record<DocumentCategory, HTMLInputElement | null>>({
    geoloc: null,
    ecoutes: null,
    actes: null,
    pv: null
  });
  
  const { showToast } = useToast();

  // Scan automatique des nouveaux documents
  useEffect(() => {
    // Effectuer un scan automatique au chargement du composant
    scanForNewDocuments(true);
    
    // Configurer un scan périodique toutes les 10 minutes (600000 ms)
    const intervalId = setInterval(() => {
      scanForNewDocuments(true);
    }, 600000);
    
    return () => clearInterval(intervalId);
  }, [enquete.id]);
  
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
        // Mettre à jour la liste des documents dans l'enquête
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
        
        // Si des documents ont été ajoutés en interne, rafraîchir la liste
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
  
  // === NOUVELLES FONCTIONS JLD ===
  
  // Analyse JLD d'un fichier PDF - NOUVELLE
  const analyzeJLDFile = async (file: File): Promise<void> => {
    if (file.type !== 'application/pdf') {
      return;
    }

    setIsAnalyzingJLD(true);
    setCurrentJLDFile(file);

   try {
  console.log('🔍 DÉBUT ANALYSE JLD pour:', file.name, file.type);
  const analysisResult = await JLDOrderAnalyzer.analyze(file);
  console.log('📊 RÉSULTAT ANALYSE:', analysisResult);
      setCurrentJLDAnalysis(analysisResult);

      if (analysisResult.isJLDOrder && analysisResult.phoneNumbers.length > 0) {
        setShowJLDConfirmation(true);
      }
    } catch (error) {
      console.error('Erreur lors de l\'analyse JLD:', error);
      showToast('Erreur lors de l\'analyse du document', 'error');
    } finally {
      setIsAnalyzingJLD(false);
    }
  };

  // Confirmation de création des écoutes JLD - NOUVELLE
const handleJLDConfirmation = async () => {
  setShowJLDConfirmation(false);
  
  if (currentJLDFile) {
    console.log('🔍 USER A DIT OUI → ANALYSE JLD...');
    setIsAnalyzingJLD(true);
    
    try {
      const analysisResult = await JLDOrderAnalyzer.analyze(currentJLDFile);
      console.log('📊 RÉSULTAT:', analysisResult);
      setCurrentJLDAnalysis(analysisResult);
      setShowJLDCreation(true);
    } catch (error) {
      console.error('Erreur analyse:', error);
      showToast('Erreur lors de l\'analyse', 'error');
    } finally {
      setIsAnalyzingJLD(false);
    }
  }
};
  // Création des écoutes depuis l'analyse JLD - NOUVELLE
  const handleCreateJLDEcoutes = (ecoutes: Partial<EcouteData>[]) => {
    const newEcoutes: EcouteData[] = ecoutes.map((ecoute, index) => ({
      id: Date.now() + index,
      numero: ecoute.numero || '',
      cible: ecoute.cible,
      description: ecoute.description,
      dateDebut: ecoute.dateDebut || '',
      dateFin: ecoute.dateFin || '',
      duree: ecoute.duree || '30',
      datePose: ecoute.datePose,
      statut: ecoute.statut || 'en_cours'
    }));

    const updatedEcoutes = [...(enquete.ecoutes || []), ...newEcoutes];
    onUpdate(enquete.id, { ecoutes: updatedEcoutes });

    setShowJLDCreation(false);
    setCurrentJLDAnalysis(null);
    setCurrentJLDFile(null);
    
    showToast(`${newEcoutes.length} écoute(s) créée(s) avec succès`, 'success');
  };
  
  // === FIN NOUVELLES FONCTIONS JLD ===
  
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

  // Fonction pour traiter les fichiers uploadés dans une catégorie spécifique
  const handleFiles = async (files: FileList | File[], category: DocumentCategory) => {
    if (!window.electronAPI) {
      showToast('API Electron non disponible', 'error');
      return;
    }

    setIsUploading(true);
    setCopyStatus(null);
    const validFiles: File[] = [];
    const invalidFiles: string[] = [];

    // Valider les fichiers
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

    if (validFiles.length === 0) {
      setIsUploading(false);
      return;
    }

    try {
      // Préparer les données pour l'API Electron
      const filesData = await Promise.all(
        validFiles.map(async (file) => ({
          name: file.name,
          arrayBuffer: await file.arrayBuffer()
        }))
      );

      // Convertir la catégorie pour l'API Electron
      const categoryMapping = {
        'geoloc': 'Geoloc',
        'ecoutes': 'Ecoutes', 
        'actes': 'Actes',
        'pv': 'PV'
      };
      const electronCategory = categoryMapping[category];

      // Envoyer vers l'API Electron avec la catégorie
      const savedFiles = await window.electronAPI.saveDocuments(
        enquete.numero, 
        filesData,
        electronCategory
      );
      
      if (savedFiles && savedFiles.length > 0) {
        // Mettre à jour l'enquête avec les nouveaux documents
        const currentDocuments = enquete.documents || [];
        const updatedDocuments = [...currentDocuments, ...savedFiles];
        
        onUpdate(enquete.id, { documents: updatedDocuments });
        showToast(`${savedFiles.length} document(s) ajoutés dans ${DOCUMENT_ZONES.find(z => z.category === category)?.title}`, 'success');

        // === ANALYSE JLD APRÈS UPLOAD - NOUVEAU ===

 console.log('🔍 CATÉGORIE:', category, 'validFiles:', validFiles.length);

if (category === 'ecoutes') {
  console.log('✅ CATÉGORIE ÉCOUTES DÉTECTÉE');
  const pdfFiles = validFiles.filter(file => file.type === 'application/pdf');
  console.log('📄 FICHIERS PDF TROUVÉS:', pdfFiles.length, pdfFiles.map(f => f.name));
  if (pdfFiles.length > 0) {
    console.log('🚀 OUVERTURE MODAL JLD');
    setCurrentJLDFile(pdfFiles[0]); // Prendre le premier PDF
    setShowJLDConfirmation(true);   // Ouvrir directement la modal
  }
}               // === FIN ANALYSE JLD ===

        // Essayer de copier vers le chemin externe si configuré
        if (enquete.cheminExterne) {
          try {
            const copySuccess = await window.electronAPI.copyToExternalPath(
              enquete.numero,
              enquete.cheminExterne,
              savedFiles,
              electronCategory,
              enquete.useSubfolderForExternal ?? true // Passer la préférence utilisateur
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
    // Reset input
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
        enquete.useSubfolderForExternal ?? true // Passer la préférence utilisateur
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
        enquete.useSubfolderForExternal ?? true // Passer la préférence utilisateur
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
    const oldUseSubfolder = enquete.useSubfolderForExternal ?? true; // Par défaut true pour rétrocompatibilité
    
    // Mettre à jour les deux champs
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

  // Fonction pour filtrer les documents par catégorie
  const getDocumentsByCategory = (category: DocumentCategory): DocumentEnquete[] => {
    const categoryMapping = {
      'geoloc': 'Geoloc',
      'ecoutes': 'Ecoutes', 
      'actes': 'Actes',
      'pv': 'PV'
    };
    const electronCategory = categoryMapping[category];
    
    return (enquete.documents || []).filter(doc => 
      doc.cheminRelatif.startsWith(`${electronCategory}/`)
    );
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
              
              {/* NOUVEAU - Indicateur d'analyse JLD */}
              {isAnalyzingJLD && (
                <Badge variant="outline" className="bg-blue-50 text-blue-700 animate-pulse">
                  <Loader className="h-3 w-3 mr-1 animate-spin" />
                  Analyse JLD...
                </Badge>
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
          
          {/* Grille des 4 zones de documents */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {DOCUMENT_ZONES.map((zone) => {
              const documentsInZone = getDocumentsByCategory(zone.category);
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
                    {/* NOUVEAU - Indicateur spécial pour écoutes avec analyse JLD */}
                    {zone.category === 'ecoutes' && (
                      <div className="absolute top-1 right-1">
                        <Badge variant="outline" className="text-xs bg-blue-50 text-blue-600 border-blue-200">
                          Analyse JLD
                        </Badge>
                      </div>
                    )}

                    <div className="flex flex-col items-center gap-2">
                      <div className={`p-2 rounded-full ${zone.color.replace('hover:', '')}`}>
                        {zone.icon}
                      </div>
                      <div>
                        <h3 className="font-medium text-sm">{zone.title}</h3>
                        <p className="text-xs text-gray-600 mb-2">{zone.description}</p>
                        {/* NOUVEAU - Information JLD pour zone écoutes */}
                        {zone.category === 'ecoutes' && (
                          <p className="text-xs text-blue-600 mb-1">
                            📄 Détection automatique d'ordonnances JLD
                          </p>
                        )}
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

            {/* NOUVEAU - Information sur l'analyse JLD */}
            <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <Info className="h-4 w-4 text-blue-600" />
              <div className="flex-1">
                <p className="text-sm font-medium text-blue-800">
                  Fonctionnalités avancées actives
                </p>
                <ul className="text-xs text-blue-700 mt-1 space-y-1">
                  <li>• Détection automatique de nouveaux documents</li>
                  <li>• Analyse intelligente des ordonnances JLD (zone écoutes)</li>
                  <li>• Création automatique d'écoutes depuis les documents PDF</li>
                  <li>• Synchronisation bidirectionnelle avec dossier externe</li>
                </ul>
              </div>
            </div>

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
            <p><strong>Analyse JLD :</strong> Les PDF d'ordonnances déposés dans "Écoutes" sont analysés pour créer automatiquement les écoutes</p>
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

      {/* NOUVELLES MODALS JLD */}

{/* Modal simple de confirmation JLD */}
{currentJLDFile && (
  <SimpleJLDConfirmationModal
    isOpen={showJLDConfirmation}
    onClose={() => {
      setShowJLDConfirmation(false);
      setCurrentJLDFile(null);
    }}
    onConfirm={handleJLDConfirmation}
    fileName={currentJLDFile.name}
  />
)}

{/* Modal de création des écoutes JLD */}
{currentJLDAnalysis && currentJLDFile && (
  <JLDEcoutesCreationModal
    isOpen={showJLDCreation}
    onClose={() => {
      setShowJLDCreation(false);
      setCurrentJLDAnalysis(null);
      setCurrentJLDFile(null);
    }}
    onCreateEcoutes={handleCreateJLDEcoutes}
    analysisResult={currentJLDAnalysis}
    fileName={currentJLDFile.name}
  />
)}
    </>
  );
};