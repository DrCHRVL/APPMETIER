// utils/documents/DocumentIntegrationHelper.ts
import { DocumentAnalysisResult } from './DocumentAnalyzer';
import { EcouteData, GeolocData, AutreActe } from '@/types/interfaces';

export interface PreFilledModalData {
  modalType: 'ecoute' | 'geoloc' | 'acte' | 'none';
  formData: any;
  confidence: number;
  suggestedAction: string;
  needsValidation: boolean;
}

export class DocumentIntegrationHelper {
  
  /**
   * Convertit les résultats d'analyse en données pré-remplies pour les modales
   */
  static prepareModalData(analysisResult: DocumentAnalysisResult): PreFilledModalData {
    const { category, extractedData, confidence } = analysisResult;

    switch (category) {
      case 'nouvelle_ecoute':
        return this.prepareEcouteData(analysisResult);
        
      case 'nouvelle_geolocalisation':
        return this.prepareGeolocData(analysisResult);
        
      case 'nouvelle_captation_images':
        return this.prepareActeData(analysisResult);
        
      default:
        return {
          modalType: 'none',
          formData: {},
          confidence,
          suggestedAction: analysisResult.suggestedAction,
          needsValidation: true
        };
    }
  }

  /**
   * Prépare les données pour le modal d'écoute
   */
  private static prepareEcouteData(analysisResult: DocumentAnalysisResult): PreFilledModalData {
    const { extractedData, confidence } = analysisResult;
    
    const numeroFormate = this.formatPhoneNumber(extractedData.numeroTelephone || '');
    const cible = extractedData.cible || extractedData.titulaire || '';
    const duree = this.parseDuration(extractedData.duree || '30');
    
    const formData = {
      numero: numeroFormate,
      cible: cible.trim(),
      description: this.buildEcouteDescription(extractedData),
      dateDebut: extractedData.dateDecision || '',
      duree: duree,
      // Métadonnées pour affichage
      _sourceDocument: analysisResult.fileName,
      _tribunal: 'Tribunal judiciaire d\'Amiens',
      _procureur: extractedData.procureur || 'Non spécifié'
    };

    return {
      modalType: 'ecoute',
      formData,
      confidence,
      suggestedAction: 'Créer une nouvelle écoute téléphonique',
      needsValidation: confidence < 0.85
    };
  }

  /**
   * Prépare les données pour le modal de géolocalisation
   */
  private static prepareGeolocData(analysisResult: DocumentAnalysisResult): PreFilledModalData {
    const { extractedData, confidence } = analysisResult;
    
    const objet = extractedData.objet || this.buildGeolocObject(extractedData);
    const duree = this.parseDuration(extractedData.duree || '8');
    
    const formData = {
      objet: objet,
      description: this.buildGeolocDescription(extractedData),
      dateDebut: extractedData.dateDecision || '',
      duree: duree,
      // Métadonnées pour affichage
      _sourceDocument: analysisResult.fileName,
      _vehicule: extractedData.vehicule,
      _plaques: extractedData.plaques,
      _tribunal: 'Tribunal judiciaire d\'Amiens'
    };

    return {
      modalType: 'geoloc',
      formData,
      confidence,
      suggestedAction: 'Créer une nouvelle géolocalisation',
      needsValidation: confidence < 0.85
    };
  }

  /**
   * Prépare les données pour le modal d'acte (captation d'images)
   */
  private static prepareActeData(analysisResult: DocumentAnalysisResult): PreFilledModalData {
    const { extractedData, confidence } = analysisResult;
    
    const type = 'Captation d\'images';
    const duree = this.parseDuration(extractedData.duree || '14');
    
    const formData = {
      type: type,
      description: this.buildActeDescription(extractedData),
      dateDebut: extractedData.dateDecision || '',
      duree: duree,
      // Métadonnées pour affichage
      _sourceDocument: analysisResult.fileName,
      _objet: extractedData.objet,
      _tribunal: 'Tribunal judiciaire d\'Amiens'
    };

    return {
      modalType: 'acte',
      formData,
      confidence,
      suggestedAction: 'Créer une nouvelle captation d\'images',
      needsValidation: confidence < 0.85
    };
  }

  // === MÉTHODES UTILITAIRES ===

