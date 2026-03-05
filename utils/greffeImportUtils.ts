// utils/greffeImportUtils.ts - Version corrigée pour enrichissement AIR
import { AIRImportData } from '@/types/interfaces';

export interface GreffeData {
  numeroParquet: string;
  nomPrenom: string;
  dateConvocation?: string;
  faits?: string;
  origine?: string;
}

export interface GreffeValidationResult {
  isValid: boolean;
  confidence: 'high' | 'medium' | 'low';
  message: string;
  foundHeaders: boolean;
  dataRowsCount: number;
  headerRowIndex?: number;
}

export interface GreffeMappingResult {
  mapping: Record<string, number>;
  confidence: 'high' | 'medium' | 'low';
  method: 'fixed' | 'dynamic';
  foundFields: string[];
  missingFields: string[];
}

export interface ComparisonMatch {
  greffe: GreffeData;
  air: AIRImportData;
  similarity: number;
  confidence: 'exact' | 'high' | 'medium' | 'low';
  matchType: 'nom';
}

export interface ComparisonResult {
  // Mesures AIR enrichies avec numéro de parquet
  enrichedAir: (AIRImportData & { numeroParquet: string })[];
  // Correspondances probables à valider manuellement
  probables: ComparisonMatch[];
  // Nouvelles mesures du greffe à ajouter à votre liste AIR
  newFromGreffe: GreffeData[];
  // Mesures AIR sans correspondance dans le greffe
  airWithoutParquet: AIRImportData[];
  stats: {
    totalGreffe: number;
    totalAir: number;
    enriched: number;
    probables: number;
    newFromGreffe: number;
    airWithoutParquet: number;
  };
}

export const FIXED_GREFFE_COLUMN_MAPPINGS = {
  numeroParquet: 0,
  nomPrenom: 1,
  dateConvocation: 6,
  faits: 7,
  origine: 3
} as const;

export const GREFFE_FIELD_KEYWORDS = {
  numeroParquet: ['numéro', 'numero', 'parquet', 'dossier', 'jan-', 'fev-', 'mar-'],
  nomPrenom: ['nom', 'prénom', 'prenom', 'concernant', 'mis en cause'],
  dateConvocation: ['convocation', 'date', 'première', 'premiere', 'rdv'],
  faits: ['faits', 'fait', 'infraction', 'nature'],
  origine: ['origine', 'orientation', 'provenance']
} as const;

/**
 * Normalise un numéro de parquet
 */
export const normalizeNumeroParquet = (numero: string): string => {
  if (!numero) return '';
  
  let normalized = String(numero).trim().toUpperCase();
  
  // Ignorer les en-têtes et valeurs invalides
  const invalidPatterns = [
    'JAN-', 'FEV-', 'MAR-', 'AVR-', 'MAI-', 'JUN-',
    'JUL-', 'AOU-', 'SEP-', 'OCT-', 'NOV-', 'DEC-',
    'NUMERO', 'PARQUET', 'DOSSIER'
  ];
  
  for (const pattern of invalidPatterns) {
    if (normalized.includes(pattern)) {
      return '';
    }
  }
  
  // Remplacer les points par des tirets pour normaliser
  normalized = normalized.replace(/\./g, '-');
  
  // Vérifier format minimal (au moins 8 caractères pour un numéro valide)
  if (normalized.length < 8) {
    return '';
  }
  
  return normalized;
};

/**
 * Normalise un nom pour la comparaison
 */
