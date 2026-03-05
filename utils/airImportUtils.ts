// utils/airImportUtils.ts - Version simplifiée avec gestion des dates robuste

import { AIRImportData, AIRStatus } from '@/types/interfaces';

// 🎯 CONFIGURATION CENTRALISÉE
export const AIR_IMPORT_CONFIG = {
  HEADER_ROW_INDEX: 2,              // Ligne 3 (index 2)
  DATA_START_ROW_INDEX: 4,          // Ligne 5 (index 4)
  MIN_REQUIRED_COLUMNS: 10,
  MIN_DATA_ROWS: 1,
  REQUIRED_FIELDS_THRESHOLD: 0.5,   // 50% des champs obligatoires doivent être trouvés
  
  // Champs essentiels pour validation
  ESSENTIAL_FIELDS: ['refAEM', 'nomPrenom', 'dateReception']
} as const;

// 📋 MAPPING FIXE
export const FIXED_AIR_COLUMN_MAPPINGS = {
  refAEM: 1,                        // Colonne B
  dateReception: 2,                 // Colonne C
  origine: 3,                       // Colonne D
  magistrat: 4,                     // Colonne E
  dprEnCharge: 5,                   // Colonne F
  typeProcedure: 6,                 // Colonne G
  faits1: 7,                        // Colonne H
  faits2: 8,                        // Colonne I
  nomPrenom: 9,                     // Colonne J
  adresse: 10,                      // Colonne K
  telephone: 11,                    // Colonne L
  dateNaissance: 12,                // Colonne M
  lieuNaissance: 13,                // Colonne N
  secteurGeographique: 14,          // Colonne O
  commentaires: 15,                 // Colonne P
  referent: 17,                     // Colonne R
  origine2: 18,                     // Colonne S
  airNonEngage: 19,                 // Colonne T
  nombreEntretiensAIR: 20,          // Colonne U
  nombreRencontresPR: 21,           // Colonne V
  nombreCarences: 22,               // Colonne W
  lieuConvocation: 23,              // Colonne X
  dateFinPriseEnCharge: 24,         // Colonne Y
  typesAddiction: 26,               // Colonne AA
  mesuresPrises: 27,                // Colonne AB
  suiviAddictologique: 28,          // Colonne AC
  bilanPsychologique: 29,           // Colonne AD
  suiviPsychologique: 31,           // Colonne AF
  suiviPsychiatrique: 32,           // Colonne AG
  hospitalisationPsy: 33,           // Colonne AH
  situationHandicap: 34,            // Colonne AI
  natureFinAIR: 37,                 // Colonne AL
  resultatMesure: 38,               // Colonne AM
  dureeEnMois: 39,                  // Colonne AN
  orientationFinMesure: 40,         // Colonne AO
  dateCloture: 41,                  // Colonne AP
  sexe: 43,                         // Colonne AR
  nationalite: 44,                  // Colonne AS
  age: 45,                          // Colonne AT
  situationFamiliale: 46,           // Colonne AU
  nombreEnfants: 47,                // Colonne AV
  entourageImpacte: 48,             // Colonne AW
  mesureProtectionMajeur: 50,       // Colonne AY
  hebergementDebut: 51,             // Colonne AZ
  hebergementFin: 52,               // Colonne BA
  demandeLogement: 53,              // Colonne BB
  activiteProfessionnelleDebut: 54, // Colonne BC
  activiteProfessionnelleFin: 55,   // Colonne BD
  repriseActivite: 56,              // Colonne BE
  suiviProjetPro: 57,               // Colonne BF
  permisDeConduire: 58,             // Colonne BG
  suivisMesure: 60,                 // Colonne BI
  activiteSocioCulturelle: 63,      // Colonne BL
  accompagnementParentalite: 64     // Colonne BM
} as const;

