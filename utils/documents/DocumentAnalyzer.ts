// utils/documents/DocumentAnalyzer.ts
export interface DocumentAnalysisResult {
  fileName: string;
  enqueteId: number;
  category: 
    | 'nouvelle_ecoute' 
    | 'nouvelle_geolocalisation'
    | 'nouvelle_captation_images'
    | 'autre';
  confidence: number;
  extractedData: {
    // Données pour écoutes
    numeroTelephone?: string;
    cible?: string;
    titulaire?: string;
    
    // Données pour géolocalisation
    vehicule?: string;
    plaques?: string[];
    objet?: string;
    
    // Données communes
    dateDebut?: string;
    duree?: string;
    description?: string;
    
    // Métadonnées
    tribunal?: string;
    procureur?: string;
    dateDecision?: string;
  };
  suggestedAction: string;
  priority: 'high' | 'medium' | 'low';
  createdAt: string;
}

interface DocumentPattern {
  // Titre du document (partie haute)
  titlePatterns: RegExp[];
  
  // Patterns pour exclure les prolongations
  excludeProlongationPatterns: RegExp[];
  
  // Patterns du dispositif (partie décisive)
  dispositifPatterns: RegExp[];
  
  category: DocumentAnalysisResult['category'];
  priority: DocumentAnalysisResult['priority'];
  baseConfidence: number;
  
  // Extracteurs de données
  extractors: {
    [key: string]: {
      patterns: RegExp[];
      transformer?: (match: string) => string;
      required?: boolean;
    };
  };
}

