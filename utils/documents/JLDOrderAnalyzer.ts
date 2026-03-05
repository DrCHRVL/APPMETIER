// utils/documents/JLDOrderAnalyzer.ts

export interface JLDPhoneNumber {
  fullNumber: string; // "06.49.83.21.97"
  lastFourDigits: string; // "21.97" 
  user: string; // "Boujemaa ABKARI"
  usageType: string; // "utilisé par" ou "susceptible d'être utilisé par"
}

export interface JLDAnalysisResult {
  isJLDOrder: boolean;
  signatureDate: string; // "2025-11-18"
  duration: string; // "30"
  phoneNumbers: JLDPhoneNumber[];
  tribunal: string; // "AMIENS"
  errors: string[];
  confidence: number; // 0-1
}

export class JLDOrderAnalyzer {
  
  /**
   * Analyse un fichier PDF pour détecter s'il s'agit d'une ordonnance JLD d'interception
   */
  static async analyze(file: File): Promise<JLDAnalysisResult> {
    const result: JLDAnalysisResult = {
      isJLDOrder: false,
      signatureDate: '',
      duration: '30',
      phoneNumbers: [],
      tribunal: '',
      errors: [],
      confidence: 0
    };

    try {
      // Lire le contenu du PDF via l'API Electron
      if (!window.electronAPI) {
        result.errors.push('API Electron non disponible');
        return result;
      }

      const pdfText = await this.extractPDFText(file);
      if (!pdfText) {
        result.errors.push('Impossible d\'extraire le texte du PDF');
        return result;
      }

      // Vérifier s'il s'agit d'une ordonnance JLD
      const isJLDOrder = this.detectJLDOrder(pdfText);
      if (!isJLDOrder) {
        result.confidence = 0;
        return result;
      }

      result.isJLDOrder = true;
      result.confidence = 0.5; // Base confidence

      // Extraire les données
      result.tribunal = this.extractTribunal(pdfText);
      result.signatureDate = this.extractSignatureDate(pdfText);
      result.duration = this.extractDuration(pdfText);
      result.phoneNumbers = this.extractPhoneNumbers(pdfText);

      // Calculer la confiance finale
      result.confidence = this.calculateConfidence(result);

      // Validation finale
      this.validateResult(result);

    } catch (error) {
      console.error('Erreur lors de l\'analyse JLD:', error);
      result.errors.push(`Erreur d'analyse: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
    }

    return result;
  }

  /**
   * Extrait le texte du PDF via l'API Electron (version propre)
   */
  private static async extractPDFText(file: File): Promise<string> {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = new Uint8Array(arrayBuffer);
      return await window.electronAPI.extractPDFText(buffer);
    } catch (error) {
      console.error('Erreur extraction PDF:', error);
      throw new Error('Impossible d\'extraire le texte du PDF');
    }
  }

  /**
   * Détecte si le document est une ordonnance JLD d'interception
   */
  private static detectJLDOrder(text: string): boolean {
    console.log('🔍 TEXTE FINAL ANALYSÉ (premiers 500 chars):', text.substring(0, 500));
    
    const indicators = [
      'PAR CES MOTIFS',
      'AUTORISONS pour une durée maximale',
      'l\'interception des correspondances',
      'lignes téléphoniques suivantes',
      'JUGE DES LIBERTES',
      'AUTORISATION D\'INTERCEPTION'
    ];

    let matchCount = 0;
    for (let i = 0; i < indicators.length; i++) {
      const indicator = indicators[i];
      const found = text.toUpperCase().includes(indicator.toUpperCase());
      console.log(`🔍 Pattern ${i + 1} (${indicator}):`, found ? '✅ TROUVÉ' : '❌ PAS TROUVÉ');
      if (found) {
        matchCount++;
      }
    }

    console.log('📊 TOTAL TROUVÉ:', matchCount, 'sur', indicators.length);
    console.log('📊 SEUIL REQUIS: 4, RÉSULTAT:', matchCount >= 4 ? '✅ VALIDÉ' : '❌ ÉCHEC');

    // Au moins 4 indicateurs sur 6 doivent être présents
    return matchCount >= 4;
  }

  /**
   * Extrait le nom du tribunal
   */
  private static extractTribunal(text: string): string {
    const tribunalMatch = text.match(/TRIBUNAL JUDICIAIRE D['\u0027]([A-Z\u00C0-\u00FF]+)/i);
    if (tribunalMatch) {
      return tribunalMatch[1].toUpperCase();
    }

    // Fallback - chercher dans la signature
    const signatureMatch = text.match(/Fait à ([A-Z\u00C0-\u00FF]+)/i);
    if (signatureMatch) {
      return signatureMatch[1].toUpperCase();
    }

    return 'AMIENS'; // Valeur par défaut
  }

  /**
   * Extrait la date de signature
   */
  private static extractSignatureDate(text: string): string {
    // Chercher "Fait à AMIENS, le XX novembre 2025"
    const dateMatch = text.match(/Fait à [A-Z\u00C0-\u00FF]+,?\s+le\s+(\d{1,2})\s+([a-zA-Z\u00C0-\u00FF]+)\s+(\d{4})/i);
    
    if (dateMatch) {
      const [, day, month, year] = dateMatch;
      const monthNumber = this.parseMonthName(month);
      if (monthNumber) {
        return `${year}-${monthNumber.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }
    }

    // Fallback - chercher d'autres formats de date
    const altDateMatch = text.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
    if (altDateMatch) {
      const [, day, month, year] = altDateMatch;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    // Date par défaut (aujourd'hui)
    return new Date().toISOString().split('T')[0];
  }

  /**
   * Convertit un nom de mois en numéro
   */
  private static parseMonthName(monthName: string): string | null {
    const months: Record<string, string> = {
      'janvier': '01', 'février': '02', 'mars': '03', 'avril': '04',
      'mai': '05', 'juin': '06', 'juillet': '07', 'août': '08',
      'septembre': '09', 'octobre': '10', 'novembre': '11', 'décembre': '12'
    };

    const normalized = monthName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return months[normalized] || null;
  }

  /**
   * Extrait la durée autorisée
   */
  private static extractDuration(text: string): string {
    // Chercher "durée maximale d'un mois"
    if (text.toLowerCase().includes('un mois') || text.toLowerCase().includes('1 mois')) {
      return '30';
    }

    // Chercher "XX jours"
    const daysMatch = text.match(/(\d+)\s+jours?/i);
    if (daysMatch) {
      return daysMatch[1];
    }

    // Chercher "XX semaines"
    const weeksMatch = text.match(/(\d+)\s+semaines?/i);
    if (weeksMatch) {
      return (parseInt(weeksMatch[1]) * 7).toString();
    }

    return '30'; // Défaut 1 mois
  }

  /**
   * Extrait les numéros de téléphone et leurs utilisateurs
   */
  private static extractPhoneNumbers(text: string): JLDPhoneNumber[] {
    const phoneNumbers: JLDPhoneNumber[] = [];

    // Chercher la section "PAR CES MOTIFS"
    const motifsSectionMatch = text.match(/PAR CES MOTIFS.*?(?=\n\n|\r\n\r\n|$)/s);
    if (!motifsSectionMatch) {
      return phoneNumbers;
    }

    const motifsSection = motifsSectionMatch[0];

    // Pattern pour extraire les lignes avec numéros
    // Ex: "N° 06.49.83.21.97 utilisé par Boujemaa ABKARI"
    const phonePattern = /N°?\s*(\d{2}\.?\d{2}\.?\d{2}\.?\d{2}\.?\d{2})\s*(utilisé par|susceptible d['\u0027]être utilisé par)\s+([A-Z\u00C0-\u00FF][a-zA-Z\u00C0-\u00FF\s\-']+[A-Z\u00C0-\u00FF])/gi;

    let match;
    while ((match = phonePattern.exec(motifsSection)) !== null) {
      const [, rawNumber, usageType, userName] = match;
      
      // Normaliser le numéro
      const normalizedNumber = this.normalizePhoneNumber(rawNumber);
      if (normalizedNumber) {
        const lastFourDigits = this.extractLastFourDigits(normalizedNumber);
        
        phoneNumbers.push({
          fullNumber: normalizedNumber,
          lastFourDigits,
          user: userName.trim(),
          usageType: usageType.trim()
        });
      }
    }

    return phoneNumbers;
  }

  /**
   * Normalise un numéro de téléphone au format XX.XX.XX.XX.XX
   */
  private static normalizePhoneNumber(rawNumber: string): string {
    // Supprimer tous les caractères non numériques
    const digits = rawNumber.replace(/\D/g, '');
    
    if (digits.length === 10) {
      return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}.${digits.slice(8, 10)}`;
    }
    
    return '';
  }

  /**
   * Extrait les 4 derniers chiffres d'un numéro (XX.XX format)
   */
  private static extractLastFourDigits(fullNumber: string): string {
    const digits = fullNumber.replace(/\D/g, '');
    if (digits.length >= 4) {
      const lastFour = digits.slice(-4);
      return `${lastFour.slice(0, 2)}.${lastFour.slice(2, 4)}`;
    }
    return fullNumber;
  }

  /**
   * Calcule la confiance de l'analyse
   */
  private static calculateConfidence(result: JLDAnalysisResult): number {
    let confidence = 0.5; // Base

    // +0.2 si on a trouvé le tribunal
    if (result.tribunal && result.tribunal !== 'AMIENS') {
      confidence += 0.2;
    }

    // +0.2 si on a trouvé une date valide
    if (result.signatureDate && result.signatureDate !== new Date().toISOString().split('T')[0]) {
      confidence += 0.2;
    }

    // +0.1 par numéro trouvé (max 0.5)
    confidence += Math.min(result.phoneNumbers.length * 0.1, 0.5);

    return Math.min(confidence, 1.0);
  }

  /**
   * Valide le résultat final
   */
  private static validateResult(result: JLDAnalysisResult): void {
    if (result.phoneNumbers.length === 0) {
      result.errors.push('Aucun numéro de téléphone détecté');
    }

    if (!result.signatureDate) {
      result.errors.push('Date de signature non trouvée');
    }

    // Vérifier les doublons de numéros
    const numbers = result.phoneNumbers.map(p => p.fullNumber);
    const duplicates = numbers.filter((num, index) => numbers.indexOf(num) !== index);
    if (duplicates.length > 0) {
      result.errors.push(`Numéros en double détectés: ${duplicates.join(', ')}`);
    }
  }
}