export const normalizeNom = (nom: string): string => {
  if (!nom) return '';
  
  // Enlever contenu entre parenthèses
  const nomSansParentheses = nom.split('(')[0].trim();
  
  return nomSansParentheses
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Supprimer les accents
    .replace(/[-\s]+/g, ' ') // Normaliser les espaces et tirets
    .replace(/[^\w\s]/g, ' ') // Supprimer la ponctuation
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Distance de Levenshtein pour mesurer la similarité
 */
const levenshteinDistance = (str1: string, str2: string): number => {
  if (str1 === str2) return 0;
  if (str1.length === 0) return str2.length;
  if (str2.length === 0) return str1.length;
  
  const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(0));
  
  for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
  
  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      if (str1[i - 1] === str2[j - 1]) {
        matrix[j][i] = matrix[j - 1][i - 1];
      } else {
        matrix[j][i] = Math.min(
          matrix[j - 1][i - 1] + 1,
          matrix[j][i - 1] + 1,
          matrix[j - 1][i] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
};

/**
 * Calcule la similarité entre deux noms - VERSION AMÉLIORÉE pour les fautes de frappe
 */
export const calculateSimilarity = (nom1: string, nom2: string): number => {
  if (!nom1 || !nom2) return 0;
  
  const normalized1 = normalizeNom(nom1);
  const normalized2 = normalizeNom(nom2);
  
  console.log(`[SIMILARITY] "${nom1}" -> "${normalized1}"`);
  console.log(`[SIMILARITY] "${nom2}" -> "${normalized2}"`);
  
  // 1. Correspondance exacte après normalisation
  if (normalized1 === normalized2) {
    console.log(`[SIMILARITY] Exact match: 1.0`);
    return 1.0;
  }
  
  // 2. Un nom contient complètement l'autre
  if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) {
    console.log(`[SIMILARITY] Inclusion complete: 0.95`);
    return 0.95;
  }
  
  // 3. Comparer les mots individuels (prénoms/noms séparés)
  const mots1 = normalized1.split(' ').filter(m => m.length > 1);
  const mots2 = normalized2.split(' ').filter(m => m.length > 1);
  
  if (mots1.length === 0 || mots2.length === 0) return 0;
  
  // Calculer l'intersection des mots (coefficient de Jaccard)
  const set1 = new Set(mots1);
  const set2 = new Set(mots2);
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  if (intersection.size > 0) {
    const jaccard = intersection.size / union.size;
    console.log(`[SIMILARITY] Jaccard: ${jaccard.toFixed(3)} (${intersection.size}/${union.size} mots communs)`);
    
    // Bonus si tous les mots d'un côté sont inclus dans l'autre
    const inclusion1 = mots1.every(mot => set2.has(mot));
    const inclusion2 = mots2.every(mot => set1.has(mot));
    
    if (inclusion1 || inclusion2) {
      const result = Math.min(0.92, jaccard + 0.2);
      console.log(`[SIMILARITY] Inclusion totale bonus: ${result.toFixed(3)}`);
      return result;
    }
    
    // 🆕 BONUS SPÉCIAL : Si on a au moins un mot identique et que l'autre mot est très similaire
    if (intersection.size >= 1 && mots1.length === 2 && mots2.length === 2) {
      const [mot1_1, mot1_2] = mots1;
      const [mot2_1, mot2_2] = mots2;
      
      // Vérifier les combinaisons de mots similaires
      const sim1 = Math.max(
        calculateWordSimilarity(mot1_1, mot2_1) + calculateWordSimilarity(mot1_2, mot2_2),
        calculateWordSimilarity(mot1_1, mot2_2) + calculateWordSimilarity(mot1_2, mot2_1)
      ) / 2;
      
      if (sim1 > 0.8) {
        console.log(`[SIMILARITY] Mots similaires bonus: ${Math.min(0.90, sim1)}`);
        return Math.min(0.90, sim1);
      }
    }
    
    return jaccard;
  }
  
  // 4. Distance de Levenshtein pour les fautes de frappe
  const maxLen = Math.max(normalized1.length, normalized2.length);
  if (maxLen < 4) return 0; // Noms trop courts, pas fiable
  
  const distance = levenshteinDistance(normalized1, normalized2);
  const similarity = 1 - (distance / maxLen);
  
  console.log(`[SIMILARITY] Levenshtein: ${similarity.toFixed(3)} (distance: ${distance}/${maxLen})`);
  
  // 🆕 Seuil abaissé pour capturer plus de fautes de frappe
  return similarity > 0.65 ? similarity : 0;
};

/**
 * 🆕 Calcule la similarité entre deux mots individuels
 */
const calculateWordSimilarity = (word1: string, word2: string): number => {
  if (word1 === word2) return 1.0;
  if (word1.includes(word2) || word2.includes(word1)) return 0.9;
  
  const maxLen = Math.max(word1.length, word2.length);
  if (maxLen < 3) return word1 === word2 ? 1 : 0;
  
  const distance = levenshteinDistance(word1, word2);
  return 1 - (distance / maxLen);
};

/**
 * Formate une date
 */
export const formatDateIfNeeded = (value: any): string => {
  if (!value) return '';
  
  const str = String(value).trim();
  if (!str || str === 'null' || str === 'undefined') return '';
  
  // Format JJ/MM/AA -> JJ/MM/AAAA
  if (/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(str)) {
    const [day, month, year] = str.split('/');
    return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/20${year}`;
  }
  
  // Format JJ/MM/AAAA -> normaliser
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
    const parts = str.split('/');
    return `${parts[0].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[2]}`;
  }
  
  return str;
};

/**
 * Validation de la structure du fichier greffe
 */
export const validateGreffeStructure = (jsonData: any[][]): GreffeValidationResult => {
  if (!jsonData || jsonData.length === 0) {
    return {
      isValid: false,
      confidence: 'high',
      message: 'Fichier vide ou illisible',
      foundHeaders: false,
      dataRowsCount: 0
    };
  }

  const maxColumns = Math.max(...jsonData.map(row => row?.length || 0));
  if (maxColumns < 7) {
    return {
      isValid: false,
      confidence: 'high',
      message: `Trop peu de colonnes (${maxColumns} trouvées, 7 minimum)`,
      foundHeaders: false,
      dataRowsCount: 0
    };
  }

  // Recherche des en-têtes
  let headerRowIndex = -1;
  let foundHeaders = false;

  for (let i = 0; i < Math.min(10, jsonData.length); i++) {
    const row = jsonData[i];
    if (!row) continue;

    const hasMonthHeaders = row.some(cell => {
      if (!cell) return false;
      const cellStr = String(cell).toLowerCase();
      return cellStr.includes('jan-') || cellStr.includes('numero') || 
             cellStr.includes('nom') || cellStr.includes('parquet');
    });

    if (hasMonthHeaders) {
      headerRowIndex = i;
      foundHeaders = true;
      break;
    }
  }

  // Compter les lignes de données valides
  const dataStartIndex = headerRowIndex >= 0 ? headerRowIndex + 1 : 1;
  let dataRowsCount = 0;
  
  for (let i = dataStartIndex; i < jsonData.length; i++) {
    const row = jsonData[i];
    if (row && row[0] && row[1]) {
      const numeroParquet = normalizeNumeroParquet(row[0]);
      const nomPrenom = String(row[1]).trim();
      
      if (numeroParquet && nomPrenom) {
        dataRowsCount++;
      }
    }
  }

  let isValid = dataRowsCount > 0;
  let confidence: 'high' | 'medium' | 'low' = 'high';
  let message = 'Fichier greffe valide';

  if (!foundHeaders) {
    confidence = 'medium';
    message = 'En-têtes non détectés, structure supposée';
  }

  if (dataRowsCount < 5) {
    confidence = 'low';
    message = `Peu de données trouvées (${dataRowsCount} lignes)`;
  }

  if (dataRowsCount === 0) {
    isValid = false;
    message = 'Aucune donnée valide trouvée';
  }

  return {
    isValid,
    confidence,
    message,
    foundHeaders,
    dataRowsCount,
    headerRowIndex: headerRowIndex >= 0 ? headerRowIndex : undefined
  };
};

/**
 * Essaie le mapping fixe
 */
export const tryFixedGreffeMapping = (jsonData: any[][], headerRowIndex: number = 0): GreffeMappingResult => {
  const dataStartIndex = headerRowIndex + 1;
  const testRows = jsonData.slice(dataStartIndex, dataStartIndex + Math.min(10, jsonData.length - dataStartIndex));
  
  let foundFields: string[] = [];
  let missingFields: string[] = [];

  for (const [fieldName, colIndex] of Object.entries(FIXED_GREFFE_COLUMN_MAPPINGS)) {
    let hasValidData = false;
    
    for (const row of testRows) {
      if (row && row[colIndex]) {
        if (fieldName === 'numeroParquet') {
          const normalized = normalizeNumeroParquet(row[colIndex]);
          if (normalized) {
            hasValidData = true;
            break;
          }
        } else if (fieldName === 'nomPrenom') {
          const nom = String(row[colIndex]).trim();
          if (nom && nom.length > 2) {
            hasValidData = true;
            break;
          }
        } else {
          const value = String(row[colIndex]).trim();
          if (value) {
            hasValidData = true;
            break;
          }
        }
      }
    }

    if (hasValidData) {
      foundFields.push(fieldName);
    } else {
      missingFields.push(fieldName);
    }
  }

  const successRate = foundFields.length / Object.keys(FIXED_GREFFE_COLUMN_MAPPINGS).length;
  
  return {
    mapping: FIXED_GREFFE_COLUMN_MAPPINGS,
    confidence: successRate >= 0.6 ? (successRate > 0.8 ? 'high' : 'medium') : 'low',
    method: 'fixed',
    foundFields,
    missingFields
  };
};

/**
 * Crée un mapping dynamique basé sur les en-têtes
 */
export const createDynamicGreffeMapping = (jsonData: any[][], headerRowIndex: number): GreffeMappingResult => {
  const headerRow = jsonData[headerRowIndex];
  if (!headerRow) {
    return {
      mapping: {},
      confidence: 'low',
      method: 'dynamic',
      foundFields: [],
      missingFields: Object.keys(GREFFE_FIELD_KEYWORDS)
    };
  }

  const dynamicMapping: Record<string, number> = {};
  const foundFields: string[] = [];
  const missingFields: string[] = [];

  for (const [fieldName, keywords] of Object.entries(GREFFE_FIELD_KEYWORDS)) {
    let bestMatch = -1;
    let bestScore = 0;

    for (let colIndex = 0; colIndex < headerRow.length; colIndex++) {
      const header = headerRow[colIndex];
      if (!header) continue;

      const headerStr = String(header).toLowerCase();
      let score = 0;

      for (const keyword of keywords) {
        if (headerStr.includes(keyword.toLowerCase())) {
          score += keyword.length;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = colIndex;
      }
    }

    if (bestMatch >= 0 && bestScore > 0) {
      dynamicMapping[fieldName] = bestMatch;
      foundFields.push(fieldName);
    } else {
      missingFields.push(fieldName);
    }
  }

  const essentialFields = ['numeroParquet', 'nomPrenom'];
  const essentialFound = essentialFields.filter(field => foundFields.includes(field)).length;
  const essentialRate = essentialFound / essentialFields.length;
  
  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (essentialRate >= 1.0) confidence = 'high';
  else if (essentialRate >= 0.5) confidence = 'medium';

  return {
    mapping: dynamicMapping,
    confidence,
    method: 'dynamic',
    foundFields,
    missingFields
  };
};

/**
 * Obtient le meilleur mapping possible
 */
export const getBestGreffeMapping = (jsonData: any[][]): { 
  mappingResult: GreffeMappingResult; 
  validation: GreffeValidationResult 
} => {
  const validation = validateGreffeStructure(jsonData);
  
  if (!validation.isValid) {
    return {
      mappingResult: {
        mapping: {},
        confidence: 'low',
        method: 'fixed',
        foundFields: [],
        missingFields: Object.keys(GREFFE_FIELD_KEYWORDS)
      },
      validation
    };
  }

  const headerRowIndex = validation.headerRowIndex ?? 0;
  const fixedResult = tryFixedGreffeMapping(jsonData, headerRowIndex);
  
  if (fixedResult.confidence !== 'low') {
    return { mappingResult: fixedResult, validation };
  }

  const dynamicResult = createDynamicGreffeMapping(jsonData, headerRowIndex);
  return { mappingResult: dynamicResult, validation };
};

/**
 * Parse une ligne de données avec le mapping donné
 */
export const parseGreffeDataRowWithMapping = (
  row: any[], 
  rowIndex: number, 
  mapping: Record<string, number>
): GreffeData | null => {
  if (!row || row.length < 2) return null;
  
  const numeroParquet = mapping.numeroParquet !== undefined ? 
    normalizeNumeroParquet(row[mapping.numeroParquet]) : '';
  const nomPrenom = mapping.nomPrenom !== undefined ? 
    String(row[mapping.nomPrenom] || '').trim() : '';
  
  if (!numeroParquet || !nomPrenom) {
    return null;
  }

  const dateConvocation = mapping.dateConvocation !== undefined ? 
    formatDateIfNeeded(row[mapping.dateConvocation]) : undefined;
  
  const faits = mapping.faits !== undefined ? 
    String(row[mapping.faits] || '').trim() || undefined : undefined;
  
  const origine = mapping.origine !== undefined ? 
    String(row[mapping.origine] || '').trim() || undefined : undefined;

  return {
    numeroParquet,
    nomPrenom,
    dateConvocation,
    faits,
    origine
  };
};

/**
 * Parse toutes les données du greffe avec validation et mapping
 */
export const parseGreffeDataImproved = (
  jsonData: any[][]
): { 
  data: GreffeData[], 
  errors: string[], 
  validation: GreffeValidationResult,
  mappingResult: GreffeMappingResult 
} => {
  const errors: string[] = [];
  const data: GreffeData[] = [];
  
  const { mappingResult, validation } = getBestGreffeMapping(jsonData);
  
  if (!validation.isValid) {
    errors.push(validation.message);
    return { data, errors, validation, mappingResult };
  }

  const headerRowIndex = validation.headerRowIndex ?? 0;
  const startRowIndex = headerRowIndex + 1;
  
  for (let i = startRowIndex; i < jsonData.length; i++) {
    const row = jsonData[i];
    
    if (!row || row.every(cell => !cell || String(cell).trim() === '')) {
      continue;
    }
    
    try {
      const greffeData = parseGreffeDataRowWithMapping(row, i, mappingResult.mapping);
      
      if (greffeData) {
        data.push(greffeData);
      }
      
    } catch (error) {
      const errorMsg = `Erreur ligne ${i + 1}: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
      errors.push(errorMsg);
    }
  }
  
  if (data.length === 0 && errors.length === 0) {
    errors.push('Aucune donnée valide trouvée. Vérifiez le format du fichier.');
  }
  
  return { data, errors, validation, mappingResult };
};