export class DocumentAnalyzer {
  private static patterns: DocumentPattern[] = [
    // === NOUVELLE ÉCOUTE TÉLÉPHONIQUE ===
    {
      titlePatterns: [
        // Patterns optionnels, le dispositif prime
        /AUTORISATION.*INTERCEPTION.*CORRESPONDANCES\s+TELEPHONIQUES/i,
        /DECISION.*INTERCEPTION.*CORRESPONDANCES\s+TELEPHONIQUES/i,
        /./  // Pattern fourre-tout si besoin
      ],
      excludeProlongationPatterns: [
        /prolongation.*interception/i,
        /renouvellement.*interception/i,
        /poursuite.*interception/i
      ],
      dispositifPatterns: [
        /(?:PAR\s+CES\s+MOTIFS|Par\s+conséquent|AUTORISONS).*interception.*lignes.*téléphoniques/i,
        /(?:PAR\s+CES\s+MOTIFS|Par\s+conséquent|AUTORISONS).*durée.*mois.*interception/i
      ],
      category: 'nouvelle_ecoute',
      priority: 'high',
      baseConfidence: 0.90,
      extractors: {
        numeroTelephone: {
          patterns: [
            // Dans le dispositif après "lignes téléphoniques"
            /lignes\s+téléphoniques[^:]*:\s*[^0-9]*(\d{2}\.?\d{2}\.?\d{2}\.?\d{2}\.?\d{2})/gi,
            /N°\s*(\d{2}\.?\d{2}\.?\d{2}\.?\d{2}\.?\d{2})/gi,
            // Patterns pour JLD
            /N°\s+(\d{2}\.\d{2}\.\d{2}\.\d{2}\.\d{2})/gi,
            // Format sans points
            /(\d{10})/g
          ],
          transformer: (match) => {
            const cleaned = match.replace(/\D/g, '');
            if (cleaned.length === 10) {
              return cleaned.replace(/(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1.$2.$3.$4.$5');
            }
            return cleaned;
          },
          required: true
        },
        titulaire: {
          patterns: [
            /inscrite?\s+au\s+nom\s+de\s+([A-Z][A-Z\s]+?)(?:,|\s*\n)/gi,
            /nom\s+de\s+([A-Z][A-Z\s]+?)(?:,|\s*\n)/gi
          ]
        },
        cible: {
          patterns: [
            /utilisée?\s+par\s+([A-Z][A-Z\s]+?)(?:,|\s*\n)/gi,
            /réputée?\s+utilisée?\s+par\s+([A-Z][A-Z\s]+?)(?:,|\s*\n)/gi
          ]
        },
        duree: {
          patterns: [
            /durée\s+maximale\s+d[''']un\s+mois/gi,
            /durée\s+maximale\s+de\s+(\d+)\s+(?:jour|mois)/gi
          ],
          transformer: (match) => {
            if (match.toLowerCase().includes('mois')) return '30';
            const num = match.match(/\d+/);
            return num ? num[0] : '30';
          }
        }
      }
    },

    // === NOUVELLE GÉOLOCALISATION ===
    {
      titlePatterns: [
        /AUTORISATION.*GEOLOCALISATION/i,
        /ARTICLE\s+230-33/i,
        /./  // Pattern fourre-tout
      ],
      excludeProlongationPatterns: [
        /prolongation.*geolocalisation/i,
        /poursuite.*mesure.*geolocalisation/i,
        /renouvellement.*geolocalisation/i
      ],
      dispositifPatterns: [
        /(?:PAR\s+CES\s+MOTIFS|Par\s+conséquent|AUTORISONS).*geolocalisation.*temps.*reel/i,
        /(?:PAR\s+CES\s+MOTIFS|Par\s+conséquent|AUTORISONS).*duree.*jours.*geolocalisation/i
      ],
      category: 'nouvelle_geolocalisation',
      priority: 'high',
      baseConfidence: 0.95,
      extractors: {
        vehicule: {
          patterns: [
            // Dans le dispositif ou description
            /geolocalisation.*objets?\s+suivants?\s*:.*?([A-Z]+\s+[A-Z0-9\s]+(?:serie|série)\s+\d+)/gi,
            /(BMW\s+série\s+\d+)/gi,
            /véhicule\s+([A-Z]+\s+[A-Z0-9\s]+)/gi
          ],
          required: true
        },
        plaques: {
          patterns: [
            /immatriculé\s+([A-Z]{2}-\d{3}-[A-Z]{2})/gi,
            /([A-Z]{2}-\d{3}-[A-Z]{2})/gi,
            /porteur.*immatriculation[^:]*([A-Z]{2}-\d{3}-[A-Z]{2})/gi
          ]
        },
        objet: {
          patterns: [
            // Construire l'objet à partir du véhicule et des plaques
            /geolocalisation.*objets?\s+suivants?\s*:\s*([^\.]+)/gi
          ]
        },
        duree: {
          patterns: [
            /durée\s+de\s+(\d+)\s+jours?/gi,
            /(\d+)\s+jours?.*compter/gi
          ],
          transformer: (match) => match.replace(/\D/g, '')
        }
      }
    },

    // === NOUVELLE CAPTATION D'IMAGES ===
    {
      titlePatterns: [
        /AUTORISATION.*DISPOSITIF.*CAPTATION\s+D[''']IMAGES/i,
        /CAPTATION\s+D[''']IMAGES/i,
        /ENREGISTREMENT\s+VIDEO/i
      ],
      excludeProlongationPatterns: [
        /prolongation/i,
        /poursuite.*captation/i,
        /renouvellement/i
      ],
      dispositifPatterns: [
        /AUTORISONS.*captation.*images/i,
        /AUTORISONS.*dispositif.*video/i
      ],
      category: 'nouvelle_captation_images',
      priority: 'medium',
      baseConfidence: 0.85,
      extractors: {
        objet: {
          patterns: [
            /captation.*images.*(?:sur|à|hauteur).*?([^,\.]+)/gi,
            /dispositif.*captation.*à\s+([^,\.]+)/gi
          ],
          required: true
        },
        duree: {
          patterns: [
            /durée\s+maximale.*?(\w+\s+\w+)/gi,
            /FIXONS\s+à\s+(\w+\s+\w+)/gi,
            /(\d+)\s+jours?/gi
          ]
        }
      }
    }
  ];

  /**
   * Analyse un document en se concentrant sur titre + dispositif
   */
  static async analyzeDocument(
    fileName: string,
    enqueteId: number
  ): Promise<DocumentAnalysisResult | null> {
    try {
      const textContent = await window.electronAPI?.extractPdfText?.(fileName);
      
      if (!textContent) {
        console.warn('Impossible d\'extraire le texte du PDF');
        return null;
      }

      // 1. Détecter la catégorie
      const detectedPattern = this.detectCategory(textContent);
      
      if (!detectedPattern) {
        return {
          fileName,
          enqueteId,
          category: 'autre',
          confidence: 0,
          extractedData: {},
          suggestedAction: 'Document non reconnu comme nouvel acte d\'enquête',
          priority: 'low',
          createdAt: new Date().toISOString()
        };
      }

      // 2. Extraire les données du dispositif
      const extractedData = this.extractFromDispositif(textContent, detectedPattern);
      
      // 3. Extraire la date de décision
      extractedData.dateDecision = this.extractDecisionDate(textContent);

      // 4. Calculer la confiance
      const confidence = this.calculateConfidence(detectedPattern, extractedData);

      return {
        fileName,
        enqueteId,
        category: detectedPattern.category,
        confidence,
        extractedData,
        suggestedAction: this.getSuggestedAction(detectedPattern.category),
        priority: detectedPattern.priority,
        createdAt: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('Erreur lors de l\'analyse du document:', error);
      return null;
    }
  }

  private static detectCategory(text: string): DocumentPattern | null {
    for (const pattern of this.patterns) {
      // 1. Le dispositif est OBLIGATOIRE
      const dispositifMatch = pattern.dispositifPatterns.some(regex => 
        regex.test(text)
      );
      if (!dispositifMatch) continue;

      // 2. Exclure les prolongations
      const isProlongation = pattern.excludeProlongationPatterns.some(regex => 
        regex.test(text)
      );
      if (isProlongation) continue;

      return pattern;
    }
    return null;
  }

  private static extractFromDispositif(text: string, pattern: DocumentPattern): any {
    const extractedData: any = {};

    // Isoler la partie dispositif
    const dispositifParts = [
      /Par\s+conséquent.*$/gims,
      /PAR\s+CES\s+MOTIFS.*$/gims,
      /AUTORISONS.*$/gims
    ];

    let dispositifText = text;
    for (const part of dispositifParts) {
      const match = text.match(part);
      if (match) {
        dispositifText = match[0];
        break;
      }
    }

    // Extraire selon les patterns
    for (const [field, extractor] of Object.entries(pattern.extractors)) {
      for (const regex of extractor.patterns) {
        const matches = dispositifText.match(regex);
        if (matches) {
          let value = matches[1] || matches[0];
          
          if (extractor.transformer) {
            value = extractor.transformer(value);
          }

          value = value.trim().replace(/\s+/g, ' ');

          if (field === 'plaques') {
            const allMatches = [...dispositifText.matchAll(new RegExp(regex.source, regex.flags))];
            extractedData[field] = allMatches.map(match => 
              extractor.transformer ? extractor.transformer(match[1] || match[0]) : match[1] || match[0]
            );
          } else {
            extractedData[field] = value;
          }
          break;
        }
      }
    }

    // Construction de l'objet géolocalisé si nécessaire
    if (pattern.category === 'nouvelle_geolocalisation' && !extractedData.objet) {
      const parts = [];
      if (extractedData.vehicule) parts.push(extractedData.vehicule);
      if (extractedData.plaques && extractedData.plaques.length > 0) {
        parts.push(`- ${extractedData.plaques.join(', ')}`);
      }
      extractedData.objet = parts.join(' ') || 'Véhicule à identifier';
    }

    return extractedData;
  }

  private static extractDecisionDate(text: string): string | undefined {
    const datePatterns = [
      /Fait\s+(?:au\s+parquet,?\s+)?le\s+(\d{1,2}\s+\w+\s+\d{4})/gi,
      /Fait\s+à\s+\w+,?\s+le\s+(\d{1,2}\s+\w+\s+\d{4})/gi,
      /(\d{1,2}\s+\w+\s+\d{4})\s*$(?:(?!\w))/gim // Fin de document
    ];

    for (const pattern of datePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return this.formatDate(match[1]);
      }
    }
    return undefined;
  }

  private static formatDate(dateStr: string): string {
    if (!dateStr) return '';
    
    const monthNames = {
      'janvier': '01', 'février': '02', 'mars': '03', 'avril': '04',
      'mai': '05', 'juin': '06', 'juillet': '07', 'août': '08',
      'septembre': '09', 'octobre': '10', 'novembre': '11', 'décembre': '12'
    };

    const match = dateStr.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
    if (match) {
      const day = match[1].padStart(2, '0');
      const month = monthNames[match[2].toLowerCase() as keyof typeof monthNames] || '01';
      const year = match[3];
      return `${year}-${month}-${day}`;
    }
    return dateStr;
  }

  private static calculateConfidence(pattern: DocumentPattern, extractedData: any): number {
    let confidence = pattern.baseConfidence;

    // Réduire si champs requis manquants
    const requiredFields = Object.entries(pattern.extractors)
      .filter(([, extractor]) => extractor.required)
      .map(([field]) => field);

    const foundRequired = requiredFields.filter(field => 
      extractedData[field] && extractedData[field] !== ''
    ).length;

    if (requiredFields.length > 0) {
      confidence *= (0.6 + (foundRequired / requiredFields.length) * 0.4);
    }

    return Math.min(confidence, 0.98);
  }

  private static getSuggestedAction(category: DocumentAnalysisResult['category']): string {
    const actions = {
      'nouvelle_ecoute': 'Créer une nouvelle écoute téléphonique',
      'nouvelle_geolocalisation': 'Créer une nouvelle géolocalisation',
      'nouvelle_captation_images': 'Créer une nouvelle captation d\'images',
      'autre': 'Analyser manuellement le document'
    };
    return actions[category] || 'Action non déterminée';
  }
}