  /**
   * Formate un numéro de téléphone
   */
  private static formatPhoneNumber(numero: string): string {
    if (!numero) return '';
    
    const cleaned = numero.replace(/\D/g, '');
    
    if (cleaned.length === 10) {
      return cleaned.replace(/(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1.$2.$3.$4.$5');
    }
    
    return cleaned;
  }

  /**
   * Parse la durée depuis le texte
   */
  private static parseDuration(dureeText: string): string {
    if (!dureeText) return '';
    
    const match = dureeText.match(/(\d+)/);
    if (match) {
      return match[1];
    }
    
    // Valeurs par défaut
    if (dureeText.toLowerCase().includes('mois')) {
      return '30';
    }
    if (dureeText.toLowerCase().includes('semaine')) {
      return '14';
    }
    
    return dureeText;
  }

  /**
   * Construit la description pour une écoute
   */
  private static buildEcouteDescription(extractedData: any): string {
    const parts = [];
    
    if (extractedData.titulaire) {
      parts.push(`Ligne au nom de : ${extractedData.titulaire}`);
    }
    
    if (extractedData.cible && extractedData.cible !== extractedData.titulaire) {
      parts.push(`Utilisée par : ${extractedData.cible}`);
    }
    
    if (extractedData.dateDecision) {
      parts.push(`Date d'autorisation : ${extractedData.dateDecision}`);
    }
    
    return parts.join('\n');
  }

  /**
   * Construit l'objet géolocalisé
   */
  private static buildGeolocObject(extractedData: any): string {
    const parts = [];
    
    if (extractedData.vehicule) {
      parts.push(extractedData.vehicule);
    }
    
    if (extractedData.plaques && extractedData.plaques.length > 0) {
      const plaques = Array.isArray(extractedData.plaques) ? 
        extractedData.plaques.join(', ') : 
        extractedData.plaques;
      parts.push(`- ${plaques}`);
    }
    
    return parts.join(' ') || 'Véhicule à identifier';
  }

  /**
   * Construit la description pour une géolocalisation
   */
  private static buildGeolocDescription(extractedData: any): string {
    const parts = [];
    
    if (extractedData.vehicule) {
      parts.push(`Véhicule : ${extractedData.vehicule}`);
    }
    
    if (extractedData.plaques && extractedData.plaques.length > 0) {
      const plaques = Array.isArray(extractedData.plaques) ? 
        extractedData.plaques.join(', ') : 
        extractedData.plaques;
      parts.push(`Plaques : ${plaques}`);
    }
    
    if (extractedData.dateDecision) {
      parts.push(`Date d'autorisation : ${extractedData.dateDecision}`);
    }
    
    return parts.join('\n');
  }

  /**
   * Construit la description pour un acte
   */
  private static buildActeDescription(extractedData: any): string {
    const parts = [];
    
    if (extractedData.objet) {
      parts.push(`Objet : ${extractedData.objet}`);
    }
    
    if (extractedData.dateDecision) {
      parts.push(`Date d'autorisation : ${extractedData.dateDecision}`);
    }
    
    parts.push('Tribunal : Tribunal judiciaire d\'Amiens');
    
    return parts.join('\n');
  }

  /**
   * Valide les données extraites avant pré-remplissage
   */
  static validateExtractedData(modalData: PreFilledModalData): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    switch (modalData.modalType) {
      case 'ecoute':
        if (!modalData.formData.numero) {
          errors.push('Numéro de téléphone manquant');
        } else if (!/^\d{2}\.\d{2}\.\d{2}\.\d{2}\.\d{2}$/.test(modalData.formData.numero)) {
          warnings.push('Format du numéro de téléphone à vérifier');
        }
        
        if (!modalData.formData.cible) {
          warnings.push('Cible/titulaire non identifié');
        }
        break;

      case 'geoloc':
        if (!modalData.formData.objet) {
          errors.push('Objet à géolocaliser manquant');
        }
        
        if (!modalData.formData._vehicule) {
          warnings.push('Modèle de véhicule non identifié');
        }
        
        if (!modalData.formData._plaques || modalData.formData._plaques.length === 0) {
          warnings.push('Plaque d\'immatriculation non trouvée');
        }
        break;

      case 'acte':
        if (!modalData.formData.type) {
          errors.push('Type d\'acte manquant');
        }
        break;
    }

    // Validation des dates
    if (modalData.formData.dateDebut) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(modalData.formData.dateDebut)) {
        warnings.push('Format de date à vérifier');
      }
    }

    // Validation de la durée
    if (modalData.formData.duree) {
      const dureeNum = parseInt(modalData.formData.duree);
      if (isNaN(dureeNum) || dureeNum <= 0) {
        warnings.push('Durée à vérifier');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Génère un rapport de confiance pour l'utilisateur
   */
  static generateConfidenceReport(modalData: PreFilledModalData): {
    level: 'high' | 'medium' | 'low';
    message: string;
    details: string[];
  } {
    const { confidence } = modalData;
    const validation = this.validateExtractedData(modalData);

    let level: 'high' | 'medium' | 'low';
    let message: string;
    const details: string[] = [];

    if (confidence >= 0.85 && validation.isValid && validation.warnings.length === 0) {
      level = 'high';
      message = 'Analyse très fiable - Données prêtes à utiliser';
      details.push('✅ Document reconnu avec certitude');
      details.push('✅ Toutes les données importantes extraites');
    } else if (confidence >= 0.70 && validation.isValid) {
      level = 'medium';
      message = 'Analyse fiable - Vérification recommandée';
      details.push('✅ Document reconnu');
      details.push('⚠️ Certaines données peuvent nécessiter une vérification');
      details.push(...validation.warnings.map(w => `⚠️ ${w}`));
    } else {
      level = 'low';
      message = 'Analyse incertaine - Vérification obligatoire';
      details.push('❌ Document partiellement reconnu');
      details.push(...validation.errors.map(e => `❌ ${e}`));
      details.push(...validation.warnings.map(w => `⚠️ ${w}`));
    }

    return { level, message, details };
  }
}