/**
 * FONCTION PRINCIPALE : Compare AIR avec Greffe pour enrichissement
 * C'EST ICI QUE TOUT SE JOUE !
 */
export const compareAirWithGreffe = (
  airData: AIRImportData[], 
  greffeData: GreffeData[]
): ComparisonResult => {
  console.log(`[ENRICHISSEMENT] Début: ${airData.length} mesures AIR vs ${greffeData.length} mesures Greffe`);
  
  const enrichedAir: (AIRImportData & { numeroParquet: string })[] = [];
  const probables: ComparisonMatch[] = [];
  const usedGreffeIndices = new Set<number>();
  const usedAirIndices = new Set<number>();
  
  // ÉTAPE UNIQUE : Comparaison par noms seulement
  console.log(`[ENRICHISSEMENT] === Recherche par noms ===`);
  
  airData.forEach((air, airIndex) => {
    let bestMatch: {
      greffe: GreffeData;
      similarity: number;
      greffeIndex: number;
    } | null = null;
    
    // Trouver la meilleure correspondance dans le greffe
    greffeData.forEach((greffe, greffeIndex) => {
      if (usedGreffeIndices.has(greffeIndex)) return;
      
      const similarity = calculateSimilarity(air.nomPrenom, greffe.nomPrenom);
      
      if (similarity > 0.3 && (!bestMatch || similarity > bestMatch.similarity)) {
        bestMatch = { greffe, similarity, greffeIndex };
      }
    });
    
    if (bestMatch) {
      console.log(`[MATCH] ${air.nomPrenom} ↔ ${bestMatch.greffe.nomPrenom} (${bestMatch.similarity.toFixed(3)})`);
      
      const match: ComparisonMatch = {
        greffe: bestMatch.greffe,
        air,
        similarity: bestMatch.similarity,
        confidence: bestMatch.similarity >= 0.9 ? 'exact' :
                   bestMatch.similarity >= 0.8 ? 'high' :
                   bestMatch.similarity >= 0.6 ? 'medium' : 'low',
        matchType: 'nom'
      };
      
      // Seuils : garder strict pour auto, élargir pour validation manuelle
      if (bestMatch.similarity >= 0.85) {
        // ENRICHISSEMENT AUTOMATIQUE : Ajout du numéro de parquet (seuil strict conservé)
        console.log(`[ENRICHI] ${air.nomPrenom} reçoit le n° ${bestMatch.greffe.numeroParquet} (${bestMatch.similarity.toFixed(3)})`);
        enrichedAir.push({
          ...air,
          numeroParquet: bestMatch.greffe.numeroParquet
        });
        usedGreffeIndices.add(bestMatch.greffeIndex);
        usedAirIndices.add(airIndex);
        console.log(`[DEBUG] AIR index ${airIndex} marqué comme utilisé`);
      } else if (bestMatch.similarity >= 0.4) {
        // CORRESPONDANCE PROBABLE : À valider manuellement (seuil élargi)
        console.log(`[PROBABLE] ${air.nomPrenom} ↔ ${bestMatch.greffe.nomPrenom} à vérifier (${bestMatch.similarity.toFixed(3)})`);
        probables.push(match);
        // ⚠️ IMPORTANT : Ne pas marquer comme utilisé pour les probables car pas encore validé
      }
    } else {
      console.log(`[NO MATCH] ${air.nomPrenom} - aucune correspondance trouvée`);
    }
  });
  
  // Mesures du greffe non utilisées = nouvelles mesures à ajouter
  const newFromGreffe = greffeData.filter((_, index) => !usedGreffeIndices.has(index));
  
  // ✅ CORRECTION CRITIQUE : Mesures AIR sans correspondance = pas de numéro de parquet disponible
  const airWithoutParquet = airData.filter((_, index) => {
    const isUsed = usedAirIndices.has(index);
    console.log(`[DEBUG] AIR index ${index} (${airData[index].nomPrenom}): utilisé = ${isUsed}`);
    return !isUsed;
  });
  
  console.log(`[RÉSULTATS]`);
  console.log(`- Enrichies automatiquement: ${enrichedAir.length}`);
  console.log(`- À vérifier manuellement: ${probables.length}`);
  console.log(`- Nouvelles du greffe: ${newFromGreffe.length}`);
  console.log(`- AIR non trouvées: ${airWithoutParquet.length}`);
  console.log(`- Indices AIR utilisés: [${Array.from(usedAirIndices).join(', ')}]`);
  
  // ✅ VÉRIFICATION DE COHÉRENCE
  const totalAirTraitees = enrichedAir.length + airWithoutParquet.length + probables.length;
  if (totalAirTraitees !== airData.length) {
    console.error(`[ERREUR COHÉRENCE] ${totalAirTraitees} traitées vs ${airData.length} total`);
  }
  
  return {
    enrichedAir,
    probables,
    newFromGreffe,
    airWithoutParquet,
    stats: {
      totalGreffe: greffeData.length,
      totalAir: airData.length,
      enriched: enrichedAir.length,
      probables: probables.length,
      newFromGreffe: newFromGreffe.length,
      airWithoutParquet: airWithoutParquet.length
    }
  };
};

/**
 * Crée des mesures AIR à partir des données greffe (pour les nouvelles mesures)
 */
export const createMesuresFromGreffe = (greffeData: GreffeData[]): Omit<AIRImportData, 'refAEM'>[] => {
  return greffeData.map(greffe => ({
    numeroParquet: greffe.numeroParquet,
    dateReception: greffe.dateConvocation || new Date().toLocaleDateString('fr-FR'),
    faits: greffe.faits || '',
    origine: greffe.origine || '',
    nomPrenom: greffe.nomPrenom,
    referent: '',
    nombreEntretiensAIR: 0,
    nombreRencontresPR: 0,
    nombreCarences: 0,
    dureeEnMois: 0,
    statut: 'en_cours' as const,
    sourceGreffe: true
  }));
};

// Fonction de compatibilité
export const parseGreffeData = (jsonData: any[][]): GreffeData[] => {
  const result = parseGreffeDataImproved(jsonData);
  return result.data;
};