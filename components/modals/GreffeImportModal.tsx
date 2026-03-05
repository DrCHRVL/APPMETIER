// components/modals/GreffeImportModal.tsx - Version corrigée pour nouvelle structure
import React, { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { AIRImportData } from '@/types/interfaces';
import { FileUp, Check, AlertCircle, Info, Users, Target, FileText, Plus, Edit3, CheckCircle, XCircle, AlertTriangle, Search } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import * as XLSX from 'xlsx';
import { useToast } from '@/contexts/ToastContext';
import { 
  parseGreffeDataImproved,
  compareAirWithGreffe, 
  createMesuresFromGreffe,
  GreffeData,
  ComparisonResult,
  ComparisonMatch,
  GreffeValidationResult,
  GreffeMappingResult,
  FIXED_GREFFE_COLUMN_MAPPINGS,
  getBestGreffeMapping,
  createDynamicGreffeMapping,
  parseGreffeDataRowWithMapping,
  calculateSimilarity
} from '@/utils/greffeImportUtils';

interface GreffeImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  mesuresAIR: AIRImportData[];
  onUpdateMesures: (updates: { mesure: AIRImportData, numeroParquet: string }[]) => void;
  onAddMesures: (newMesures: (Omit<AIRImportData, 'refAEM'> & { refAEM: string })[]) => void;
}