// 🔍 MOTS-CLÉS POUR MAPPING DYNAMIQUE
export const FIELD_KEYWORDS = {
  refAEM: ['réf', 'aem', 'référence'],
  dateReception: ['date', 'réception', 'reception'],
  origine: ['origine', 'orientation'],
  faits1: ['faits', 'fait 1', 'faits 1'],
  faits2: ['fait 2', 'faits 2'],
  nomPrenom: ['nom', 'prénom', 'prenom', 'concernant'],
  adresse: ['adresse'],
  telephone: ['téléphone', 'telephone', 'tel'],
  dateNaissance: ['naissance', 'née', 'né'],
  lieuNaissance: ['lieu', 'naissance'],
  secteurGeographique: ['secteur', 'géographique', 'geographique'],
  referent: ['référent', 'referent', 'charge'],
  nombreEntretiensAIR: ['entretiens', 'air'],
  nombreRencontresPR: ['rencontre', 'proc'],
  nombreCarences: ['carences', 'carence'],
  natureFinAIR: ['nature', 'fin', 'air'],
  resultatMesure: ['résultat', 'resultat', 'mesure', 'réussite', 'echec'],
  dureeEnMois: ['durée', 'duree', 'mois'],
  orientationFinMesure: ['orientation', 'fin'],
  dateCloture: ['clôture', 'cloture', 'date'],
  dateFinPriseEnCharge: ['fin', 'prise', 'charge', 'date fin']
} as const;

// 📊 TYPES POUR LA VALIDATION
export interface ValidationResult {
  isValid: boolean;
  confidence: 'high' | 'medium' | 'low';
  message: string;
  foundHeaders: boolean;
  dataRowsCount: number;
  headerRowIndex?: number;
}

export interface MappingResult {
  mapping: Record<string, number>;
  confidence: 'high' | 'medium' | 'low';
  method: 'fixed' | 'dynamic';
  foundFields: string[];
  missingFields: string[];
}

