// components/modals/DocumentAnalysisModal.tsx
import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Alert, AlertDescription } from '../ui/alert';
import { DocumentAnalysisResult } from '../../utils/documents/DocumentAnalyzer';
import { DocumentIntegrationHelper, PreFilledModalData } from '../../utils/documents/DocumentIntegrationHelper';
import { 
  FileText, 
  Phone, 
  MapPin, 
  Camera, 
  CheckCircle, 
  AlertCircle,
  Clock,
  Users,
  Car,
  Eye,
  Zap,
  XCircle,
  AlertTriangle
} from 'lucide-react';

interface DocumentAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  analysisResult: DocumentAnalysisResult;
  onCreateAct: (actType: string, prefilledData: any) => void;
  onIgnore: () => void;
}

export const DocumentAnalysisModal = ({
  isOpen,
  onClose,
  analysisResult,
  onCreateAct,
  onIgnore
}: DocumentAnalysisModalProps) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [modalData, setModalData] = useState<PreFilledModalData | null>(null);

  useEffect(() => {
    if (analysisResult) {
      const preparedData = DocumentIntegrationHelper.prepareModalData(analysisResult);
      setModalData(preparedData);
    }
  }, [analysisResult]);

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'nouvelle_ecoute':
        return <Phone className="h-6 w-6 text-blue-600" />;
      case 'nouvelle_geolocalisation':
        return <MapPin className="h-6 w-6 text-green-600" />;
      case 'nouvelle_captation_images':
        return <Camera className="h-6 w-6 text-purple-600" />;
      default:
        return <FileText className="h-6 w-6 text-gray-600" />;
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.85) return 'bg-green-100 text-green-800 border-green-200';
    if (confidence >= 0.70) return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    return 'bg-red-100 text-red-800 border-red-200';
  };

  const getConfidenceIcon = (confidence: number) => {
    if (confidence >= 0.85) return <CheckCircle className="h-4 w-4 text-green-600" />;
    if (confidence >= 0.70) return <AlertTriangle className="h-4 w-4 text-yellow-600" />;
    return <XCircle className="h-4 w-4 text-red-600" />;
  };

  const getCategoryLabel = (category: string) => {
    const labels = {
      'nouvelle_ecoute': 'Nouvelle autorisation d\'écoute téléphonique',
      'nouvelle_geolocalisation': 'Nouvelle autorisation de géolocalisation',
      'nouvelle_captation_images': 'Nouvelle autorisation de captation d\'images',
      'autre': 'Document non classifié'
    };
    return labels[category] || category;
  };

  const handleCreateAct = async () => {
    if (!modalData || modalData.modalType === 'none') {
      return;
    }

    setIsProcessing(true);
    
    try {
      const { actType, prefilledData } = preparePrefilledData();
      onCreateAct(actType, prefilledData);
    } finally {
      setIsProcessing(false);
    }
  };

  const preparePrefilledData = () => {
    if (!modalData) return { actType: 'acte', prefilledData: {} };

    const { formData, modalType } = modalData;
    const { extractedData } = analysisResult;
    
    const enhancedData = {
      ...formData,
      _analysisMetadata: {
        sourceDocument: analysisResult.fileName,
        confidence: analysisResult.confidence,
        detectedCategory: analysisResult.category,
        analysisDate: analysisResult.createdAt,
        tribunal: extractedData.tribunal || 'Tribunal judiciaire d\'Amiens'
      }
    };

    const modalToActType = {
      'ecoute': 'ecoute',
      'geoloc': 'geolocalisation',
      'acte': 'acte'
    };

    return {
      actType: modalToActType[modalType] || 'acte',
      prefilledData: enhancedData
    };
  };

  const canCreateAct = modalData && modalData.modalType !== 'none';
  const confidenceReport = modalData ? 
    DocumentIntegrationHelper.generateConfidenceReport(modalData) : 
    null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            {getCategoryIcon(analysisResult.category)}
            Nouvel acte d'enquête détecté
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Nom du fichier */}
          <div className="bg-gray-50 p-3 rounded-lg">
            <p className="text-sm font-medium text-gray-700 mb-1">Document analysé</p>
            <p className="text-sm text-gray-600 break-words">{analysisResult.fileName}</p>
          </div>

          {/* Résultat de l'analyse */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900">
                  {getCategoryLabel(analysisResult.category)}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  {getConfidenceIcon(analysisResult.confidence)}
                  <span className="text-sm text-gray-600">
                    Confiance: {Math.round(analysisResult.confidence * 100)}%
                  </span>
                </div>
              </div>
              <Badge className={`${getConfidenceColor(analysisResult.confidence)} border`}>
                {analysisResult.priority === 'high' ? 'Priorité haute' :
                 analysisResult.priority === 'medium' ? 'Priorité moyenne' : 'Priorité basse'}
              </Badge>
            </div>

            {/* Rapport de confiance */}
            {confidenceReport && (
              <Alert className={`border-l-4 ${
                confidenceReport.level === 'high' ? 'border-green-500 bg-green-50' :
                confidenceReport.level === 'medium' ? 'border-yellow-500 bg-yellow-50' :
                'border-red-500 bg-red-50'
              }`}>
                <AlertDescription>
                  <div className="flex items-center gap-2 mb-2">
                    {getConfidenceIcon(analysisResult.confidence)}
                    <span className="font-medium">{confidenceReport.message}</span>
                  </div>
                  {confidenceReport.details.length > 0 && (
                    <div className="space-y-1">
                      {confidenceReport.details.map((detail, index) => (
                        <p key={index} className="text-sm">{detail}</p>
                      ))}
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {/* Action suggérée */}
            <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle className="h-4 w-4 text-blue-600" />
                <p className="text-sm font-medium text-blue-900">Action suggérée</p>
              </div>
              <p className="text-sm text-blue-800">{analysisResult.suggestedAction}</p>
            </div>

            {/* Aperçu des données pré-remplies */}
            {modalData && modalData.modalType !== 'none' && (
              <div className="bg-green-50 p-3 rounded-lg border border-green-200">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-green-600" />
                    <p className="text-sm font-medium text-green-900">Pré-remplissage automatique</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm" 
                    onClick={() => setShowDetails(!showDetails)}
                    className="text-xs h-6"
                  >
                    <Eye className="h-3 w-3 mr-1" />
                    {showDetails ? 'Masquer' : 'Détails'}
                  </Button>
                </div>
                
                {/* Aperçu des données principales */}
                <div className="space-y-1">
                  {modalData.modalType === 'ecoute' && (
                    <>
                      {modalData.formData.numero && (
                        <div className="flex items-center gap-2 text-sm">
                          <Phone className="h-3 w-3 text-green-600" />
                          <span className="text-green-800">Numéro: {modalData.formData.numero}</span>
                        </div>
                      )}
                      {modalData.formData.cible && (
                        <div className="flex items-center gap-2 text-sm">
                          <Users className="h-3 w-3 text-green-600" />
                          <span className="text-green-800">Cible: {modalData.formData.cible}</span>
                        </div>
                      )}
                    </>
                  )}
                  
                  {modalData.modalType === 'geoloc' && (
                    <>
                      {modalData.formData.objet && (
                        <div className="flex items-center gap-2 text-sm">
                          <Car className="h-3 w-3 text-green-600" />
                          <span className="text-green-800">Objet: {modalData.formData.objet}</span>
                        </div>
                      )}
                      {modalData.formData._vehicule && (
                        <div className="flex items-center gap-2 text-sm">
                          <Car className="h-3 w-3 text-green-600" />
                          <span className="text-green-800">Véhicule: {modalData.formData._vehicule}</span>
                        </div>
                      )}
                    </>
                  )}
                  
                  {modalData.modalType === 'acte' && (
                    <>
                      {modalData.formData.type && (
                        <div className="flex items-center gap-2 text-sm">
                          <Camera className="h-3 w-3 text-green-600" />
                          <span className="text-green-800">Type: {modalData.formData.type}</span>
                        </div>
                      )}
                    </>
                  )}
                  
                  {modalData.formData.duree && (
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="h-3 w-3 text-green-600" />
                      <span className="text-green-800">Durée: {modalData.formData.duree} jours</span>
                    </div>
                  )}
                </div>

                {/* Détails complets si demandés */}
                {showDetails && (
                  <div className="mt-3 pt-3 border-t border-green-200">
                    <div className="text-xs space-y-1">
                      {Object.entries(analysisResult.extractedData).map(([key, value]) => {
                        if (!value || typeof value === 'object') return null;
                        return (
                          <div key={key} className="flex justify-between">
                            <span className="font-medium capitalize text-green-700">
                              {key.replace(/([A-Z])/g, ' $1').toLowerCase()}:
                            </span>
                            <span className="text-green-600 max-w-xs truncate">
                              {String(value)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex justify-between items-center">
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={onIgnore}
              disabled={isProcessing}
            >
              Ignorer
            </Button>
            
            {!canCreateAct && (
              <Button 
                onClick={onClose}
                disabled={isProcessing}
              >
                Fermer
              </Button>
            )}
          </div>
          
          {canCreateAct && (
            <div className="flex items-center gap-2">
              {modalData?.needsValidation && (
                <div className="text-xs text-amber-600 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Vérification recommandée
                </div>
              )}
              <Button 
                onClick={handleCreateAct}
                disabled={isProcessing}
                className="bg-green-600 hover:bg-green-700"
              >
                <Zap className="h-4 w-4 mr-2" />
                {isProcessing ? 'Création...' : `Créer l'acte avec pré-remplissage`}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};