export const GreffeImportModal = ({
  isOpen,
  onClose,
  mesuresAIR,
  onUpdateMesures,
  onAddMesures
}: GreffeImportModalProps) => {
  const [file, setFile] = useState<File | null>(null);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [greffeData, setGreffeData] = useState<GreffeData[]>([]);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [sheets, setSheets] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [showDetails, setShowDetails] = useState(false);
  const [debugInfo, setDebugInfo] = useState<string>('');
  const [showDebug, setShowDebug] = useState(false);
  
  // États pour le système de mapping amélioré
  const [validation, setValidation] = useState<GreffeValidationResult | null>(null);
  const [mappingResult, setMappingResult] = useState<GreffeMappingResult | null>(null);
  const [forceDynamicMapping, setForceDynamicMapping] = useState(false);
  const [showMappingEditor, setShowMappingEditor] = useState(false);
  const [customMapping, setCustomMapping] = useState<Record<string, number>>({});
  const [availableHeaders, setAvailableHeaders] = useState<string[]>([]);
  const [previewRowCount, setPreviewRowCount] = useState(5);
  
  // États pour la validation interactive des correspondances probables
  const [pendingMatches, setPendingMatches] = useState<ComparisonMatch[]>([]);
  const [validatedMatches, setValidatedMatches] = useState<ComparisonMatch[]>([]);
  const [rejectedMatches, setRejectedMatches] = useState<ComparisonMatch[]>([]);

  // 🆕 États pour la gestion des nouvelles mesures - STRUCTURE CORRIGÉE
  const [movedToAirOnly, setMovedToAirOnly] = useState<number[]>([]);
  const [validNewMesures, setValidNewMesures] = useState<GreffeData[]>([]);
  
  // 🆕 États pour la recherche de doublons
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGreffeForSearch, setSelectedGreffeForSearch] = useState<GreffeData | null>(null);
  const [searchResults, setSearchResults] = useState<AIRImportData[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

// 🆕 Fonction de recherche dans les mesures AIR existantes
const searchInExistingMesures = (term: string): AIRImportData[] => {
 if (!term || term.length < 2) return [];
 
 return mesuresAIR.filter(mesure => {
   // Utiliser la fonction de similarité corrigée
   const similarity = calculateSimilarity(term, mesure.nomPrenom);
   
   // DEBUG temporaire
   if (term.includes("SCOTE") || mesure.nomPrenom.includes("SCOTE") ||
       term.includes("PELTO") || mesure.nomPrenom.includes("PELTO") ||
       term.includes("VANDAELE") || mesure.nomPrenom.includes("VANDAELE") ||
       term.includes("CHATELAIN") || mesure.nomPrenom.includes("CHATELAIN")) {
     console.log(`Search Debug: "${term}" vs "${mesure.nomPrenom}" = ${similarity}`);
   }
   
   return similarity > 0.6 || 
          mesure.refAEM.toLowerCase().includes(term.toLowerCase()) ||
          mesure.numeroParquet?.toLowerCase().includes(term.toLowerCase());
 }).slice(0, 10);
};

  // 🆕 Gestionnaire d'ouverture du modal de recherche
  const handleOpenSearch = (greffeData: GreffeData) => {
    setSelectedGreffeForSearch(greffeData);
    // Pré-remplir avec le nom de famille
    const nom = greffeData.nomPrenom.split(' ')[0];
    setSearchTerm(nom);
    setSearchResults(searchInExistingMesures(nom));
    setSearchModalOpen(true);
  };

  // 🆕 Gestionnaire de recherche en temps réel
  const handleSearchChange = (term: string) => {
    setSearchTerm(term);
    setSearchResults(searchInExistingMesures(term));
  };

  // 🆕 Fonction pour créer une correspondance manuelle
  const handleCreateManualMatch = (airMesure: AIRImportData) => {
    if (!selectedGreffeForSearch) return;

    const newMatch: ComparisonMatch = {
      greffe: selectedGreffeForSearch,
      air: airMesure,
      similarity: 1.0, // Correspondance manuelle = 100%
      confidence: 'exact',
      matchType: 'nom'
    };

    // Ajouter à la liste des correspondances validées
    setValidatedMatches(prev => [...prev, newMatch]);
    
    // 🔧 CORRECTION : Utiliser newFromGreffe au lieu de onlyInGreffe
    const greffeIndex = comparison?.newFromGreffe.findIndex(g => g.numeroParquet === selectedGreffeForSearch.numeroParquet);
    if (greffeIndex !== undefined && greffeIndex >= 0) {
      setMovedToAirOnly(prev => [...prev, greffeIndex]);
    }

    setSearchModalOpen(false);
    setSelectedGreffeForSearch(null);
    setSearchTerm('');
    setSearchResults([]);

    showToast('Correspondance manuelle créée', 'success');
  };

  // 🆕 Fonction pour déplacer une mesure vers "sans correspondance"
const handleMoveToAirOnly = (greffeIndex: number) => {
  if (movedToAirOnly.includes(greffeIndex)) return;
  
  setMovedToAirOnly(prev => [...prev, greffeIndex]);
  showToast('Mesure déplacée vers "sans correspondance"', 'info');
};

// 🆕 Fonction pour restaurer une mesure dans les nouvelles
const handleRestoreToNew = (greffeIndex: number) => {
  setMovedToAirOnly(prev => prev.filter(index => index !== greffeIndex));
  showToast('Mesure restaurée dans les nouvelles', 'success');
};

// 🔧 CORRECTION : Effet pour maintenir à jour la liste des nouvelles mesures valides
useEffect(() => {
  if (comparison) {
    const newValidMesures = comparison.newFromGreffe.filter((_, index) => 
      !movedToAirOnly.includes(index)
    );
    setValidNewMesures(newValidMesures);
  }
}, [comparison, movedToAirOnly]);

  // Réinitialiser l'état lors de l'ouverture
  useEffect(() => {
    if (isOpen) {
      resetState();
    }
  }, [isOpen]);

  const resetState = () => {
    setFile(null);
    setWorkbook(null);
    setGreffeData([]);
    setComparison(null);
    setErrors([]);
    setSheets([]);
    setSelectedSheet('');
    setShowDetails(false);
    setDebugInfo('');
    setValidation(null);
    setMappingResult(null);
    setForceDynamicMapping(false);
    setShowMappingEditor(false);
    setCustomMapping({});
    setAvailableHeaders([]);
    setPreviewRowCount(5);
    setPendingMatches([]);
    setValidatedMatches([]);
    setRejectedMatches([]);
    setMovedToAirOnly([]);
    setValidNewMesures([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const addDebugInfo = (info: string) => {
    setDebugInfo(prev => prev + info + '\n');
    console.log(info);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setErrors([]);
      await loadWorkbook(selectedFile);
    }
  };

  const loadWorkbook = async (file: File) => {
    try {
      setIsProcessing(true);
      addDebugInfo('🔄 Chargement du fichier Excel greffe...');
      
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { 
        type: 'array',
        cellDates: true,
        cellNF: true,
        cellStyles: true,
        raw: false
      });
      
      if (!wb || !wb.SheetNames || wb.SheetNames.length === 0) {
        throw new Error('Aucune feuille trouvée dans le classeur');
      }
      
      addDebugInfo(`📋 Feuilles détectées: ${wb.SheetNames.join(', ')}`);
      setWorkbook(wb);
      setSheets(wb.SheetNames);
      
      // Sélectionner automatiquement la première feuille ou celle contenant des données
      const targetSheet = wb.SheetNames[0];
      setSelectedSheet(targetSheet);
      addDebugInfo(`🎯 Feuille sélectionnée: ${targetSheet}`);
      
    } catch (error) {
      console.error('Erreur lors du chargement:', error);
      addDebugInfo(`❌ ERREUR: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
      setErrors([error instanceof Error ? error.message : 'Erreur lors du chargement du fichier']);
      showToast('Erreur lors du chargement du fichier', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // Analyser la feuille sélectionnée
  useEffect(() => {
    if (workbook && selectedSheet) {
      parseSelectedSheet(workbook, selectedSheet);
    }
  }, [selectedSheet]);

  const parseSelectedSheet = async (wb: XLSX.WorkBook, sheetName: string) => {
    try {
      setIsProcessing(true);
      setErrors([]);
      addDebugInfo(`🔍 Analyse de la feuille greffe: ${sheetName}`);
      
      const worksheet = wb.Sheets[sheetName];
      if (!worksheet) {
        throw new Error(`Impossible de lire la feuille "${sheetName}"`);
      }
      
      // Convertir en JSON
      const jsonData = XLSX.utils.sheet_to_json<any>(worksheet, { 
        header: 1,
        defval: '',
        blankrows: false,
        raw: false
      });
      
      if (!jsonData || jsonData.length <= 1) {
        throw new Error('Aucune donnée trouvée dans la feuille');
      }
      
      addDebugInfo(`📊 Nombre de lignes: ${jsonData.length}`);
      
      // Utilisation de la fonction améliorée
      const result = parseGreffeDataImproved(jsonData);
      const { data, errors: parseErrors, validation: validationResult, mappingResult: mappingRes } = result;
      
      // Stocker les résultats
      setValidation(validationResult);
      setMappingResult(mappingRes);
      
      // Pré-remplir le mapping personnalisé
      if (Object.keys(customMapping).length === 0) {
        setCustomMapping(mappingRes.mapping);
      }
      
      addDebugInfo(`✅ Validation: ${validationResult.message} (confiance: ${validationResult.confidence})`);
      addDebugInfo(`🎯 Mapping: ${mappingRes.method} (confiance: ${mappingRes.confidence})`);
      
      if (parseErrors.length > 0) {
        setErrors(parseErrors);
        addDebugInfo(`❌ Erreurs détectées: ${parseErrors.length}`);
      }
      
      if (data.length === 0) {
        throw new Error('Aucune donnée valide trouvée après analyse');
      }
      
      addDebugInfo(`🎉 Données analysées: ${data.length} mesures greffe valides`);
      setGreffeData(data);
      
      // Effectuer la comparaison avec les données AIR
      addDebugInfo(`🔄 Comparaison avec ${mesuresAIR.length} mesures AIR...`);
      const comparisonResult = compareAirWithGreffe(mesuresAIR, data);
      setComparison(comparisonResult);
      
      // Séparer les correspondances probables pour validation manuelle
      setPendingMatches(comparisonResult.probables);
      setValidatedMatches([]);
      setRejectedMatches([]);
      
      // 🔧 CORRECTION : Utiliser les nouvelles propriétés
      addDebugInfo(`📊 Résultats: ${comparisonResult.stats.enriched} enrichies, ${comparisonResult.stats.probables} probables, ${comparisonResult.stats.newFromGreffe} nouvelles`);
      
      showToast(`${data.length} mesures greffe analysées`, 'success');
      
    } catch (error) {
      console.error('Erreur lors de l\'analyse:', error);
      const errorMsg = error instanceof Error ? error.message : 'Erreur lors de l\'analyse du fichier';
      addDebugInfo(`❌ ERREUR: ${errorMsg}`);
      setErrors([errorMsg]);
      showToast('Erreur lors de l\'analyse du fichier', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // Validation manuelle des correspondances probables
  const handleValidateMatch = (matchIndex: number, action: 'accept' | 'reject') => {
    const match = pendingMatches[matchIndex];
    if (!match) return;

    if (action === 'accept') {
      setValidatedMatches(prev => [...prev, match]);
    } else {
      setRejectedMatches(prev => [...prev, match]);
    }

    setPendingMatches(prev => prev.filter((_, index) => index !== matchIndex));
  };

  const handleApplyUpdates = () => {
    if (!comparison) return;
    
    try {
      setIsProcessing(true);
      
      // 🔧 CORRECTION : Utiliser enrichedAir au lieu de matches
      const allValidMatches = [...comparison.enrichedAir.map(enriched => ({
        air: enriched,
        greffe: { numeroParquet: enriched.numeroParquet } as GreffeData
      })), ...validatedMatches];
      
      // 1. Mettre à jour les numéros de parquet
      const updates = allValidMatches.map(match => ({
        mesure: match.air,
        numeroParquet: match.greffe.numeroParquet
      }));
      
      if (updates.length > 0) {
        onUpdateMesures(updates);
      }
      
      // 2. 🆕 Créer de nouvelles mesures SEULEMENT pour les mesures validées (non exclues)
      if (validNewMesures.length > 0) {
        const newMesuresBase = createMesuresFromGreffe(validNewMesures);
        const newMesures = newMesuresBase.map((mesure, index) => ({
          ...mesure,
          refAEM: `GREFFE-${Date.now()}-${index}`
        }));
        
        onAddMesures(newMesures);
      }
      
      showToast(
        `Import terminé: ${updates.length} mises à jour, ${validNewMesures.length} nouvelles mesures`,
        'success'
      );
      
      onClose();
      
    } catch (error) {
      console.error('Erreur lors de l\'application des mises à jour:', error);
      showToast('Erreur lors de l\'application des mises à jour', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-7xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import et enrichissement des données greffe</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Zone de dépôt de fichier */}
          <div 
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
              file ? 'border-green-500 bg-green-50' : 'border-gray-300 hover:border-gray-400'
            }`}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              disabled={isProcessing}
            />
            
            {file ? (
              <div className="flex flex-col items-center">
                <Check className="h-10 w-10 text-green-500 mb-2" />
                <p className="text-sm font-medium">{file.name}</p>
                <p className="text-xs text-gray-500">
                  {(file.size / 1024).toFixed(2)} KB
                </p>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="mt-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    resetState();
                  }}
                  disabled={isProcessing}
                >
                  Choisir un autre fichier
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <FileUp className="h-10 w-10 text-gray-400 mb-2" />
                <p className="text-sm font-medium">Cliquez pour sélectionner le fichier Excel du greffe</p>
                <p className="text-xs text-gray-500">
                  Colonnes attendues: A = Numéro parquet, B = Nom/Prénom, G = Date convocation
                </p>
              </div>
            )}
          </div>

          {/* Résultats de la comparaison - STRUCTURE CORRIGÉE */}
          {comparison && (
            <div className="space-y-4">
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>Résultats de l'enrichissement</AlertTitle>
                <AlertDescription>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-sm">
                    <div className="flex flex-col items-center p-3 bg-green-50 rounded">
                      <CheckCircle className="h-6 w-6 text-green-600 mb-1" />
                      <span className="font-bold text-lg">{comparison.stats.enriched}</span>
                      <span className="text-xs text-center">Enrichies automatiquement</span>
                    </div>
                    <div className="flex flex-col items-center p-3 bg-yellow-50 rounded">
                      <AlertTriangle className="h-6 w-6 text-yellow-600 mb-1" />
                      <span className="font-bold text-lg">{pendingMatches.length}</span>
                      <span className="text-xs text-center">À valider</span>
                    </div>
                    <div className="flex flex-col items-center p-3 bg-blue-50 rounded">
                      <Plus className="h-6 w-6 text-blue-600 mb-1" />
                      <span className="font-bold text-lg">{comparison.stats.newFromGreffe}</span>
                      <span className="text-xs text-center">Nouvelles (greffe)</span>
                    </div>
                    <div className="flex flex-col items-center p-3 bg-orange-50 rounded">
                      <FileText className="h-6 w-6 text-orange-600 mb-1" />
                      <span className="font-bold text-lg">{comparison.stats.airWithoutParquet}</span>
                      <span className="text-xs text-center">Non trouvées dans greffe</span>
                    </div>
                  </div>
                </AlertDescription>
              </Alert>

              {/* Section de validation des correspondances probables */}
              {pendingMatches.length > 0 && (
                <Alert className="border-yellow-200 bg-yellow-50">
                  <AlertTriangle className="h-4 w-4 text-yellow-600" />
                  <AlertTitle>Correspondances à valider ({pendingMatches.length})</AlertTitle>
                  <AlertDescription>
                    <div className="mt-3 space-y-2 max-h-60 overflow-y-auto">
                      {pendingMatches.map((match, index) => (
                        <div key={index} className="flex items-center justify-between bg-white p-3 rounded border">
                          <div className="flex-1">
                            <div className="text-sm">
                              <strong>AIR:</strong> {match.air.nomPrenom} ({match.air.refAEM})
                              {match.air.dateReception && (
                                <span className="text-gray-500 ml-2">Réception: {match.air.dateReception}</span>
                              )}
                            </div>
                            <div className="text-sm">
                              <strong>Greffe:</strong> {match.greffe.nomPrenom} ({match.greffe.numeroParquet})
                              {match.greffe.dateConvocation && (
                                <span className="text-gray-500 ml-2">Convocation: {match.greffe.dateConvocation}</span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500">
                              Similarité: {Math.round(match.similarity * 100)}% • Type: {match.matchType}
                            </div>
                          </div>
                          <div className="flex gap-2 ml-4">
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-green-600 border-green-300 hover:bg-green-50"
                              onClick={() => handleValidateMatch(index, 'accept')}
                            >
                              ✓ Valider
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-600 border-red-300 hover:bg-red-50"
                              onClick={() => handleValidateMatch(index, 'reject')}
                            >
                              ✗ Rejeter
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              {/* Bouton pour voir les détails */}
              <Button
                variant="outline"
                onClick={() => setShowDetails(!showDetails)}
                className="w-full"
              >
                {showDetails ? 'Masquer' : 'Afficher'} les détails
              </Button>

              {/* Détails des correspondances - STRUCTURE CORRIGÉE */}
              {showDetails && (
                <div className="space-y-4 max-h-80 overflow-y-auto border rounded p-4">
                  {/* Mesures enrichies automatiquement */}
                  {comparison.enrichedAir.length > 0 && (
                    <div>
                      <h4 className="font-medium text-green-700 mb-2">
                        ✅ Mesures AIR enrichies ({comparison.enrichedAir.length})
                      </h4>
                      <div className="space-y-2 text-xs">
                        {comparison.enrichedAir.map((enriched, index) => (
                          <div key={index} className="flex justify-between items-center bg-green-50 p-2 rounded">
                            <div className="flex-1">
                              <span className="font-medium">{enriched.nomPrenom}</span>
                              <span className="text-gray-500 ml-2">({enriched.refAEM})</span>
                            </div>
                            <div className="text-right">
                              <div className="font-mono text-blue-600">{enriched.numeroParquet}</div>
                              <div className="text-gray-500">Enrichi automatiquement</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Nouvelles mesures du greffe - STRUCTURE CORRIGÉE */}
                  {comparison.newFromGreffe.length > 0 && (
                    <div>
                      <h4 className="font-medium text-blue-700 mb-2">
                        ➕ Nouvelles mesures à créer ({validNewMesures.length} sur {comparison.newFromGreffe.length})
                      </h4>
                      <div className="space-y-2 text-xs max-h-80 overflow-y-auto">
                        {comparison.newFromGreffe.map((greffe, index) => {
                          const isMovedToAirOnly = movedToAirOnly.includes(index);
                          return (
                            <div key={index} className={`flex justify-between items-center p-3 rounded border ${
                              isMovedToAirOnly ? 'bg-orange-50 border-orange-200 opacity-60' : 'bg-blue-50 border-blue-200'
                            }`}>
                              <div className="flex-1">
                                <div className="flex items-start gap-3">
                                  <div className="flex-1">
                                    <div className="font-medium">{greffe.nomPrenom}</div>
                                    <div className="font-mono text-blue-600 text-xs">{greffe.numeroParquet}</div>
                                    {greffe.dateConvocation && (
                                      <div className="text-gray-500 text-xs">Convocation: {greffe.dateConvocation}</div>
                                    )}
                                    {greffe.faits && (
                                      <div className="text-gray-700 text-xs mt-1 italic">
                                        <strong>Faits:</strong> {greffe.faits.length > 100 ? `${greffe.faits.substring(0, 100)}...` : greffe.faits}
                                      </div>
                                    )}
                                    {greffe.origine && (
                                      <div className="text-gray-500 text-xs">Origine: {greffe.origine}</div>
                                    )}
                                  </div>
                                  
                                  <div className="flex items-center gap-2">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 w-6 p-0 text-blue-600 hover:bg-blue-100"
                                      onClick={() => handleOpenSearch(greffe)}
                                      title="Rechercher dans les mesures existantes"
                                    >
                                      <Search className="h-4 w-4" />
                                    </Button>
                                    
                                    {!isMovedToAirOnly ? (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-6 w-6 p-0 text-orange-600 hover:bg-orange-100"
                                        onClick={() => handleMoveToAirOnly(index)}
                                        title="Déplacer vers 'sans correspondance'"
                                      >
                                        <XCircle className="h-4 w-4" />
                                      </Button>
                                    ) : (
                                      <div className="flex items-center gap-1">
                                        <span className="text-orange-600 text-xs">Sans corresp.</span>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-6 w-6 p-0 text-green-600 hover:bg-green-100"
                                          onClick={() => handleRestoreToNew(index)}
                                          title="Remettre dans nouvelles mesures"
                                        >
                                          <CheckCircle className="h-4 w-4" />
                                        </Button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      
                      {/* Boutons de contrôle global */}
                      <div className="flex justify-between items-center mt-3 pt-2 border-t">
                        <div className="text-xs text-gray-600">
                          {validNewMesures.length} mesures seront importées • {movedToAirOnly.length} sans correspondance
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setMovedToAirOnly([])}
                            className="text-green-600 border-green-300 hover:bg-green-50"
                          >
                            Tout importer
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setMovedToAirOnly(comparison.newFromGreffe.map((_, i) => i))}
                            className="text-orange-600 border-orange-300 hover:bg-orange-50"
                          >
                            Aucune nouvelle
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Mesures AIR sans correspondance - TITRE CORRIGÉ */}
                  {comparison.airWithoutParquet.length > 0 && (
                    <div>
                      <h4 className="font-medium text-orange-700 mb-2">
                        ⚠️ Mesures AIR non trouvées dans le greffe ({comparison.airWithoutParquet.length})
                      </h4>
                      <div className="space-y-1 text-xs">
                        {comparison.airWithoutParquet.map((air, index) => (
                          <div key={index} className="bg-orange-50 p-2 rounded">
                            <span className="font-medium">{air.nomPrenom}</span>
                            <span className="text-gray-500 ml-2">({air.refAEM})</span>
                            {air.dateReception && (
                              <span className="text-gray-500 ml-2">Réception: {air.dateReception}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Actions prévues - STRUCTURE CORRIGÉE */}
              <Alert>
                <Check className="h-4 w-4" />
                <AlertTitle>Actions qui seront effectuées</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc list-inside space-y-1 mt-2 text-sm">
                    {(comparison.stats.enriched + validatedMatches.length) > 0 && (
                      <li><strong>{comparison.stats.enriched + validatedMatches.length}</strong> mesures AIR recevront leur numéro de parquet</li>
                    )}
                    {validNewMesures.length > 0 && (
                      <li><strong>{validNewMesures.length}</strong> nouvelles mesures seront créées depuis le greffe</li>
                    )}
                    {comparison.stats.airWithoutParquet > 0 && (
                      <li><strong>{comparison.stats.airWithoutParquet}</strong> mesures AIR non trouvées dans le greffe</li>
                    )}
                    {pendingMatches.length > 0 && (
                      <li className="text-yellow-600"><strong>{pendingMatches.length}</strong> correspondances en attente de validation</li>
                    )}
                    {movedToAirOnly.length > 0 && (
                      <li className="text-orange-600"><strong>{movedToAirOnly.length}</strong> mesures greffe exclues de l'import</li>
                    )}
                  </ul>
                </AlertDescription>
              </Alert>
            </div>
          )}

          {/* Messages d'erreur */}
          {errors.length > 0 && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Erreurs détectées</AlertTitle>
              <AlertDescription>
                <ul className="list-disc list-inside space-y-1">
                  {errors.slice(0, 5).map((error, index) => (
                    <li key={index} className="text-sm">{error}</li>
                  ))}
                  {errors.length > 5 && (
                    <li className="text-sm font-medium">... et {errors.length - 5} autres erreurs</li>
                  )}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Aperçu des données greffe */}
          {greffeData.length > 0 && (
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-medium">
                  Aperçu des données greffe ({greffeData.length} mesures)
                </h3>
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Lignes:</Label>
                  <select
                    value={previewRowCount}
                    onChange={(e) => setPreviewRowCount(parseInt(e.target.value))}
                    className="text-xs p-1 border rounded w-16"
                  >
                    <option value={5}>5</option>
                    <option value={10}>10</option>
                    <option value={15}>15</option>
                    <option value={20}>20</option>
                  </select>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse border">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border p-2 text-left">Numéro Parquet</th>
                      <th className="border p-2 text-left">Nom/Prénom</th>
                      <th className="border p-2 text-left">Date Convocation</th>
                      <th className="border p-2 text-left">Faits</th>
                      <th className="border p-2 text-left">Origine</th>
                    </tr>
                  </thead>
                  <tbody>
                    {greffeData.slice(0, previewRowCount).map((item, index) => (
                      <tr key={index}>
                        <td className="border p-2 font-mono">{item.numeroParquet}</td>
                        <td className="border p-2">{item.nomPrenom}</td>
                        <td className="border p-2">{item.dateConvocation || '-'}</td>
                        <td className="border p-2 max-w-40" title={item.faits}>
                          {item.faits ? 
                            (item.faits.length > 50 ? `${item.faits.substring(0, 50)}...` : item.faits) : 
                            '-'
                          }
                        </td>
                        <td className="border p-2">{item.origine || '-'}</td>
                      </tr>
                    ))}
                    {greffeData.length > previewRowCount && (
                      <tr>
                        <td colSpan={5} className="border p-2 text-center text-gray-500 italic">
                          ... et {greffeData.length - previewRowCount} autres mesures
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Bouton de débogage */}
          <div className="flex justify-end">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setShowDebug(!showDebug)}
            >
              {showDebug ? "Masquer" : "Afficher"} les détails techniques
            </Button>
          </div>
          
          {/* Informations de débogage */}
          {showDebug && debugInfo && (
            <div className="p-3 bg-gray-100 rounded text-xs font-mono max-h-60 overflow-y-auto">
              <pre className="whitespace-pre-wrap">{debugInfo}</pre>
            </div>
          )}

          {/* Indicateur de progression */}
          {isProcessing && (
            <div className="flex items-center justify-center p-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <span className="ml-2 text-sm">Traitement en cours...</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button 
            variant="outline" 
            onClick={onClose}
            disabled={isProcessing}
          >
            Annuler
          </Button>
          <Button 
            onClick={handleApplyUpdates}
            disabled={!comparison || isProcessing || pendingMatches.length > 0}
            className="bg-blue-600 hover:bg-blue-700"
          >
            Appliquer l'enrichissement
            {comparison && ` (${comparison.stats.enriched + validatedMatches.length} mises à jour + ${validNewMesures.length} nouvelles)`}
          </Button>
        </DialogFooter>
      </DialogContent>
      
      {/* Modal de recherche de doublons */}
      <Dialog open={searchModalOpen} onOpenChange={setSearchModalOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Recherche de doublons potentiels</DialogTitle>
            {selectedGreffeForSearch && (
              <div className="text-sm text-gray-600 bg-blue-50 p-3 rounded">
                <strong>Mesure greffe :</strong> {selectedGreffeForSearch.nomPrenom} ({selectedGreffeForSearch.numeroParquet})
                {selectedGreffeForSearch.faits && (
                  <div className="mt-1"><strong>Faits :</strong> {selectedGreffeForSearch.faits}</div>
                )}
              </div>
            )}
          </DialogHeader>

          <div className="space-y-4">
            {/* Barre de recherche */}
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Rechercher par nom, référence AEM, numéro parquet..."
                value={searchTerm}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                autoFocus
              />
            </div>

            {/* Résultats de recherche */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium">
                Mesures AIR existantes ({searchResults.length} résultats)
              </h3>
              
              {searchTerm.length < 2 ? (
                <div className="text-gray-500 text-sm italic py-4 text-center">
                  Tapez au moins 2 caractères pour rechercher
                </div>
              ) : searchResults.length === 0 ? (
                <div className="text-gray-500 text-sm italic py-4 text-center">
                  Aucune mesure trouvée pour "{searchTerm}"
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto space-y-2">
                  {searchResults.map((mesure, index) => (
                    <div key={index} className="border rounded p-3 hover:bg-gray-50">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="font-medium">{mesure.nomPrenom}</div>
                          <div className="text-sm text-gray-600">
                            <span className="font-mono">{mesure.refAEM}</span>
                            {mesure.numeroParquet && (
                              <span className="ml-2 font-mono">• {mesure.numeroParquet}</span>
                            )}
                          </div>
                          {mesure.dateReception && (
                            <div className="text-xs text-gray-500">
                              Réception: {mesure.dateReception}
                            </div>
                          )}
                          {mesure.faits && (
                            <div className="text-xs text-gray-700 mt-1">
                              <strong>Faits:</strong> {mesure.faits.length > 80 ? `${mesure.faits.substring(0, 80)}...` : mesure.faits}
                            </div>
                          )}
                          {mesure.referent && (
                            <div className="text-xs text-gray-500">
                              Référent: {mesure.referent}
                            </div>
                          )}
                        </div>
                        
                        <div className="ml-4 flex flex-col gap-2">
                          <Button
                            size="sm"
                            onClick={() => handleCreateManualMatch(mesure)}
                            className="bg-green-600 hover:bg-green-700 text-white"
                          >
                            🔗 Lier
                          </Button>
                          <div className="text-xs text-center text-gray-500">
                            {mesure.sourceGreffe ? 'Du greffe' : 'AEM'}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Aide */}
            <div className="bg-gray-50 p-3 rounded text-sm">
              <strong>💡 Conseils :</strong>
              <ul className="mt-1 text-xs space-y-1">
                <li>• Recherchez par nom de famille pour élargir les résultats</li>
                <li>• Vérifiez les faits et dates pour confirmer s'il s'agit de la même personne</li>
                <li>• Cliquez "Lier" si vous êtes sûr qu'il s'agit de la même mesure</li>
                <li>• La liaison créera une correspondance et supprimera la "nouvelle mesure"</li>
              </ul>
            </div>
          </div>

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setSearchModalOpen(false);
                setSelectedGreffeForSearch(null);
                setSearchTerm('');
                setSearchResults([]);
              }}
            >
              Fermer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
};