// 🎯 FONCTION DE FORMATAGE DES DATES SIMPLIFIÉE
export const formatDateIfNeeded = (value: any): string => {
  if (!value) return '';
  
  const str = String(value).trim();
  if (!str || str === 'null' || str === 'undefined') return '';
  
// 🔧 AJOUT : Ignorer les transferts
if (str.toUpperCase().includes('TRANSFERE')) {
  return '';
}
  // 🎯 CAS PRINCIPAL : Format DD/MM/YY (format Excel standard)
  if (/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(str)) {
    const [day, month, year] = str.split('/');
    return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/20${year}`;
  }
  
  // 🎯 CAS SECONDAIRE : Déjà au bon format DD/MM/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
    const parts = str.split('/');
    return `${parts[0].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[2]}`;
  }
  
  // 🎯 CAS D'URGENCE : Si rien ne marche, retourner tel quel
  return str;
};

// ✅ VALIDATION SIMPLE DE STRUCTURE
export const validateFileStructure = (jsonData: any[][]): ValidationResult => {
  if (!jsonData || jsonData.length === 0) {
    return {
      isValid: false,
      confidence: 'high',
      message: 'Fichier vide ou illisible',
      foundHeaders: false,
      dataRowsCount: 0
    };
  }

  // Vérifier le nombre minimum de colonnes
  const maxColumns = Math.max(...jsonData.map(row => row?.length || 0));
  if (maxColumns < AIR_IMPORT_CONFIG.MIN_REQUIRED_COLUMNS) {
    return {
      isValid: false,
      confidence: 'high',
      message: `Trop peu de colonnes (${maxColumns} trouvées, ${AIR_IMPORT_CONFIG.MIN_REQUIRED_COLUMNS} minimum)`,
      foundHeaders: false,
      dataRowsCount: 0
    };
  }

  // Chercher les en-têtes
  let headerRowIndex = -1;
  let foundHeaders = false;

  for (let i = 0; i < Math.min(5, jsonData.length); i++) {
    const row = jsonData[i];
    if (!row) continue;

    const hasEssentialHeaders = row.some(cell => {
      if (!cell) return false;
      const cellStr = String(cell).toLowerCase();
      return cellStr.includes('réf') || 
             cellStr.includes('aem') ||
             cellStr.includes('concernant') ||
             cellStr.includes('nom');
    });

    if (hasEssentialHeaders) {
      headerRowIndex = i;
      foundHeaders = true;
      break;
    }
  }

  // Compter les lignes de données
  const dataStartIndex = headerRowIndex >= 0 ? headerRowIndex + 2 : 4;
  let dataRowsCount = 0;
  
  for (let i = dataStartIndex; i < jsonData.length; i++) {
    const row = jsonData[i];
    if (row && !row.every(cell => !cell || String(cell).trim() === '')) {
      dataRowsCount++;
    }
  }

  // Déterminer la validité et la confiance
  let isValid = true;
  let confidence: 'high' | 'medium' | 'low' = 'high';
  let message = 'Fichier valide';

  if (!foundHeaders) {
    confidence = 'low';
    message = 'En-têtes non détectés, structure suspecte';
  } else if (headerRowIndex !== AIR_IMPORT_CONFIG.HEADER_ROW_INDEX) {
    confidence = 'medium';
    message = `En-têtes trouvés ligne ${headerRowIndex + 1} (attendu ligne ${AIR_IMPORT_CONFIG.HEADER_ROW_INDEX + 1})`;
  }

  if (dataRowsCount < AIR_IMPORT_CONFIG.MIN_DATA_ROWS) {
    isValid = false;
    message = `Aucune donnée trouvée (${dataRowsCount} lignes)`;
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

// 🎯 TENTATIVE DE MAPPING FIXE
export const tryFixedMapping = (jsonData: any[][], headerRowIndex: number = AIR_IMPORT_CONFIG.HEADER_ROW_INDEX): MappingResult => {
  const dataStartIndex = headerRowIndex + 2;
  const testRows = jsonData.slice(dataStartIndex, dataStartIndex + Math.min(10, jsonData.length - dataStartIndex));
  
  let foundFields: string[] = [];
  let missingFields: string[] = [];

  // Tester les champs essentiels avec le mapping fixe
  for (const [fieldName, colIndex] of Object.entries(FIXED_AIR_COLUMN_MAPPINGS)) {
    if (!AIR_IMPORT_CONFIG.ESSENTIAL_FIELDS.includes(fieldName as any)) continue;

    let hasData = false;
    for (const row of testRows) {
      if (row && row[colIndex] && String(row[colIndex]).trim()) {
        hasData = true;
        break;
      }
    }

    if (hasData) {
      foundFields.push(fieldName);
    } else {
      missingFields.push(fieldName);
    }
  }

  const successRate = foundFields.length / AIR_IMPORT_CONFIG.ESSENTIAL_FIELDS.length;
  
  if (successRate >= AIR_IMPORT_CONFIG.REQUIRED_FIELDS_THRESHOLD) {
    return {
      mapping: FIXED_AIR_COLUMN_MAPPINGS,
      confidence: successRate > 0.8 ? 'high' : 'medium',
      method: 'fixed',
      foundFields,
      missingFields
    };
  }

  return {
    mapping: {},
    confidence: 'low',
    method: 'fixed',
    foundFields,
    missingFields
  };
};

// 🔍 MAPPING DYNAMIQUE
export const createDynamicMapping = (jsonData: any[][], headerRowIndex: number): MappingResult => {
  const headerRow = jsonData[headerRowIndex];
  if (!headerRow) {
    return {
      mapping: {},
      confidence: 'low',
      method: 'dynamic',
      foundFields: [],
      missingFields: Object.keys(FIELD_KEYWORDS)
    };
  }

  const dynamicMapping: Record<string, number> = {};
  const foundFields: string[] = [];
  const missingFields: string[] = [];

  // Pour chaque champ, chercher la meilleure correspondance
  for (const [fieldName, keywords] of Object.entries(FIELD_KEYWORDS)) {
    let bestMatch = -1;
    let bestScore = 0;

    for (let colIndex = 0; colIndex < headerRow.length; colIndex++) {
      const header = headerRow[colIndex];
      if (!header) continue;

      const headerStr = String(header).toLowerCase();
      let score = 0;

      // Calculer le score de correspondance
      for (const keyword of keywords) {
        if (headerStr.includes(keyword.toLowerCase())) {
          score += keyword.length; // Plus le mot-clé est long, plus le score est élevé
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

  // Déterminer la confiance
  const essentialFound = AIR_IMPORT_CONFIG.ESSENTIAL_FIELDS.filter(field => 
    foundFields.includes(field)
  ).length;
  
  const essentialRate = essentialFound / AIR_IMPORT_CONFIG.ESSENTIAL_FIELDS.length;
  
  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (essentialRate >= 0.8) confidence = 'high';
  else if (essentialRate >= 0.5) confidence = 'medium';

  return {
    mapping: dynamicMapping,
    confidence,
    method: 'dynamic',
    foundFields,
    missingFields
  };
};

// 🎛️ SÉLECTION AUTOMATIQUE DU MEILLEUR MAPPING
export const getBestMapping = (jsonData: any[][]): { mappingResult: MappingResult; validation: ValidationResult } => {
  // 1. Validation de structure
  const validation = validateFileStructure(jsonData);
  
  if (!validation.isValid) {
    return {
      mappingResult: {
        mapping: {},
        confidence: 'low',
        method: 'fixed',
        foundFields: [],
        missingFields: Object.keys(FIELD_KEYWORDS)
      },
      validation
    };
  }

  // 2. Déterminer l'index des en-têtes
  const headerRowIndex = validation.headerRowIndex ?? AIR_IMPORT_CONFIG.HEADER_ROW_INDEX;

  // 3. Essayer le mapping fixe d'abord
  const fixedResult = tryFixedMapping(jsonData, headerRowIndex);
  
  if (fixedResult.confidence !== 'low') {
    console.log('✅ Mapping fixe utilisé avec succès');
    return { mappingResult: fixedResult, validation };
  }

  // 4. Si échec, essayer le mapping dynamique
  console.log('⚠️ Mapping fixe insuffisant, tentative mapping dynamique...');
  const dynamicResult = createDynamicMapping(jsonData, headerRowIndex);
  
  return { mappingResult: dynamicResult, validation };
};

// 📝 PARSE UNE LIGNE AVEC UN MAPPING DONNÉ
export const parseAIRDataRowWithMapping = (
  row: any[], 
  rowIndex: number, 
  mapping: Record<string, number>
): AIRImportData | null => {
  if (!row || row.length < 5) return null;
  
  // Vérifier les champs essentiels
  const refAEM = mapping.refAEM !== undefined ? row[mapping.refAEM] : null;
  const nomPrenom = mapping.nomPrenom !== undefined ? row[mapping.nomPrenom] : null;
  
  if (!refAEM || !String(refAEM).trim() || !nomPrenom || !String(nomPrenom).trim()) {
    return null;
  }

  try {
    const faits1 = mapping.faits1 !== undefined ? row[mapping.faits1] || '' : '';
    const faits2 = mapping.faits2 !== undefined ? row[mapping.faits2] || '' : '';
    const resultatMesure = mapping.resultatMesure !== undefined ? row[mapping.resultatMesure] || '' : '';
    const dateCloture = mapping.dateCloture !== undefined ? row[mapping.dateCloture] || '' : '';
    const natureFinAIR = mapping.natureFinAIR !== undefined ? row[mapping.natureFinAIR] || '' : '';
    
    const airData: AIRImportData = {
      // Données procédurales
      refAEM: String(refAEM).trim(),
      dateReception: mapping.dateReception !== undefined ? 
        formatDateIfNeeded(row[mapping.dateReception]) : '',
      origine: mapping.origine !== undefined ? 
        String(row[mapping.origine] || '').trim() : undefined,
      faits: fusionnerFaits(String(faits1), String(faits2)),
      
      // Données personnelles
      nomPrenom: String(nomPrenom).trim(),
      adresse: mapping.adresse !== undefined ? 
        String(row[mapping.adresse] || '').trim() : undefined,
      telephone: mapping.telephone !== undefined ? 
        String(row[mapping.telephone] || '').trim() : undefined,
      dateNaissance: mapping.dateNaissance !== undefined ? 
        formatDateIfNeeded(row[mapping.dateNaissance]) : undefined,
      lieuNaissance: mapping.lieuNaissance !== undefined ? 
        String(row[mapping.lieuNaissance] || '').trim() : undefined,
      secteurGeographique: mapping.secteurGeographique !== undefined ? 
        String(row[mapping.secteurGeographique] || '').trim() || undefined : undefined,
      
      // Suivi AIR
      referent: mapping.referent !== undefined ? 
        String(row[mapping.referent] || '').trim() : undefined,
      nombreEntretiensAIR: mapping.nombreEntretiensAIR !== undefined ? 
        parseNumber(row[mapping.nombreEntretiensAIR]) : 0,
      nombreRencontresPR: mapping.nombreRencontresPR !== undefined ? 
        parseNumber(row[mapping.nombreRencontresPR]) : 0,
      nombreCarences: mapping.nombreCarences !== undefined ? 
        parseNumber(row[mapping.nombreCarences]) : 0,
      
      // Fin de mesure
      natureFinAIR: String(natureFinAIR).trim() || undefined,
      resultatMesure: String(resultatMesure).trim() || undefined,
      dureeEnMois: mapping.dureeEnMois !== undefined ? 
        parseNumber(row[mapping.dureeEnMois]) : 0,
      orientationFinMesure: mapping.orientationFinMesure !== undefined ? 
        String(row[mapping.orientationFinMesure] || '').trim() || undefined : undefined,
      dateCloture: formatDateIfNeeded(dateCloture) || undefined,
      
      // 🆕 AJOUT DU CHAMP MANQUANT
      dateFinPriseEnCharge: mapping.dateFinPriseEnCharge !== undefined ? 
        formatDateIfNeeded(row[mapping.dateFinPriseEnCharge]) || undefined : undefined,
      
      // Métadonnées
      statut: determineAIRStatus(
        String(resultatMesure).trim() || undefined,
        formatDateIfNeeded(dateCloture) || undefined,
        String(natureFinAIR).trim() || undefined
      )
    };
    
    return airData;
    
  } catch (error) {
    console.error(`Erreur lors du parsing de la ligne ${rowIndex + 1}:`, error);
    return null;
  }
};

// 📊 FONCTION PRINCIPALE D'IMPORT AMÉLIORÉE
export const parseAIRExcelDataImproved = (
  jsonData: any[][],
  sheetName: string = ''
): { 
  data: AIRImportData[], 
  errors: string[], 
  validation: ValidationResult,
  mappingResult: MappingResult 
} => {
  const errors: string[] = [];
  const data: AIRImportData[] = [];
  
  // 1. Obtenir le meilleur mapping
  const { mappingResult, validation } = getBestMapping(jsonData);
  
  if (!validation.isValid) {
    errors.push(validation.message);
    return { data, errors, validation, mappingResult };
  }

  // 2. Déterminer les indices de début
  const headerRowIndex = validation.headerRowIndex ?? AIR_IMPORT_CONFIG.HEADER_ROW_INDEX;
  const startRowIndex = headerRowIndex + 2;
  
  console.log(`📋 Utilisation du mapping ${mappingResult.method} (confiance: ${mappingResult.confidence})`);
  console.log(`📍 En-têtes ligne ${headerRowIndex + 1}, données à partir ligne ${startRowIndex + 1}`);
  
  if (mappingResult.missingFields.length > 0) {
    console.warn(`⚠️ Champs manquants: ${mappingResult.missingFields.join(', ')}`);
  }

  // 3. Traiter les données
  let processedCount = 0;
  let validCount = 0;
  
  for (let i = startRowIndex; i < jsonData.length; i++) {
    const row = jsonData[i];
    
    // Ignorer les lignes vides
    if (!row || row.every(cell => !cell || String(cell).trim() === '')) {
      continue;
    }
    
    processedCount++;
    
    try {
      const airData = parseAIRDataRowWithMapping(row, i, mappingResult.mapping);
      
      if (airData) {
        data.push(airData);
        validCount++;
      } else {
        console.log(`Ligne ${i + 1} ignorée (données insuffisantes)`);
      }
      
    } catch (error) {
      const errorMsg = `Erreur ligne ${i + 1}: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
      errors.push(errorMsg);
      console.error(errorMsg);
    }
  }
  
  console.log(`✅ Import terminé: ${validCount} lignes valides sur ${processedCount} lignes traitées`);
  
  if (data.length === 0 && errors.length === 0) {
    errors.push('Aucune donnée valide trouvée. Vérifiez le format du fichier.');
  }
  
  return { data, errors, validation, mappingResult };
};

