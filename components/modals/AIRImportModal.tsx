import React, { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { AIRImportData } from '@/types/interfaces';
import { FileUp, Check, AlertCircle, Info, CheckCircle, XCircle } from 'lucide-react';
import ImportProgressBar from '@/components/ImportProgressBar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import * as XLSX from 'xlsx';
import { useToast } from '@/contexts/ToastContext';
import { 
  parseAIRExcelDataImproved,
  ValidationResult,
  MappingResult,
  FIXED_AIR_COLUMN_MAPPINGS,
  getBestMapping,
  createDynamicMapping,
  validateFileStructure,
  parseAIRDataRowWithMapping
} from '@/utils/airImportUtils';

interface AIRImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (data: AIRImportData[], strategy: 'merge' | 'replace') => void;
}


// 🛠️ FONCTION UTILITAIRE : Convertir un index de colonne en lettres Excel (A, B, ..., Z, AA, AB, ..., BQ)
const getExcelColumnName = (index: number): string => {
  let columnName = '';
  let num = index;
  
  while (num >= 0) {
    columnName = String.fromCharCode(65 + (num % 26)) + columnName;
    num = Math.floor(num / 26) - 1;
  }
  
  return columnName;
};

export const AIRImportModal = ({
  isOpen,
  onClose,
  onImport
}: AIRImportModalProps) => {
  const [file, setFile] = useState<File | null>(null);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [importStrategy, setImportStrategy] = useState<'merge' | 'replace'>('merge');
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewData, setPreviewData] = useState<AIRImportData[]>([]);
  const [completeData, setCompleteData] = useState<AIRImportData[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [sheets, setSheets] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [debugInfo, setDebugInfo] = useState<string>('');
  const [showDebug, setShowDebug] = useState(false);
  
  // 🆕 NOUVEAUX ÉTATS POUR LES AMÉLIORATIONS
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [mappingResult, setMappingResult] = useState<MappingResult | null>(null);
  const [forceDynamicMapping, setForceDynamicMapping] = useState(false);
  const [showMappingEditor, setShowMappingEditor] = useState(false);
  const [customMapping, setCustomMapping] = useState<Record<string, number>>({});
  const [availableHeaders, setAvailableHeaders] = useState<string[]>([]);
  const [previewRowCount, setPreviewRowCount] = useState(5);
  const [hoveredHeader, setHoveredHeader] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

  // Réinitialiser l'état lors de l'ouverture
  useEffect(() => {
    if (isOpen) {
      resetState();
    }
  }, [isOpen]);

  const resetState = () => {
    setFile(null);
    setWorkbook(null);
    setPreviewData([]);
    setCompleteData([]);
    setErrors([]);
    setSheets([]);
    setSelectedSheet('');
    setDebugInfo('');
    setValidation(null);
    setMappingResult(null);
    setForceDynamicMapping(false);
    setShowMappingEditor(false);
    setCustomMapping({});
    setAvailableHeaders([]);
    setPreviewRowCount(5);
    setHoveredHeader(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // 🆕 FONCTION POUR FORCER LE REMAPPING
  const handleForceRemapping = () => {
    setForceDynamicMapping(true);
    if (workbook && selectedSheet) {
      parseSelectedSheet(workbook, selectedSheet);
    }
  };

  // 🆕 FONCTION POUR APPLIQUER UN MAPPING PERSONNALISÉ
  const handleApplyCustomMapping = () => {
    if (!workbook || !selectedSheet || Object.keys(customMapping).length === 0) {
      showToast('Veuillez configurer au moins un champ', 'error');
      return;
    }

    setIsProcessing(true);
    
    try {
      const worksheet = workbook.Sheets[selectedSheet];
      const jsonData = XLSX.utils.sheet_to_json<any>(worksheet, {
        header: 1,
        defval: '',
        blankrows: false,
        raw: true
      });

      const validationResult = validateFileStructure(jsonData);
      if (!validationResult.isValid) {
        throw new Error(validationResult.message);
      }

      const headerRowIndex = validationResult.headerRowIndex ?? 2;
      const dataStartIndex = headerRowIndex + 2;
      
      // Parser avec le mapping personnalisé
      const data: AIRImportData[] = [];
      const parseErrors: string[] = [];
      
      for (let i = dataStartIndex; i < jsonData.length; i++) {
        const row = jsonData[i];
        if (!row || row.every((cell: any) => !cell || String(cell).trim() === '')) {
          continue;
        }
        
        try {
          const airData = parseAIRDataRowWithMapping(row, i, customMapping);
          if (airData) {
            data.push(airData);
          }
        } catch (error) {
          parseErrors.push(`Erreur ligne ${i + 1}: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
        }
      }

      // Créer un mapping result personnalisé
      const customMappingResult: MappingResult = {
        mapping: customMapping,
        confidence: 'high',
        method: 'dynamic',
        foundFields: Object.keys(customMapping),
        missingFields: []
      };

      setValidation(validationResult);
      setMappingResult(customMappingResult);
      setCompleteData(data);
      setPreviewData(data.slice(0, previewRowCount));
      setErrors(parseErrors);
      
      addDebugInfo(`✅ Mapping personnalisé appliqué: ${data.length} mesures trouvées`);
      showToast(`${data.length} mesures détectées avec mapping personnalisé`, 'success');
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Erreur lors de l\'application du mapping';
      setErrors([errorMsg]);
      showToast('Erreur lors de l\'application du mapping', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // 🆕 FONCTION POUR AJUSTER LE MAPPING DIRECTEMENT DEPUIS L'APERÇU
  const adjustMapping = (fieldName: string, direction: 'left' | 'right') => {
    const currentIndex = customMapping[fieldName];
    if (currentIndex === undefined) return;

    const newIndex = direction === 'left' ? currentIndex - 1 : currentIndex + 1;
    
    // Vérifier que l'index reste dans les limites
    if (newIndex < 0 || newIndex >= availableHeaders.length) {
      showToast(`Impossible de décaler plus vers la ${direction === 'left' ? 'gauche' : 'droite'}`, 'error');
      return;
    }

    const newMapping = {
      ...customMapping,
      [fieldName]: newIndex
    };
    
    setCustomMapping(newMapping);
    
    // Appliquer automatiquement le nouveau mapping
    if (workbook && selectedSheet) {
      applyMappingAndRefresh(newMapping);
    }
  };

  // 🆕 FONCTION POUR APPLIQUER ET RAFRAÎCHIR RAPIDEMENT
  const applyMappingAndRefresh = async (mapping: Record<string, number>) => {
    try {
      const worksheet = workbook!.Sheets[selectedSheet];
      const jsonData = XLSX.utils.sheet_to_json<any>(worksheet, {
        header: 1,
        defval: '',
        blankrows: false,
        raw: true
      });

      const validationResult = validateFileStructure(jsonData);
      const headerRowIndex = validationResult.headerRowIndex ?? 2;
      const dataStartIndex = headerRowIndex + 2;
      
      // Parser rapidement quelques lignes pour l'aperçu
      const previewData: AIRImportData[] = [];
      const maxPreviewRows = Math.min(dataStartIndex + previewRowCount + 5, jsonData.length);
      
      for (let i = dataStartIndex; i < maxPreviewRows; i++) {
        const row = jsonData[i];
        if (!row || row.every((cell: any) => !cell || String(cell).trim() === '')) {
          continue;
        }
        
        try {
          const airData = parseAIRDataRowWithMapping(row, i, mapping);
          if (airData && previewData.length < previewRowCount) {
            previewData.push(airData);
          }
        } catch (error) {
          // Ignorer les erreurs pour l'aperçu rapide
        }
      }

      setPreviewData(previewData);
      
    } catch (error) {
      console.error('Erreur lors du rafraîchissement rapide:', error);
    }
  };

  const addDebugInfo = (info: string) => {
    setDebugInfo(prev => prev + info + '\n');
    console.log(info);
  };

  // Gérer la sélection du fichier
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setErrors([]);
      await loadWorkbook(selectedFile);
    }
  };

  // Charger le classeur Excel
  const loadWorkbook = async (file: File) => {
    try {
      setIsProcessing(true);
      addDebugInfo('🔄 Chargement du fichier Excel...');
      
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
      
      // Sélectionner automatiquement la feuille "Bases" si elle existe
      const basesSheet = wb.SheetNames.find(name => 
        name.toLowerCase().includes('bases') || 
        name.toLowerCase().includes('base')
      );
      
      const targetSheet = basesSheet || wb.SheetNames[0];
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

  // Analyser la feuille sélectionnée - 🆕 VERSION AMÉLIORÉE
  useEffect(() => {
    if (workbook && selectedSheet) {
      parseSelectedSheet(workbook, selectedSheet);
    }
  }, [selectedSheet]);

  const parseSelectedSheet = async (wb: XLSX.WorkBook, sheetName: string) => {
    try {
      setIsProcessing(true);
      setErrors([]);
      addDebugInfo(`🔍 Analyse de la feuille: ${sheetName}`);
      
      const worksheet = wb.Sheets[sheetName];
      if (!worksheet) {
        throw new Error(`Impossible de lire la feuille "${sheetName}"`);
      }
      
      // Convertir en JSON
      const jsonData = XLSX.utils.sheet_to_json<any>(worksheet, {
        header: 1,
        defval: '',
        blankrows: false,
        raw: true
      });
      
      if (!jsonData || jsonData.length <= 1) {
        throw new Error('Aucune donnée trouvée dans la feuille');
      }
      
      addDebugInfo(`📊 Nombre de lignes: ${jsonData.length}`);
      
      // 🆕 EXTRAIRE LES EN-TÊTES DISPONIBLES POUR L'ÉDITEUR
      const headerRowIndex = validation ? validation.headerRowIndex ?? 2 : 2;
      if (jsonData[headerRowIndex]) {
        const headers = jsonData[headerRowIndex].map((header: any, index: number) =>
          header ? `${getExcelColumnName(index)}${headerRowIndex + 1}: ${String(header)}` : ''
        ).filter(Boolean);
        setAvailableHeaders(headers);
        addDebugInfo(`📋 En-têtes disponibles: ${headers.length} colonnes détectées`);
      }
      
      // 🆕 UTILISATION DE LA NOUVELLE FONCTION AMÉLIORÉE
      let data: AIRImportData[], parseErrors: string[], validationResult: ValidationResult, mappingRes: MappingResult;
      
      if (forceDynamicMapping) {
        // Force l'utilisation du mapping dynamique
        addDebugInfo('🔧 Mapping dynamique forcé par l\'utilisateur');
        
        validationResult = validateFileStructure(jsonData);
        if (!validationResult.isValid) {
          throw new Error(validationResult.message);
        }
        
        const headerRowIndex = validationResult.headerRowIndex ?? 2;
        mappingRes = createDynamicMapping(jsonData, headerRowIndex);
        
        // Parser manuellement les données avec le mapping dynamique
        data = [];
        parseErrors = [];
        const dataStartIndex = headerRowIndex + 2;
        
        for (let i = dataStartIndex; i < jsonData.length; i++) {
          const row = jsonData[i];
          if (!row || row.every((cell: any) => !cell || String(cell).trim() === '')) {
            continue;
          }
          
          try {
            const airData = parseAIRDataRowWithMapping(row, i, mappingRes.mapping);
            if (airData) {
              data.push(airData);
            }
          } catch (error) {
            parseErrors.push(`Erreur ligne ${i + 1}: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
          }
        }
      } else {
        // Utilisation normale (mapping fixe puis dynamique si échec)
        const result = parseAIRExcelDataImproved(jsonData, sheetName);
        data = result.data;
        parseErrors = result.errors;
        validationResult = result.validation;
        mappingRes = result.mappingResult;
      }
      
      // Stocker les résultats de validation et mapping
      setValidation(validationResult);
      setMappingResult(mappingRes);
      
      // 🆕 PRÉ-REMPLIR LE MAPPING PERSONNALISÉ AVEC LE MAPPING DÉTECTÉ
      if (Object.keys(customMapping).length === 0) {
        setCustomMapping(mappingRes.mapping);
      }
      
      // 🆕 AFFICHAGE DES INFORMATIONS DE VALIDATION
      addDebugInfo(`✅ Validation: ${validationResult.message} (confiance: ${validationResult.confidence})`);
      addDebugInfo(`🎯 Mapping: ${mappingRes.method} (confiance: ${mappingRes.confidence})`);
      
      if (validationResult.headerRowIndex !== undefined) {
        addDebugInfo(`📍 En-têtes détectés ligne ${validationResult.headerRowIndex + 1}`);
      }
      
      // 🆕 AFFICHAGE DES CHAMPS TROUVÉS/MANQUANTS
      if (mappingRes.foundFields.length > 0) {
        addDebugInfo(`✅ Champs trouvés: ${mappingRes.foundFields.join(', ')}`);
      }
      if (mappingRes.missingFields.length > 0) {
        addDebugInfo(`⚠️ Champs manquants: ${mappingRes.missingFields.join(', ')}`);
      }
      
      // 🆕 AFFICHAGE DU MAPPING UTILISÉ (si dynamique)
      if (mappingRes.method === 'dynamic') {
        addDebugInfo('🔧 Mapping dynamique utilisé:');
        Object.entries(mappingRes.mapping).forEach(([field, colIndex]) => {
          const colLetter = getExcelColumnName(colIndex);
          addDebugInfo(`  ${field} → Colonne ${colLetter} (${colIndex + 1})`);
        });
      }
      
      if (parseErrors.length > 0) {
        setErrors(parseErrors);
        addDebugInfo(`❌ Erreurs détectées: ${parseErrors.length}`);
        parseErrors.slice(0, 3).forEach(error => addDebugInfo(`  - ${error}`));
        if (parseErrors.length > 3) {
          addDebugInfo(`  ... et ${parseErrors.length - 3} autres erreurs`);
        }
      }
      
      if (data.length === 0) {
        throw new Error('Aucune donnée valide trouvée après analyse');
      }
      
      addDebugInfo(`🎉 Données analysées: ${data.length} mesures AIR valides`);
      
      // Stocker les données
      setCompleteData(data);
      setPreviewData(data.slice(0, 5)); // Aperçu limité à 5 lignes
      
      showToast(`${data.length} mesures AIR détectées`, 'success');
      
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

  // Gérer l'importation
  const handleImport = () => {
    if (!file || !workbook || !selectedSheet || completeData.length === 0) {
      setErrors(['Veuillez sélectionner un fichier valide avec des données à importer']);
      return;
    }
    
    setIsProcessing(true);
    
    try {
      onImport(completeData, importStrategy);
      showToast(`${completeData.length} mesures AIR importées avec succès`, 'success');
      onClose();
    } catch (error) {
      console.error('Erreur lors de l\'importation:', error);
      const errorMsg = error instanceof Error ? error.message : 'Erreur lors de l\'importation';
      setErrors([errorMsg]);
      showToast('Erreur lors de l\'importation', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importer des mesures AIR (format amélioré)</DialogTitle>
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
                <p className="text-sm font-medium">Cliquez pour sélectionner un fichier Excel</p>
                <p className="text-xs text-gray-500">
                  Format accepté: XLSX (détection automatique du format)
                </p>
              </div>
            )}
          </div>

          {/* 🆕 INFORMATIONS DE VALIDATION ET MAPPING */}
          {validation && mappingResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {/* Validation */}
                <Alert className={
                  validation.confidence === 'high' ? 'border-green-200 bg-green-50' :
                  validation.confidence === 'medium' ? 'border-yellow-200 bg-yellow-50' :
                  'border-red-200 bg-red-50'
                }>
                  {validation.confidence === 'high' ? <CheckCircle className="h-4 w-4 text-green-600" /> :
                   validation.confidence === 'medium' ? <AlertCircle className="h-4 w-4 text-yellow-600" /> :
                   <XCircle className="h-4 w-4 text-red-600" />}
                  <AlertTitle>Validation du fichier</AlertTitle>
                  <AlertDescription>
                    <div className="text-sm">
                      <div className="font-medium">{validation.message}</div>
                      <div className="text-xs mt-1">
                        Confiance: {validation.confidence} • {validation.dataRowsCount} lignes de données
                      </div>
                    </div>
                  </AlertDescription>
                </Alert>

                {/* Mapping */}
                <Alert className={
                  mappingResult.confidence === 'high' ? 'border-green-200 bg-green-50' :
                  mappingResult.confidence === 'medium' ? 'border-yellow-200 bg-yellow-50' :
                  'border-red-200 bg-red-50'
                }>
                  {mappingResult.confidence === 'high' ? <CheckCircle className="h-4 w-4 text-green-600" /> :
                   mappingResult.confidence === 'medium' ? <AlertCircle className="h-4 w-4 text-yellow-600" /> :
                   <XCircle className="h-4 w-4 text-red-600" />}
                  <AlertTitle>Mapping des colonnes</AlertTitle>
                  <AlertDescription>
                    <div className="text-sm">
                      <div className="font-medium">
                        {mappingResult.method === 'fixed' ? 'Mapping standard' : 'Mapping dynamique'}
                        {forceDynamicMapping && ' (forcé)'}
                      </div>
                      <div className="text-xs mt-1">
                        Confiance: {mappingResult.confidence} • {mappingResult.foundFields.length} champs trouvés
                      </div>
                    </div>
                  </AlertDescription>
                </Alert>
              </div>
              
              {/* Message si mapping dynamique déjà utilisé */}
              {forceDynamicMapping && (
                <div className="flex justify-center">
                  <div className="text-sm text-green-600 bg-green-50 px-3 py-1 rounded">
                    ✅ Mapping automatique activé
                  </div>
                </div>
              )}
              
              {/* 🆕 BOUTONS DE CONTRÔLE DU MAPPING */}
              <div className="flex justify-center gap-2">
                {!forceDynamicMapping && (
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={handleForceRemapping}
                    disabled={isProcessing}
                    className="text-blue-600 border-blue-300 hover:bg-blue-50"
                  >
                    🔧 Mapping automatique
                  </Button>
                )}
                
                {forceDynamicMapping && (
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => {
                      setForceDynamicMapping(false);
                      if (workbook && selectedSheet) {
                        parseSelectedSheet(workbook, selectedSheet);
                      }
                    }}
                    disabled={isProcessing}
                    className="text-gray-600 border-gray-300 hover:bg-gray-50"
                  >
                    ↩️ Mapping standard
                  </Button>
                )}
                
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setShowMappingEditor(!showMappingEditor)}
                  disabled={isProcessing}
                  className="text-purple-600 border-purple-300 hover:bg-purple-50"
                >
                  {showMappingEditor ? '📋 Masquer éditeur' : '✏️ Ajuster le mapping'}
                </Button>
              </div>
              
              {/* Ancien code conditionnel supprimé */}
              
              {/* 🆕 AFFICHAGE DES CHAMPS MANQUANTS */}
              {mappingResult.missingFields.length > 0 && (
                <Alert className="border-orange-200 bg-orange-50">
                  <AlertCircle className="h-4 w-4 text-orange-600" />
                  <AlertTitle>Champs non détectés</AlertTitle>
                  <AlertDescription>
                    <div className="text-sm">
                      Les champs suivants n'ont pas pu être détectés automatiquement : 
                      <div className="mt-1 text-xs">
                        <code className="bg-white px-1 rounded">
                          {mappingResult.missingFields.join(', ')}
                        </code>
                      </div>
                    </div>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {/* 🆕 ÉDITEUR DE MAPPING PERSONNALISÉ */}
          {showMappingEditor && availableHeaders.length > 0 && (
            <div className="space-y-4 border rounded-lg p-4 bg-gray-50">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-medium">🔧 Ajuster le mapping des colonnes</h3>
                <div className="flex gap-2">
                  <Button 
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (mappingResult) {
                        setCustomMapping(mappingResult.mapping);
                        showToast('Mapping réinitialisé', 'success');
                      }
                    }}
                    disabled={isProcessing}
                    className="text-gray-600"
                  >
                    ↻ Réinitialiser
                  </Button>
                  <Button 
                    size="sm"
                    onClick={handleApplyCustomMapping}
                    disabled={isProcessing || Object.keys(customMapping).length === 0}
                    className="bg-purple-600 hover:bg-purple-700"
                  >
                    ✅ Appliquer
                  </Button>
                </div>
              </div>
              
              <div className="text-xs text-gray-600 mb-3">
                Mapping actuel pré-rempli. Modifiez les associations incorrectes et cliquez "Appliquer" :
              </div>

              <div className="grid grid-cols-2 gap-4 max-h-60 overflow-y-auto">
                {Object.keys(FIXED_AIR_COLUMN_MAPPINGS).map(fieldName => (
                  <div key={fieldName} className="flex items-center gap-2">
                    <Label className="text-xs font-medium w-24 text-right">
                      {fieldName === 'refAEM' ? 'Réf AEM' :
                       fieldName === 'nomPrenom' ? 'Nom/Prénom' :
                       fieldName === 'dateReception' ? 'Date réception' :
                       fieldName === 'resultatMesure' ? 'Résultat' :
                       fieldName === 'dateCloture' ? 'Date clôture' :
                       fieldName === 'nombreEntretiensAIR' ? 'Entretiens' :
                       fieldName === 'nombreCarences' ? 'Carences' :
                       fieldName}:
                    </Label>
                    <select
                      value={customMapping[fieldName] ?? ''}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value === '') {
                          const newMapping = { ...customMapping };
                          delete newMapping[fieldName];
                          setCustomMapping(newMapping);
                        } else {
                          setCustomMapping(prev => ({
                            ...prev,
                            [fieldName]: parseInt(value)
                          }));
                        }
                      }}
                      className="flex-1 text-xs p-1 border rounded"
                      disabled={isProcessing}
                    >
                      <option value="">-- Non assigné --</option>
                      {availableHeaders.map((header, index) => (
                        <option key={index} value={index}>
                          {header}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              {/* Aperçu du mapping actuel */}
              {Object.keys(customMapping).length > 0 && (
                <div className="mt-3 p-2 bg-white rounded border">
                  <div className="text-xs font-medium mb-1">Mapping configuré :</div>
                  <div className="text-xs text-gray-600">
                    {Object.entries(customMapping).map(([field, colIndex]) => (
                      <div key={field}>
                        <strong>{field}</strong> → Colonne {getExcelColumnName(colIndex)} ({colIndex + 1})
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Sélection de la feuille */}
          {sheets.length > 1 && (
            <div className="space-y-2">
              <Label>Sélectionner une feuille:</Label>
              <select
                value={selectedSheet}
                onChange={(e) => setSelectedSheet(e.target.value)}
                className="w-full p-2 border rounded"
                disabled={isProcessing}
              >
                {sheets.map(sheet => (
                  <option key={sheet} value={sheet}>{sheet}</option>
                ))}
              </select>
            </div>
          )}

          {/* Options d'importation avec radio buttons simples */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Mode d'importation:</h3>
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <input
                  type="radio"
                  id="merge"
                  name="importStrategy"
                  value="merge"
                  checked={importStrategy === 'merge'}
                  onChange={(e) => setImportStrategy(e.target.value as 'merge' | 'replace')}
                  disabled={isProcessing}
                />
                <Label htmlFor="merge">
                  Fusionner - Ajouter et mettre à jour les mesures existantes
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="radio"
                  id="replace"
                  name="importStrategy"
                  value="replace"
                  checked={importStrategy === 'replace'}
                  onChange={(e) => setImportStrategy(e.target.value as 'merge' | 'replace')}
                  disabled={isProcessing}
                />
                <Label htmlFor="replace">
                  Remplacer - Supprimer toutes les mesures existantes
                </Label>
              </div>
            </div>
          </div>

          {/* Aperçu des données avec contrôles */}
          {previewData.length > 0 && (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-medium">
                  Aperçu des données ({previewData.length} sur {completeData.length} mesures)
                </h3>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">Lignes:</Label>
                    <select
                      value={previewRowCount}
                      onChange={(e) => {
                        const newCount = parseInt(e.target.value);
                        setPreviewRowCount(newCount);
                        setPreviewData(completeData.slice(0, newCount));
                      }}
                      className="text-xs p-1 border rounded w-16"
                    >
                      <option value={5}>5</option>
                      <option value={10}>10</option>
                      <option value={15}>15</option>
                      <option value={20}>20</option>
                    </select>
                  </div>
                  {/* 🆕 BOUTON POUR VALIDER LE MAPPING AJUSTÉ */}
                  <Button 
                    size="sm"
                    onClick={handleApplyCustomMapping}
                    disabled={isProcessing}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    ✅ Valider ce mapping
                  </Button>
                </div>
              </div>
              
              <div className="overflow-x-auto border rounded">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-100">
                      {[
                        { key: 'refAEM', label: 'Réf. AEM', width: 'w-24' },
                        { key: 'nomPrenom', label: 'Nom/Prénom', width: 'w-32' },
                        { key: 'faits', label: 'Faits', width: 'w-32' },
                        { key: 'dateReception', label: 'Date réception', width: 'w-24' },
                        { key: 'secteurGeographique', label: 'Secteur géographique', width: 'w-28' },
                        { key: 'referent', label: 'En charge de', width: 'w-24' },
                        { key: 'nombreEntretiensAIR', label: 'Entretiens AIR', width: 'w-20' },
                        { key: 'nombreRencontresPR', label: 'Rencontre PR', width: 'w-20' },
                        { key: 'nombreCarences', label: 'Carences', width: 'w-18' },
                        { key: 'dateFinPriseEnCharge', label: 'Date fin prise en charge', width: 'w-28' },
                        { key: 'natureFinAIR', label: 'Nature fin AIR', width: 'w-28' },
                        { key: 'resultatMesure', label: 'Résultat', width: 'w-24' },
                        { key: 'dateCloture', label: 'Date clôture', width: 'w-24' },
                        { key: 'statut', label: 'Statut', width: 'w-20' }
                      ].map(({ key, label, width }) => (
                        <th 
                          key={key}
                          className={`border p-2 text-left relative group cursor-pointer ${width}`}
                          onMouseEnter={() => setHoveredHeader(key)}
                          onMouseLeave={() => setHoveredHeader(null)}
                        >
                          <div className="flex items-center justify-between">
                            <span>{label}</span>
                            {hoveredHeader === key && customMapping[key] !== undefined && (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    adjustMapping(key, 'left');
                                  }}
                                  className="w-4 h-4 bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center justify-center text-xs"
                                  title="Décaler vers la gauche"
                                  disabled={isProcessing}
                                >
                                  −
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    adjustMapping(key, 'right');
                                  }}
                                  className="w-4 h-4 bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center justify-center text-xs"
                                  title="Décaler vers la droite"
                                  disabled={isProcessing}
                                >
                                  +
                                </button>
                              </div>
                            )}
                          </div>
                          {/* Indicateur de colonne Excel */}
                          {customMapping[key] !== undefined && (
                            <div className="text-[10px] text-gray-400 mt-1">
                              Col. {getExcelColumnName(customMapping[key])}
                            </div>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.map((item, index) => (
                      <tr 
                        key={index} 
                        className={`${
                          item.statut === 'echec' ? 'bg-red-50' :
                          item.statut === 'reussite' ? 'bg-green-50' :
                          item.statut === 'termine' ? 'bg-blue-50' : ''
                        } hover:bg-gray-50`}
                      >
                        <td className="border p-2 font-mono text-xs">{item.refAEM}</td>
                        <td className="border p-2 text-xs">{item.nomPrenom}</td>
                        <td className="border p-2 text-xs max-w-32" title={item.faits}>
                          {item.faits.length > 25 ? `${item.faits.substring(0, 25)}...` : item.faits}
                        </td>
                        <td className="border p-2 text-xs">
                          {item.dateReception ? new Date(item.dateReception).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : ''}
                        </td>
                        <td className="border p-2 text-xs">{item.secteurGeographique || ''}</td>
                        <td className="border p-2 text-xs">{item.referent || ''}</td>
                        <td className="border p-2 text-center text-xs">{item.nombreEntretiensAIR || 0}</td>
                        <td className="border p-2 text-center text-xs">{item.nombreRencontresPR || 0}</td>
                        <td className="border p-2 text-center text-xs">{item.nombreCarences || 0}</td>
                        <td className="border p-2 text-xs">
                          <span className={`text-xs ${!item.dateFinPriseEnCharge ? 'text-gray-400 italic' : 'text-gray-700'}`}>
                            {item.dateFinPriseEnCharge ? 
                              new Date(item.dateFinPriseEnCharge).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : 
                              'Non définie'
                            }
                          </span>
                        </td>
                        <td className="border p-2 text-xs max-w-28" title={item.natureFinAIR}>
                          <span className={`text-xs ${!item.natureFinAIR ? 'text-gray-400 italic' : 'text-gray-700'}`}>
                            {item.natureFinAIR ? 
                              (item.natureFinAIR.length > 20 ? `${item.natureFinAIR.substring(0, 20)}...` : item.natureFinAIR) : 
                              'Non définie'
                            }
                          </span>
                        </td>
                        <td className="border p-2 text-xs">
                          <span className={`px-1 rounded text-xs ${
                            !item.resultatMesure ? 'bg-gray-100 text-gray-500 italic' : 
                            item.resultatMesure.toLowerCase().includes('réussite') ? 'bg-green-100 text-green-800' :
                            item.resultatMesure.toLowerCase().includes('échec') ? 'bg-red-100 text-red-800' :
                            'bg-yellow-100 text-yellow-800'
                          }`}>
                            {item.resultatMesure || 'Non défini'}
                          </span>
                        </td>
                        <td className="border p-2 text-xs">
                          <span className={`text-xs ${!item.dateCloture ? 'text-gray-400 italic' : 'text-gray-700'}`}>
                            {item.dateCloture ? 
                              new Date(item.dateCloture).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : 
                              'Non définie'
                            }
                          </span>
                        </td>
                        <td className="border p-2 text-xs">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            item.statut === 'echec' ? 'bg-red-100 text-red-800' :
                            item.statut === 'reussite' ? 'bg-green-100 text-green-800' :
                            item.statut === 'termine' ? 'bg-blue-100 text-blue-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {item.statut === 'echec' ? 'Échec' :
                             item.statut === 'reussite' ? 'Réussite' :
                             item.statut === 'termine' ? 'Terminé' :
                             'En cours'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              {/* Légende des contrôles */}
              <div className="text-xs text-gray-500 bg-blue-50 p-2 rounded">
                💡 <strong>Astuce:</strong> Survolez les en-têtes de colonnes et utilisez les boutons <strong>−</strong> et <strong>+</strong> 
                pour ajuster le mapping en temps réel. Les données se mettent à jour automatiquement.
              </div>
            </div>
          )}

          {/* Statistiques des données */}
          {completeData.length > 0 && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Résumé de l'import</AlertTitle>
              <AlertDescription>
                <div className="grid grid-cols-2 gap-4 mt-2 text-sm">
                  <div>
                    <strong>Total:</strong> {completeData.length} mesures
                  </div>
                  <div>
                    <strong>En cours:</strong> {completeData.filter(d => d.statut === 'en_cours').length}
                  </div>
                  <div>
                    <strong>Réussites:</strong> {completeData.filter(d => d.statut === 'reussite').length}
                  </div>
                  <div>
                    <strong>Échecs:</strong> {completeData.filter(d => d.statut === 'echec').length}
                  </div>
                </div>
              </AlertDescription>
            </Alert>
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

          {/* Bouton de débogage */}
          <div className="flex justify-end">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setShowDebug(!showDebug)}
            >
              {showDebug ? "Masquer" : "Afficher"} les détails
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
            <div className="space-y-2">
              <p className="text-sm font-medium">Traitement en cours...</p>
              <ImportProgressBar indeterminate={true} />
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
            onClick={handleImport}
            disabled={!file || isProcessing || completeData.length === 0}
          >
            Importer {completeData.length > 0 && `(${completeData.length} mesures)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};