// 🛠️ FONCTIONS UTILITAIRES
export const determineAIRStatus = (
  resultatMesure?: string,
  dateCloture?: string,
  natureFinAIR?: string
): AIRStatus => {
  if (resultatMesure) {
    const resultat = resultatMesure.toLowerCase().trim();
    if (resultat.includes('réussite') || resultat.includes('reussite')) {
      return 'reussite';
    }
    if (resultat.includes('échec') || resultat.includes('echec')) {
      return 'echec';
    }
  }
  
  if (natureFinAIR) {
    const nature = natureFinAIR.toLowerCase().trim();
    if (nature.includes('fin de mesure') || nature.includes('respect engagement')) {
      return 'termine';
    }
  }
  
  if (dateCloture) {
    return 'termine';
  }
  
  return 'en_cours';
};

export const fusionnerFaits = (faits1?: string, faits2?: string): string => {
  const f1 = faits1?.trim() || '';
  const f2 = faits2?.trim() || '';
  
  if (f1 && f2) {
    return `${f1} + ${f2}`;
  }
  
  return f1 || f2 || '';
};

export const parseNumber = (value: any): number => {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  
  const cleaned = String(value).replace(/[^\d]/g, '');
  const parsed = parseInt(cleaned, 10);
  
  return isNaN(parsed) ? 0 : parsed;
};

// 🔄 FONCTIONS DE COMPATIBILITÉ (pour maintenir l'ancien code)

/**
 * @deprecated Utilisez getBestMapping() à la place
 * Fonction de compatibilité pour l'ancien code
 */
export const findHeaderRowIndex = (data: any[][]): number => {
  const validation = validateFileStructure(data);
  return validation.headerRowIndex ?? AIR_IMPORT_CONFIG.HEADER_ROW_INDEX;
};

/**
 * @deprecated Utilisez parseAIRExcelDataImproved() à la place
 * Fonction de compatibilité pour l'ancien code
 */
export const parseAIRDataRow = (row: any[], rowIndex: number): AIRImportData | null => {
  return parseAIRDataRowWithMapping(row, rowIndex, FIXED_AIR_COLUMN_MAPPINGS);
};

/**
 * @deprecated Utilisez parseAIRExcelDataImproved() à la place
 * Fonction de compatibilité pour l'ancien code
 */
export const parseAIRExcelData = (
  jsonData: any[][],
  sheetName: string = ''
): { data: AIRImportData[], errors: string[] } => {
  const result = parseAIRExcelDataImproved(jsonData, sheetName);
  return {
    data: result.data,
    errors: result.errors
  };
};