// utils/documents/ServerDocumentScanner.ts
// Service d'analyse automatique des PDF du serveur pour créer des actes

import { Enquete, EcouteData, GeolocData, ProlongationHistoryEntry } from '@/types/interfaces';
import { DuplicateDetectionService, VerificationResult } from './DuplicateDetectionService';

// ─── Types pour l'analyse ───

export type DocumentType =
  | 'autorisation_initiale_ecoute'
  | 'autorisation_initiale_geoloc'
  | 'prolongation_ecoute'
  | 'prolongation_geoloc'
  | 'requete_ecoute'
  | 'requete_geoloc'
  | 'autre';

export type Autorite = 'procureur' | 'jld';

export interface ScannedDocument {
  /** Chemin complet du fichier sur le serveur */
  filePath: string;
  /** Nom du fichier */
  fileName: string;
  /** Sous-dossier d'origine (Geoloc, Ecoutes, etc.) */
  sourceFolder: string;
  /** Texte extrait du PDF */
  textContent: string;
}

export interface ParsedActe {
  /** Document source */
  source: ScannedDocument;
  /** Type détecté */
  type: DocumentType;
  /** Autorité (procureur ou JLD) */
  autorite: Autorite;
  /** Confiance de l'analyse (0-1) */
  confidence: number;

  // Données extraites
  /** Cibles : numéros de téléphone ou véhicules/immatriculations */
  cibles: string[];
  /** Durée (valeur numérique sous forme de string) */
  duree: string;
  /** Unité de durée */
  dureeUnit: 'jours' | 'mois';
  /** Date d'autorisation (YYYY-MM-DD) */
  dateAutorisation: string;
  /** Tribunal */
  tribunal: string;
  /** N° PV de référence */
  numeroPV?: string;
  /** Titulaire de la ligne (pour écoutes) */
  titulaire?: string;
  /** Utilisateur présumé (pour écoutes) */
  utilisateur?: string;
  /** Description libre de l'objet (pour géoloc : véhicule + plaque) */
  objetDescription?: string;

  // Chaînage
  /** Date de l'autorisation initiale (trouvée dans les Vu) pour les prolongations */
  dateAutorisationInitiale?: string;
  /** Durée initiale mentionnée */
  dureeInitiale?: string;

  // Validation
  /** Erreurs détectées */
  errors: string[];
  /** Avertissements */
  warnings: string[];
}

export interface AlerteDocumentManquant {
  /** Type d'acte concerné */
  acteType: 'ecoute' | 'geoloc';
  /** Index de l'acte dans l'enquête */
  acteIndex: number;
  /** Label lisible de l'acte (ex: "Écoute 07.49.03.14.21") */
  acteLabel: string;
  /** Type de document manquant */
  documentManquant: string;
  /** Sévérité : 'warning' pour recommandé, 'error' pour obligatoire */
  severite: 'warning' | 'error';
}

export interface AnalysisResult {
  /** Actes détectés prêts à être validés */
  actesDetectes: ParsedActe[];
  /** Actes ignorés (doublons détectés) */
  doublonsIgnores: { acte: ParsedActe; raison: string }[];
  /** Documents non reconnus */
  nonReconnus: ScannedDocument[];
  /** Alertes de documents manquants dans la chaîne légale */
  alertes: AlerteDocumentManquant[];
  /** Erreurs globales */
  errors: string[];
  /** Statistiques */
  stats: {
    totalDocumentsScanned: number;
    totalPDFs: number;
    totalReconnus: number;
    totalDoublons: number;
    totalNonReconnus: number;
    totalErrors: number;
    foldersScanned: string[];
  };
}

// ─── Mois français → numéro ───

const MOIS_FR: Record<string, string> = {
  'janvier': '01', 'fevrier': '02', 'février': '02', 'mars': '03', 'avril': '04',
  'mai': '05', 'juin': '06', 'juillet': '07', 'août': '08', 'aout': '08',
  'septembre': '09', 'octobre': '10', 'novembre': '11', 'décembre': '12', 'decembre': '12'
};

// ─── Nombres en lettres → chiffres ───

const NOMBRES_FR: Record<string, number> = {
  'un': 1, 'une': 1, 'deux': 2, 'trois': 3, 'quatre': 4, 'cinq': 5,
  'six': 6, 'sept': 7, 'huit': 8, 'neuf': 9, 'dix': 10,
  'onze': 11, 'douze': 12, 'treize': 13, 'quatorze': 14, 'quinze': 15,
  'seize': 16, 'vingt': 20, 'trente': 30, 'quarante': 40, 'quarante-huit': 48
};

// ─── Classe principale ───

export class ServerDocumentScanner {

  /**
   * Normalise le texte pour absorber les artefacts OCR courants :
   * - Espaces insécables → espaces normaux
   * - Ligatures ff/fi/fl cassées
   * - Multiples espaces → un seul
   * - Retours chariot Windows
   */
  private static normalizeOCRText(text: string): string {
    return text
      .replace(/\u00A0/g, ' ')           // espace insécable → espace normal
      .replace(/\u202F/g, ' ')           // espace fine insécable
      .replace(/\uFB00/g, 'ff')          // ligature ff
      .replace(/\uFB01/g, 'fi')          // ligature fi
      .replace(/\uFB02/g, 'fl')          // ligature fl
      .replace(/\r\n/g, '\n')            // Windows → Unix
      .replace(/[ \t]{2,}/g, ' ');        // multiples espaces → un seul
  }

  // ════════════════════════════════════════════════════════════
  // 1. SCAN DES DOSSIERS
  // ════════════════════════════════════════════════════════════

  /**
   * Analyse tous les PDFs du chemin externe d'une enquête.
   * Compare avec les actes existants pour éviter les doublons.
   */
  static async analyzeExternalDocuments(
    enquete: Enquete,
    scannedDocuments: ScannedDocument[]
  ): Promise<AnalysisResult> {
    const result: AnalysisResult = {
      actesDetectes: [],
      doublonsIgnores: [],
      nonReconnus: [],
      alertes: [],
      errors: [],
      stats: {
        totalDocumentsScanned: scannedDocuments.length,
        totalPDFs: scannedDocuments.length,
        totalReconnus: 0,
        totalDoublons: 0,
        totalNonReconnus: 0,
        totalErrors: 0,
        foldersScanned: [...new Set(scannedDocuments.map(d => d.sourceFolder))]
      }
    };

    // Analyser chaque document
    for (const doc of scannedDocuments) {
      try {
        const parsed = this.parseDocument(doc);

        if (!parsed || parsed.type === 'autre') {
          result.nonReconnus.push(doc);
          result.stats.totalNonReconnus++;
          continue;
        }

        // Vérifier si c'est un doublon
        const doublonRaison = this.detectDoublon(parsed, enquete, result.actesDetectes);
        if (doublonRaison) {
          result.doublonsIgnores.push({ acte: parsed, raison: doublonRaison });
          result.stats.totalDoublons++;
          continue;
        }

        result.actesDetectes.push(parsed);
        result.stats.totalReconnus++;
      } catch (error) {
        result.errors.push(`Erreur analyse ${doc.fileName}: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
        result.stats.totalErrors++;
      }
    }

    // Vérifier les documents manquants dans la chaîne légale
    const allParsedDocuments = [
      ...result.actesDetectes,
      ...result.doublonsIgnores.map(d => d.acte),
    ];
    result.alertes = this.checkMissingDocuments(enquete, allParsedDocuments);

    return result;
  }

  // ════════════════════════════════════════════════════════════
  // 2. PARSING D'UN DOCUMENT
  // ════════════════════════════════════════════════════════════

  static parseDocument(doc: ScannedDocument): ParsedActe | null {
    const text = this.normalizeOCRText(doc.textContent);
    if (!text || text.length < 100) return null;

    const errors: string[] = [];
    const warnings: string[] = [];

    // Détecter le type de document
    const type = this.detectDocumentType(text);
    if (type === 'autre') return null;

    // Détecter l'autorité
    const autorite = this.detectAutorite(text);

    // Extraire le dispositif (partie décisive)
    const dispositif = this.extractDispositif(text, type);

    // Extraire les données selon le type
    const cibles = this.extractCibles(dispositif || text, type);
    const { duree, dureeUnit } = this.extractDuree(dispositif || text);
    const dateAutorisation = this.extractDateAutorisation(text);
    const tribunal = this.extractTribunal(text);
    const numeroPV = this.extractNumeroPV(text);
    const titulaire = this.extractTitulaire(dispositif || text);
    const utilisateur = this.extractUtilisateur(dispositif || text);
    const objetDescription = this.extractObjetGeoloc(dispositif || text);

    // Pour les prolongations : extraire les infos de l'acte initial
    let dateAutorisationInitiale: string | undefined;
    let dureeInitiale: string | undefined;

    if (type.startsWith('prolongation_')) {
      const initiale = this.extractInfoInitiale(text);
      dateAutorisationInitiale = initiale.date;
      dureeInitiale = initiale.duree;

      // Warnings de chaînage
      if (!dateAutorisationInitiale) {
        warnings.push(
          'Date de l\'autorisation initiale non trouvée dans le document. ' +
          'Le chaînage avec l\'acte initial pourrait être imprécis — vérifiez manuellement.'
        );
      }
      if (!dureeInitiale) {
        warnings.push(
          'Durée de l\'autorisation initiale non détectée. ' +
          'Une valeur par défaut sera utilisée si l\'acte initial n\'existe pas dans l\'enquête.'
        );
      }
    }

    // Warning si pas de dispositif trouvé
    if (!dispositif) {
      warnings.push(
        'Section "Par conséquent" / "PAR CES MOTIFS" non isolée. ' +
        'Les données ont été extraites du texte complet — risque de faux positifs.'
      );
    }

    // Validation
    if (cibles.length === 0) {
      errors.push('Aucune cible détectée (numéro de téléphone ou véhicule)');
    }
    if (!dateAutorisation) {
      errors.push('Date d\'autorisation non trouvée');
    }
    if (!duree) {
      warnings.push('Durée non détectée, valeur par défaut utilisée');
    }

    // Calcul de confiance
    const confidence = this.calculateConfidence(type, cibles, dateAutorisation, duree, autorite);

    return {
      source: doc,
      type,
      autorite,
      confidence,
      cibles,
      duree: duree || (dureeUnit === 'mois' ? '1' : '15'),
      dureeUnit,
      dateAutorisation: dateAutorisation || new Date().toISOString().split('T')[0],
      tribunal: tribunal || 'AMIENS',
      numeroPV,
      titulaire,
      utilisateur,
      objetDescription,
      dateAutorisationInitiale,
      dureeInitiale,
      errors,
      warnings
    };
  }

  // ════════════════════════════════════════════════════════════
  // 3. DÉTECTION DU TYPE DE DOCUMENT
  // ════════════════════════════════════════════════════════════

  private static detectDocumentType(text: string): DocumentType {
    const upper = text.toUpperCase();
    const lower = text.toLowerCase();

    // ── Requête (le procureur DEMANDE au JLD) ──
    const isRequete = /REQU[ÊE]TE\s+AUX\s+FINS/i.test(text) ||
                      /DEMANDONS\s+[àa]\s+Monsieur\s+le\s+juge/i.test(text);

    // ── Prolongation / renouvellement ──
    const isProlongation =
      /prolongation/i.test(text) ||
      /renouvellement/i.test(text) ||
      /poursuite.*mesure/i.test(text) ||
      /AUTORISONS.*prolongation/i.test(text);

    // ── Géolocalisation ──
    const isGeoloc =
      /g[ée]olocalisation/i.test(text) &&
      (upper.includes('230-33') || upper.includes('230-32') || /GEOLOCALISATION\s+EN\s+TEMPS\s+R[ÉE]EL/i.test(text));

    // ── Écoute / interception ──
    const isEcoute =
      /interception.*correspondances?\s+t[ée]l[ée]phoniques?/i.test(text) ||
      (/706-95/i.test(text) && /interception/i.test(text)) ||
      /AUTORISATION\s+D[''']INTERCEPTION/i.test(text);

    // Classifier
    if (isRequete) {
      if (isGeoloc) return 'requete_geoloc';
      if (isEcoute) return 'requete_ecoute';
      return 'autre';
    }

    if (isProlongation) {
      if (isGeoloc) return 'prolongation_geoloc';
      if (isEcoute) return 'prolongation_ecoute';
      return 'autre';
    }

    // Autorisation initiale
    if (isGeoloc) return 'autorisation_initiale_geoloc';
    if (isEcoute) return 'autorisation_initiale_ecoute';

    return 'autre';
  }

  // ════════════════════════════════════════════════════════════
  // 4. DÉTECTION DE L'AUTORITÉ
  // ════════════════════════════════════════════════════════════

  private static detectAutorite(text: string): Autorite {
    if (/JUGE\s+DES\s+LIBERT[ÉE]S/i.test(text)) return 'jld';
    if (/PAR\s+CES\s+MOTIFS?/i.test(text)) return 'jld';
    if (/Nous,.*vice[- ]pr[ée]sident/i.test(text)) return 'jld';
    if (/procureur\s+de\s+la\s+R[ée]publique/i.test(text) && !(/JUGE.*LIBERT/i.test(text))) return 'procureur';
    return 'procureur';
  }

  // ════════════════════════════════════════════════════════════
  // 5. EXTRACTION DU DISPOSITIF
  // ════════════════════════════════════════════════════════════

  private static extractDispositif(text: string, type: DocumentType): string | null {
    // Pour les requêtes, chercher après "Par conséquent" ou "DEMANDONS"
    if (type.startsWith('requete_')) {
      const requetePatterns = [
        /Par\s+cons[ée]quent[\s,]*([\s\S]*$)/i,
        /DEMANDONS\s+([\s\S]*$)/i
      ];
      for (const pattern of requetePatterns) {
        const match = text.match(pattern);
        if (match) return match[0];
      }
    }

    // Pour les autorisations JLD : après "PAR CES MOTIFS"
    // Pour les autorisations procureur : après "Par conséquent"
    const dispositifPatterns = [
      /PAR\s+CES\s+MOTIFS?\s*([\s\S]*$)/i,
      /Par\s+cons[ée]quent[\s,]*([\s\S]*$)/i,
      /AUTORISONS\s+([\s\S]*$)/i
    ];

    for (const pattern of dispositifPatterns) {
      const match = text.match(pattern);
      if (match) return match[0];
    }

    return null;
  }

  // ════════════════════════════════════════════════════════════
  // 6. EXTRACTION DES CIBLES
  // ════════════════════════════════════════════════════════════

  private static extractCibles(text: string, type: DocumentType): string[] {
    const cibles: string[] = [];

    if (type.includes('ecoute') || type.includes('requete_ecoute')) {
      // Extraire les numéros de téléphone
      // Utiliser [0-9oOlI] au lieu de \d pour tolérer les erreurs OCR courantes
      // (o/O confondu avec 0, l/I confondu avec 1)
      const D = '[0-9oOlI]'; // "digit" tolérant OCR
      const phonePatterns = [
        // Format avec points/tirets/espaces : 07.45.40.86.12, 07-49-03-14-21, etc.
        new RegExp(`(?:N°|n°|La\\s+ligne|ligne)\\s*:?\\s*(${D}{2}[.\\s-]?${D}{2}[.\\s-]?${D}{2}[.\\s-]?${D}{2}[.\\s-]?${D}{2})`, 'gi'),
        // Format bullet : • N° 07.45.40.86.12 ou 07-49-03-14-21
        new RegExp(`[•\\-]\\s*N°?\\s*(${D}{2}[.\\s-]?${D}{2}[.\\s-]?${D}{2}[.\\s-]?${D}{2}[.\\s-]?${D}{2})`, 'gi'),
        // Format direct dans le dispositif (points ou tirets)
        new RegExp(`(${D}{2}[.\\-]${D}{2}[.\\-]${D}{2}[.\\-]${D}{2}[.\\-]${D}{2})`, 'g')
      ];

      for (const pattern of phonePatterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
          const normalized = this.normalizePhoneNumber(match[1]);
          if (normalized && !cibles.includes(normalized)) {
            cibles.push(normalized);
          }
        }
      }
    }

    if (type.includes('geoloc') || type.includes('requete_geoloc')) {
      // Extraire les véhicules + immatriculations
      const vehiclePatterns = [
        // "véhicule FORD Fiesta immatriculé CF-554-GE"
        /v[ée]hicule\s+([A-Z][A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+)?)\s+immatricul[ée]\s+([A-Z]{2}[- ]?\d{3}[- ]?[A-Z]{2})/gi,
        // "Le véhicule ... immatriculé ..."
        /[Ll]e\s+v[ée]hicule\s+([A-Z][A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ0-9]+)?)\s+immatricul[ée]\s+([A-Z]{2}[- ]?\d{3}[- ]?[A-Z]{2})/gi,
        // Juste l'immatriculation
        /immatricul[ée]\s+([A-Z]{2}[- ]?\d{3}[- ]?[A-Z]{2})/gi
      ];

      for (const pattern of vehiclePatterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
          let cible: string;
          if (match[2]) {
            // Véhicule + plaque
            const plaque = match[2].replace(/\s/g, '-');
            cible = `${match[1].trim()} ${plaque}`;
          } else {
            cible = match[1].replace(/\s/g, '-');
          }
          if (!cibles.includes(cible)) {
            cibles.push(cible);
          }
        }
      }

      // Aussi chercher les lignes téléphoniques pour géoloc sur ligne
      const DG = '[0-9oOlI]'; // digit tolérant OCR
      const phoneGeoloc = new RegExp(`ligne\\s+t[ée]l[ée]phonique\\s+suivante\\s*:\\s*[•\\-\\s]*(?:N°?\\s*)?(${DG}{2}[.\\s-]?${DG}{2}[.\\s-]?${DG}{2}[.\\s-]?${DG}{2}[.\\s-]?${DG}{2})`, 'gi');
      let match;
      while ((match = phoneGeoloc.exec(text)) !== null) {
        const normalized = this.normalizePhoneNumber(match[1]);
        if (normalized && !cibles.includes(normalized)) {
          cibles.push(normalized);
        }
      }
    }

    return cibles;
  }

  // ════════════════════════════════════════════════════════════
  // 7. EXTRACTION DE LA DURÉE
  // ════════════════════════════════════════════════════════════

  private static extractDuree(text: string): { duree: string; dureeUnit: 'jours' | 'mois' } {
    // Note : \s* au lieu de \s+ pour absorber les mots collés par l'OCR ("quinzejours")

    // Durée en mois (mots) — "d'un mois", "d'unmois"
    const moisMotMatch = text.match(/dur[ée]e\s*(?:maximale?\s*)?d[''']?\s*(un|une)\s*mois/i);
    if (moisMotMatch) return { duree: '1', dureeUnit: 'mois' };

    // Durée en mois (chiffre) — "de 2 mois", "de2mois"
    const moisNumMatch = text.match(/dur[ée]e\s*(?:maximale?\s*)?(?:de\s*)?(\d+)\s*mois/i);
    if (moisNumMatch) return { duree: moisNumMatch[1], dureeUnit: 'mois' };

    // "pour une durée maximale d'un mois"
    const pourMoisMatch = text.match(/pour\s+une?\s+dur[ée]e\s*(?:maximale?\s*)?d[''']?\s*(un|une)\s*mois/i);
    if (pourMoisMatch) return { duree: '1', dureeUnit: 'mois' };

    // Durée en jours (mots) — "de quinze jours", "dequinzejours", "quinze jours"
    const joursMotMatch = text.match(/dur[ée]e\s*(?:de\s*)?(\w+)\s*jours?/i);
    if (joursMotMatch) {
      const nombre = NOMBRES_FR[joursMotMatch[1].toLowerCase()];
      if (nombre) return { duree: nombre.toString(), dureeUnit: 'jours' };
    }

    // Durée en jours (chiffre) — "de 15 jours", "15jours"
    const joursNumMatch = text.match(/dur[ée]e\s*(?:de\s*)?(\d+)\s*jours?/i);
    if (joursNumMatch) return { duree: joursNumMatch[1], dureeUnit: 'jours' };

    // "quinze jours" / "quinzejours" isolé dans le dispositif (avant "à compter" ou ponctuation)
    const quinzeJours = text.match(/(\w+)\s*jours?\s*[,.]?\s*(?:[àa]\s*compter|renouvelable)/i);
    if (quinzeJours) {
      const nombre = NOMBRES_FR[quinzeJours[1].toLowerCase()];
      if (nombre) return { duree: nombre.toString(), dureeUnit: 'jours' };
    }

    // Fallback : chercher un nombre en lettres suivi de "jours" n'importe où
    // Utile si l'OCR a collé les mots : "quinzejours"
    for (const [mot, valeur] of Object.entries(NOMBRES_FR)) {
      const regex = new RegExp(`${mot}\\s*jours?`, 'i');
      if (regex.test(text)) return { duree: valeur.toString(), dureeUnit: 'jours' };
    }

    // Même chose pour mois
    for (const [mot, valeur] of Object.entries(NOMBRES_FR)) {
      const regex = new RegExp(`${mot}\\s*mois`, 'i');
      if (regex.test(text)) return { duree: valeur.toString(), dureeUnit: 'mois' };
    }

    // 48 heures (IMSI)
    const heuresMatch = text.match(/(\d+)\s*(?:h|heures?)/i);
    if (heuresMatch && parseInt(heuresMatch[1]) <= 48) {
      return { duree: heuresMatch[1], dureeUnit: 'jours' };
    }

    // Défaut : si procureur géoloc → 15 jours, sinon 1 mois
    if (/g[ée]olocalisation/i.test(text) && /procureur/i.test(text) && !/JUGE.*LIBERT/i.test(text)) {
      return { duree: '15', dureeUnit: 'jours' };
    }

    return { duree: '1', dureeUnit: 'mois' };
  }

  // ════════════════════════════════════════════════════════════
  // 8. EXTRACTION DE LA DATE D'AUTORISATION
  // ════════════════════════════════════════════════════════════

  private static extractDateAutorisation(text: string): string | undefined {
    // "Fait à AMIENS, le 13 mars 2026"
    const faitAMatch = text.match(
      /Fait\s+[àa]\s+[A-ZÀ-Ÿ][A-Za-zÀ-ÿ]+,?\s+le\s+(\d{1,2})\s+([a-zéûôàêâ]+)\s+(\d{4})/i
    );
    if (faitAMatch) {
      return this.formatFrenchDate(faitAMatch[1], faitAMatch[2], faitAMatch[3]);
    }

    // "Fait au parquet, le ..."
    const faitParquetMatch = text.match(
      /Fait\s+au\s+parquet,?\s+le\s+(\d{1,2})\s+([a-zéûôàêâ]+)\s+(\d{4})/i
    );
    if (faitParquetMatch) {
      return this.formatFrenchDate(faitParquetMatch[1], faitParquetMatch[2], faitParquetMatch[3]);
    }

    // Fallback : dernière date "le DD mois YYYY" en fin de document
    const allDates = [...text.matchAll(/le\s+(\d{1,2})\s+([a-zéûôàêâ]+)\s+(\d{4})/gi)];
    if (allDates.length > 0) {
      const last = allDates[allDates.length - 1];
      return this.formatFrenchDate(last[1], last[2], last[3]);
    }

    return undefined;
  }

  // ════════════════════════════════════════════════════════════
  // 9. EXTRACTION DU TRIBUNAL
  // ════════════════════════════════════════════════════════════

  private static extractTribunal(text: string): string | undefined {
    const match = text.match(/TRIBUNAL\s+JUDICIAIRE\s+D[''']([A-ZÀ-Ÿ]+)/i);
    if (match) return match[1].toUpperCase();

    const faitMatch = text.match(/Fait\s+[àa]\s+([A-ZÀ-Ÿ][A-Za-zÀ-ÿ]+)/i);
    if (faitMatch && faitMatch[1].toUpperCase() !== 'LE') return faitMatch[1].toUpperCase();

    return undefined;
  }

  // ════════════════════════════════════════════════════════════
  // 10. EXTRACTION DU N° PV
  // ════════════════════════════════════════════════════════════

  private static extractNumeroPV(text: string): string | undefined {
    const patterns = [
      /proc[èe]s[- ]verbal\s+(?:n°?\s*)?(\d{4}[\/\-]?\d+)/i,
      /n°\s*(?:de\s+)?(?:proc[èe]s[- ]verbal|PV)\s+(\d{4}[\/\-]?\d+)/i,
      /PV\s+(\d{4}[\/\-]\d+)/i
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1];
    }
    return undefined;
  }

  // ════════════════════════════════════════════════════════════
  // 11. EXTRACTION TITULAIRE / UTILISATEUR
  // ════════════════════════════════════════════════════════════

  private static extractTitulaire(text: string): string | undefined {
    const patterns = [
      /appartenant\s+[àa]\s+([A-ZÀ-Ÿ][a-zà-ÿ]+\s+[A-ZÀ-Ÿ][A-ZÀ-Ÿa-zà-ÿ\s\-]+?)(?:\s+et\s+susceptible|\s*;|\s*\n)/i,
      /inscrite?\s+au\s+nom\s+de\s+([A-ZÀ-Ÿ][a-zà-ÿ]+\s+[A-ZÀ-Ÿ][A-ZÀ-Ÿa-zà-ÿ\s\-]+?)(?:\s*,|\s*;|\s*\n)/i,
      /nom\s+de\s+([A-ZÀ-Ÿ][a-zà-ÿ]+\s+[A-ZÀ-Ÿ][A-ZÀ-Ÿa-zà-ÿ\s\-]+?)(?:\s*,|\s*;|\s*\n)/i
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1].trim();
    }
    return undefined;
  }

  private static extractUtilisateur(text: string): string | undefined {
    const patterns = [
      /susceptible\s+d[''']être\s+utilis[ée]e?\s+par\s+([A-ZÀ-Ÿ][a-zà-ÿ]+\s+[A-ZÀ-Ÿ][A-ZÀ-Ÿa-zà-ÿ\s\-]+?)(?:\s*;|\s*\n|\s*$)/i,
      /utilis[ée]e?\s+par\s+([A-ZÀ-Ÿ][a-zà-ÿ]+\s+[A-ZÀ-Ÿ][A-ZÀ-Ÿa-zà-ÿ\s\-]+?)(?:\s*;|\s*\n|\s*$)/i
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1].trim();
    }
    return undefined;
  }

  // ════════════════════════════════════════════════════════════
  // 12. EXTRACTION OBJET GÉOLOC
  // ════════════════════════════════════════════════════════════

  private static extractObjetGeoloc(text: string): string | undefined {
    // "Le véhicule FORD Fiesta immatriculé CF-554-GE utilisé par Anthony LECOQ"
    const fullMatch = text.match(
      /[Ll]e\s+v[ée]hicule\s+([A-Z][A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ0-9]+)?)\s+immatricul[ée]\s+([A-Z]{2}[- ]?\d{3}[- ]?[A-Z]{2})(?:\s+utilis[ée]\s+par\s+([A-ZÀ-Ÿ][a-zà-ÿ]+\s+[A-ZÀ-Ÿ]+))?/i
    );
    if (fullMatch) {
      const parts = [fullMatch[1].trim(), fullMatch[2].replace(/\s/g, '-')];
      if (fullMatch[3]) parts.push(`(${fullMatch[3].trim()})`);
      return parts.join(' ');
    }

    // Ligne téléphonique pour géoloc
    const lineMatch = text.match(
      /ligne\s+t[ée]l[ée]phonique\s+suivante\s*:\s*[•\-\s]*(?:N°?\s*)?(\d{2}[.\s-]?\d{2}[.\s-]?\d{2}[.\s-]?\d{2}[.\s-]?\d{2})/i
    );
    if (lineMatch) {
      const normalized = this.normalizePhoneNumber(lineMatch[1]);
      return `Ligne ${normalized}`;
    }

    return undefined;
  }

  // ════════════════════════════════════════════════════════════
  // 13. EXTRACTION INFOS INITIALE (POUR PROLONGATIONS)
  // ════════════════════════════════════════════════════════════

  private static extractInfoInitiale(text: string): { date?: string; duree?: string } {
    // "Vu l'autorisation ... accordée en date du 22 janvier 2026 ... pour une durée de 15 jours"
    const vuMatch = text.match(
      /Vu\s+l['''](?:autorisation|ordonnance).*?(?:en\s+date\s+du|du)\s+(\d{1,2})\s+([a-zéûôàêâ]+)\s+(\d{4}).*?(?:dur[ée]e\s+(?:de\s+)?(\d+|(?:un|une|quinze|trente))\s+(jours?|mois))?/is
    );

    const result: { date?: string; duree?: string } = {};

    if (vuMatch) {
      result.date = this.formatFrenchDate(vuMatch[1], vuMatch[2], vuMatch[3]);
      if (vuMatch[4]) {
        const nombre = NOMBRES_FR[vuMatch[4].toLowerCase()];
        result.duree = nombre ? nombre.toString() : vuMatch[4];
      }
    }

    return result;
  }

  // ════════════════════════════════════════════════════════════
  // 14. DÉTECTION DES DOUBLONS (avec matching flou)
  // ════════════════════════════════════════════════════════════

  /**
   * Vérifie si un acte analysé est un doublon d'un acte existant.
   * Utilise le DuplicateDetectionService pour le matching flou :
   * - Numéros de téléphone : "76 90", "76.90", "0773157690" = même numéro
   * - Plaques : "CF554GE", "CF-554-GE", "CF 554 GE" = même plaque
   * - Dates : tolérance ±3 jours (réception vs autorisation)
   */
  static detectDoublon(
    parsed: ParsedActe,
    enquete: Enquete,
    dejaDetectes: ParsedActe[]
  ): string | null {
    // 1. Vérifier doublons dans les actes déjà détectés dans cette analyse
    for (const existant of dejaDetectes) {
      if (this.isSameActe(parsed, existant)) {
        return `Doublon avec un autre document analysé : ${existant.source.fileName}`;
      }
    }

    // 2. Utiliser le DuplicateDetectionService pour matching flou avec les actes existants
    const match = DuplicateDetectionService.findBestMatch(parsed, enquete);

    if (match) {
      if (match.suggestion === 'doublon_exact') {
        const label = match.existingType === 'ecoute'
          ? `Écoute existante : ${(match.existingData as EcouteData).numero}`
          : `Géoloc existante : ${(match.existingData as GeolocData).objet}`;
        const dateInfo = match.existingData.dateDebut
          ? ` (date: ${match.existingData.dateDebut})`
          : '';
        const similarityPct = Math.round(match.similarity * 100);
        return `${label}${dateInfo} — similarité ${similarityPct}%`;
      }

      if (match.suggestion === 'doublon_probable') {
        // Pour les doublons probables sans correction, on les marque comme doublons ignorés
        const label = match.existingType === 'ecoute'
          ? `Probable doublon avec écoute : ${(match.existingData as EcouteData).numero}`
          : `Probable doublon avec géoloc : ${(match.existingData as GeolocData).objet}`;
        const similarityPct = Math.round(match.similarity * 100);
        const divergences = match.divergences.length > 0
          ? ` (${match.divergences.length} différence(s) détectée(s) — vérification recommandée)`
          : '';
        return `${label} — similarité ${similarityPct}%${divergences}`;
      }

      if (match.suggestion === 'correction_possible') {
        // Corrections possibles : le document matche un acte existant mais avec des divergences
        // (ex: numéro partiel vs complet). On le laisse passer dans actesDetectes pour que
        // le modal de vérification puisse proposer les corrections via verifyAgainstExisting().
        return null;
      }
    }

    // 3. Vérifier aussi les prolongations existantes (le service ne couvre pas l'historique)
    if (parsed.type === 'prolongation_ecoute') {
      for (const ecoute of (enquete.ecoutes || [])) {
        for (const cible of parsed.cibles) {
          const phoneMatch = DuplicateDetectionService.comparePhoneNumbers(cible, ecoute.numero);
          if (phoneMatch.score >= 0.5) {
            const dejaProlong = (ecoute.prolongationsHistory || []).some(p => {
              const dateDet = DuplicateDetectionService.compareDates(
                parsed.dateAutorisation, p.date, 'date prolongation'
              );
              return dateDet.score >= 0.7;
            });
            if (dejaProlong) {
              return `Prolongation déjà enregistrée pour ${ecoute.numero} (date ~${parsed.dateAutorisation})`;
            }
          }
        }
      }
    }

    if (parsed.type === 'prolongation_geoloc') {
      for (const geoloc of (enquete.geolocalisations || [])) {
        for (const cible of parsed.cibles) {
          const plateMatch = DuplicateDetectionService.comparePlates(cible, geoloc.objet);
          const phoneMatch = DuplicateDetectionService.comparePhoneNumbers(cible, geoloc.objet);
          if (plateMatch.score >= 0.5 || phoneMatch.score >= 0.5) {
            const dejaProlong = (geoloc.prolongationsHistory || []).some(p => {
              const dateDet = DuplicateDetectionService.compareDates(
                parsed.dateAutorisation, p.date, 'date prolongation'
              );
              return dateDet.score >= 0.7;
            });
            if (dejaProlong) {
              return `Prolongation déjà enregistrée pour ${geoloc.objet} (date ~${parsed.dateAutorisation})`;
            }
          }
        }
      }
    }

    return null;
  }

  /** Vérifie si deux ParsedActe représentent le même document */
  private static isSameActe(a: ParsedActe, b: ParsedActe): boolean {
    if (a.type !== b.type) return false;

    // Tolérance de date ±3 jours
    const dateMatch = DuplicateDetectionService.compareDates(
      a.dateAutorisation, b.dateAutorisation, 'date'
    );
    if (dateMatch.score < 0.5) return false;

    // Au moins une cible en commun (avec matching flou)
    for (const ca of a.cibles) {
      for (const cb of b.cibles) {
        // Match exact
        if (ca === cb) return true;

        // Match normalisé téléphone
        const na = this.normalizePhoneNumber(ca);
        const nb = this.normalizePhoneNumber(cb);
        if (na && nb && na === nb) return true;

        // Match flou téléphone
        const phoneMatch = DuplicateDetectionService.comparePhoneNumbers(ca, cb);
        if (phoneMatch.score >= 0.7) return true;

        // Match flou plaque
        const plateMatch = DuplicateDetectionService.comparePlates(ca, cb);
        if (plateMatch.score >= 0.7) return true;
      }
    }
    return false;
  }

  // ════════════════════════════════════════════════════════════
  // 14b. VÉRIFICATION DE LA CHAÎNE LÉGALE (documents manquants)
  // ════════════════════════════════════════════════════════════

  /**
   * Vérifie pour chaque acte existant si tous les documents légaux attendus
   * sont présents dans les documents scannés.
   *
   * Chaîne légale écoutes :
   *   Requête → Autorisation JLD initiale → [Requête prolongation → Autorisation prolongation] × N
   *
   * Chaîne légale géolocs :
   *   Autorisation procureur initiale → [Requête JLD prolongation → Autorisation JLD prolongation] × N
   */
  private static checkMissingDocuments(
    enquete: Enquete,
    allParsedDocuments: ParsedActe[]
  ): AlerteDocumentManquant[] {
    const alertes: AlerteDocumentManquant[] = [];

    // ── Helper : vérifier si un document de type donné existe pour un acte ──
    const hasDocument = (
      acteType: 'ecoute' | 'geoloc',
      acteIdentifier: string, // numéro pour écoute, objet pour géoloc
      docType: DocumentType,
      targetDate?: string // date attendue (pour les prolongations)
    ): boolean => {
      return allParsedDocuments.some(doc => {
        if (doc.type !== docType) return false;

        // Vérifier que la cible correspond
        let cibleMatch = false;
        for (const cible of doc.cibles) {
          if (acteType === 'ecoute') {
            const phoneMatch = DuplicateDetectionService.comparePhoneNumbers(cible, acteIdentifier);
            if (phoneMatch.score >= 0.5) { cibleMatch = true; break; }
          } else {
            const plateMatch = DuplicateDetectionService.comparePlates(cible, acteIdentifier);
            if (plateMatch.score >= 0.5) { cibleMatch = true; break; }
            const phoneMatch = DuplicateDetectionService.comparePhoneNumbers(cible, acteIdentifier);
            if (phoneMatch.score >= 0.5) { cibleMatch = true; break; }
            const vehicleMatch = DuplicateDetectionService.compareVehicleDescriptions(cible, acteIdentifier);
            if (vehicleMatch.score >= 0.4) { cibleMatch = true; break; }
          }
        }
        if (!cibleMatch) return false;

        // Si une date cible est spécifiée, vérifier la proximité
        if (targetDate) {
          const dateMatch = DuplicateDetectionService.compareDates(
            doc.dateAutorisation, targetDate, 'date'
          );
          return dateMatch.score >= 0.5;
        }

        return true;
      });
    };

    // ── Vérifier les écoutes ──
    for (let i = 0; i < (enquete.ecoutes || []).length; i++) {
      const ecoute = enquete.ecoutes![i];
      const label = `Écoute ${ecoute.numero}${ecoute.cible ? ` (${ecoute.cible})` : ''}`;

      // 1. Requête initiale (requete_ecoute)
      if (!hasDocument('ecoute', ecoute.numero, 'requete_ecoute', ecoute.dateDebut)) {
        alertes.push({
          acteType: 'ecoute',
          acteIndex: i,
          acteLabel: label,
          documentManquant: 'Requête initiale au JLD',
          severite: 'warning',
        });
      }

      // 2. Autorisation initiale JLD (autorisation_initiale_ecoute)
      if (!hasDocument('ecoute', ecoute.numero, 'autorisation_initiale_ecoute', ecoute.dateDebut)) {
        alertes.push({
          acteType: 'ecoute',
          acteIndex: i,
          acteLabel: label,
          documentManquant: 'Autorisation JLD initiale',
          severite: 'error',
        });
      }

      // 3. Pour chaque prolongation enregistrée
      const prolongations = ecoute.prolongationsHistory || [];
      for (let p = 0; p < prolongations.length; p++) {
        const prolong = prolongations[p];
        const prolongLabel = `Prolongation ${p + 1} (${prolong.date})`;

        // Requête de prolongation
        if (!hasDocument('ecoute', ecoute.numero, 'requete_ecoute', prolong.date)) {
          alertes.push({
            acteType: 'ecoute',
            acteIndex: i,
            acteLabel: label,
            documentManquant: `Requête de ${prolongLabel}`,
            severite: 'warning',
          });
        }

        // Autorisation de prolongation
        if (!hasDocument('ecoute', ecoute.numero, 'prolongation_ecoute', prolong.date)) {
          alertes.push({
            acteType: 'ecoute',
            acteIndex: i,
            acteLabel: label,
            documentManquant: `Autorisation JLD de ${prolongLabel}`,
            severite: 'error',
          });
        }
      }
    }

    // ── Vérifier les géolocs ──
    for (let i = 0; i < (enquete.geolocalisations || []).length; i++) {
      const geoloc = enquete.geolocalisations![i];
      const label = `Géoloc ${geoloc.objet}`;

      // 1. Autorisation initiale procureur (autorisation_initiale_geoloc)
      if (!hasDocument('geoloc', geoloc.objet, 'autorisation_initiale_geoloc', geoloc.dateDebut)) {
        alertes.push({
          acteType: 'geoloc',
          acteIndex: i,
          acteLabel: label,
          documentManquant: 'Autorisation initiale du procureur',
          severite: 'error',
        });
      }

      // 2. Pour chaque prolongation enregistrée
      const prolongations = geoloc.prolongationsHistory || [];
      for (let p = 0; p < prolongations.length; p++) {
        const prolong = prolongations[p];
        const prolongLabel = `Prolongation ${p + 1} (${prolong.date})`;

        // Requête au JLD pour prolongation
        if (!hasDocument('geoloc', geoloc.objet, 'requete_geoloc', prolong.date)) {
          alertes.push({
            acteType: 'geoloc',
            acteIndex: i,
            acteLabel: label,
            documentManquant: `Requête JLD de ${prolongLabel}`,
            severite: 'warning',
          });
        }

        // Autorisation JLD de prolongation
        if (!hasDocument('geoloc', geoloc.objet, 'prolongation_geoloc', prolong.date)) {
          alertes.push({
            acteType: 'geoloc',
            acteIndex: i,
            acteLabel: label,
            documentManquant: `Autorisation JLD de ${prolongLabel}`,
            severite: 'error',
          });
        }
      }
    }

    return alertes;
  }

  // ════════════════════════════════════════════════════════════
  // 14c. VÉRIFICATION COMPLÈTE (doublons + corrections)
  // ════════════════════════════════════════════════════════════

  /**
   * Effectue une vérification complète des actes parsés contre les actes existants.
   * Retourne un résultat classé avec doublons, probables, corrections et nouveaux.
   * Utilisé par le modal de vérification.
   */
  static verifyActes(
    parsedActes: ParsedActe[],
    enquete: Enquete
  ): VerificationResult {
    return DuplicateDetectionService.verifyAgainstExisting(parsedActes, enquete);
  }

  // ════════════════════════════════════════════════════════════
  // 15. CRÉATION D'ACTES À PARTIR DES RÉSULTATS VALIDÉS
  // ════════════════════════════════════════════════════════════

  /**
   * Crée les actes dans l'enquête à partir des résultats validés par l'utilisateur.
   * Retourne les mises à jour à appliquer à l'enquête.
   */
  static createActesFromValidated(
    validatedActes: ParsedActe[],
    enquete: Enquete
  ): Partial<Enquete> {
    const newEcoutes: EcouteData[] = [...(enquete.ecoutes || [])];
    const newGeolocs: GeolocData[] = [...(enquete.geolocalisations || [])];
    const updates: Partial<Enquete> = {};

    for (const acte of validatedActes) {
      switch (acte.type) {
        case 'autorisation_initiale_ecoute': {
          for (const cible of acte.cibles) {
            const normalized = this.normalizePhoneNumber(cible);
            if (!normalized) continue;

            const newEcoute: EcouteData = {
              id: Date.now() + Math.floor(Math.random() * 1000),
              numero: normalized,
              cible: acte.utilisateur || acte.titulaire || '',
              description: acte.titulaire ? `Titulaire : ${acte.titulaire}` : '',
              dateDebut: acte.dateAutorisation,
              dateFin: '', // Sera calculé à la pose
              duree: acte.duree,
              dureeUnit: acte.dureeUnit,
              maxProlongations: 1,
              // Date de pose = date d'autorisation (car pas de date de pose dans le PDF)
              datePose: acte.dateAutorisation,
              statut: 'en_cours',
              prolongationsHistory: []
            };

            // Calculer la date de fin
            newEcoute.dateFin = this.calculateEndDate(
              acte.dateAutorisation, acte.duree, acte.dureeUnit
            );

            newEcoutes.push(newEcoute);
          }
          break;
        }

        case 'autorisation_initiale_geoloc': {
          for (const cible of acte.cibles) {
            const newGeoloc: GeolocData = {
              id: Date.now() + Math.floor(Math.random() * 1000),
              objet: acte.objetDescription || cible,
              description: '',
              dateDebut: acte.dateAutorisation,
              dateFin: '',
              duree: acte.duree,
              dureeUnit: acte.dureeUnit,
              maxProlongations: -1, // Pas de limite stricte pour géoloc
              datePose: acte.dateAutorisation,
              statut: 'en_cours',
              prolongationsHistory: []
            };

            newGeoloc.dateFin = this.calculateEndDate(
              acte.dateAutorisation, acte.duree, acte.dureeUnit
            );

            newGeolocs.push(newGeoloc);
          }
          break;
        }

        case 'prolongation_ecoute': {
          for (const cible of acte.cibles) {
            const normalized = this.normalizePhoneNumber(cible);
            if (!normalized) continue;

            // Chercher l'écoute existante
            const existingIndex = newEcoutes.findIndex(e =>
              this.normalizePhoneNumber(e.numero) === normalized
            );

            if (existingIndex >= 0) {
              // Appliquer la prolongation
              const existing = { ...newEcoutes[existingIndex] };
              const history: ProlongationHistoryEntry = {
                date: acte.dateAutorisation,
                dureeAjoutee: acte.duree,
                dureeInitiale: existing.duree,
                dureeUnit: acte.dureeUnit
              };

              existing.prolongationsHistory = [...(existing.prolongationsHistory || []), history];

              // Calculer la nouvelle date de fin depuis l'ancienne date de fin
              const currentEndDate = existing.dateFin || existing.dateDebut;
              existing.dateFin = this.calculateEndDate(
                currentEndDate, acte.duree, acte.dureeUnit
              );
              existing.duree = (parseInt(existing.duree) + parseInt(acte.duree)).toString();
              existing.statut = 'en_cours';
              existing.prolongationData = undefined;

              newEcoutes[existingIndex] = existing;
            } else {
              // Pas d'écoute initiale trouvée → créer l'acte complet
              // On utilise la date d'autorisation initiale si disponible
              const dateDebut = acte.dateAutorisationInitiale || acte.dateAutorisation;

              const newEcoute: EcouteData = {
                id: Date.now() + Math.floor(Math.random() * 1000),
                numero: normalized,
                cible: acte.utilisateur || acte.titulaire || '',
                description: `Créé depuis prolongation (initiale non trouvée)`,
                dateDebut: dateDebut,
                dateFin: '',
                duree: acte.duree,
                dureeUnit: acte.dureeUnit,
                maxProlongations: 1,
                datePose: dateDebut,
                statut: 'en_cours',
                prolongationsHistory: [{
                  date: acte.dateAutorisation,
                  dureeAjoutee: acte.duree,
                  dureeInitiale: acte.dureeInitiale || '1',
                  dureeUnit: acte.dureeUnit
                }]
              };

              // Calculer la durée totale initiale + prolongation
              const dureeInitiale = acte.dureeInitiale ? parseInt(acte.dureeInitiale) :
                (acte.dureeUnit === 'mois' ? 1 : 15);
              newEcoute.duree = (dureeInitiale + parseInt(acte.duree)).toString();

              // Date de fin = date début initiale + durée initiale + prolongation
              const endInitiale = this.calculateEndDate(dateDebut, dureeInitiale.toString(), acte.dureeUnit);
              newEcoute.dateFin = this.calculateEndDate(endInitiale, acte.duree, acte.dureeUnit);

              newEcoutes.push(newEcoute);
            }
          }
          break;
        }

        case 'prolongation_geoloc': {
          for (const cible of acte.cibles) {
            // Chercher la géoloc existante par plaque ou numéro
            const existingIndex = newGeolocs.findIndex(g => {
              // Comparer les plaques
              const plaqueActe = cible.match(/([A-Z]{2}[- ]?\d{3}[- ]?[A-Z]{2})/);
              const plaqueExist = g.objet.match(/([A-Z]{2}[- ]?\d{3}[- ]?[A-Z]{2})/);
              if (plaqueActe && plaqueExist) {
                return plaqueActe[1].replace(/[- ]/g, '') === plaqueExist[1].replace(/[- ]/g, '');
              }
              // Comparer les numéros de téléphone
              const phoneCible = this.normalizePhoneNumber(cible);
              const phoneGeoloc = this.normalizePhoneNumber(g.objet);
              return phoneCible && phoneGeoloc && phoneCible === phoneGeoloc;
            });

            if (existingIndex >= 0) {
              const existing = { ...newGeolocs[existingIndex] };
              const history: ProlongationHistoryEntry = {
                date: acte.dateAutorisation,
                dureeAjoutee: acte.duree,
                dureeInitiale: existing.duree,
                dureeUnit: acte.dureeUnit
              };

              existing.prolongationsHistory = [...(existing.prolongationsHistory || []), history];
              const currentEndDate = existing.dateFin || existing.dateDebut;
              existing.dateFin = this.calculateEndDate(currentEndDate, acte.duree, acte.dureeUnit);
              existing.duree = (parseInt(existing.duree) + parseInt(acte.duree)).toString();
              existing.statut = 'en_cours';
              existing.prolongationData = undefined;

              newGeolocs[existingIndex] = existing;
            } else {
              // Créer l'acte complet avec prolongation intégrée
              const dateDebut = acte.dateAutorisationInitiale || acte.dateAutorisation;

              const newGeoloc: GeolocData = {
                id: Date.now() + Math.floor(Math.random() * 1000),
                objet: acte.objetDescription || cible,
                description: `Créé depuis prolongation (initiale non trouvée)`,
                dateDebut: dateDebut,
                dateFin: '',
                duree: acte.duree,
                dureeUnit: acte.dureeUnit,
                maxProlongations: -1,
                datePose: dateDebut,
                statut: 'en_cours',
                prolongationsHistory: [{
                  date: acte.dateAutorisation,
                  dureeAjoutee: acte.duree,
                  dureeInitiale: acte.dureeInitiale || '15',
                  dureeUnit: acte.dureeUnit
                }]
              };

              const dureeInitiale = acte.dureeInitiale ? parseInt(acte.dureeInitiale) :
                (acte.dureeUnit === 'mois' ? 1 : 15);
              newGeoloc.duree = (dureeInitiale + parseInt(acte.duree)).toString();
              const endInitiale = this.calculateEndDate(dateDebut, dureeInitiale.toString(), acte.dureeUnit);
              newGeoloc.dateFin = this.calculateEndDate(endInitiale, acte.duree, acte.dureeUnit);

              newGeolocs.push(newGeoloc);
            }
          }
          break;
        }

        // Les requêtes ne créent pas d'actes directement
        case 'requete_ecoute':
        case 'requete_geoloc':
          // On peut les stocker comme notes ou les ignorer
          break;
      }
    }

    if (newEcoutes.length !== (enquete.ecoutes || []).length ||
        JSON.stringify(newEcoutes) !== JSON.stringify(enquete.ecoutes || [])) {
      updates.ecoutes = newEcoutes;
    }
    if (newGeolocs.length !== (enquete.geolocalisations || []).length ||
        JSON.stringify(newGeolocs) !== JSON.stringify(enquete.geolocalisations || [])) {
      updates.geolocalisations = newGeolocs;
    }

    return updates;
  }

  // ════════════════════════════════════════════════════════════
  // UTILITAIRES
  // ════════════════════════════════════════════════════════════

  /**
   * Corrige les confusions OCR courantes dans les contextes numériques.
   * Ex: 'o'/'O' → '0', 'l'/'I' → '1', 'S' → '5', 'B' → '8'
   */
  private static fixOcrDigits(input: string): string {
    return input
      .replace(/[oO]/g, '0')
      .replace(/[lI]/g, '1')
      .replace(/S/g, '5')
      .replace(/B/g, '8');
  }

  private static normalizePhoneNumber(input: string): string {
    if (!input) return '';
    // Appliquer la correction OCR avant de normaliser
    const fixed = this.fixOcrDigits(input);
    const digits = fixed.replace(/\D/g, '');
    if (digits.length === 10) {
      return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}.${digits.slice(8, 10)}`;
    }
    return '';
  }

  private static formatFrenchDate(day: string, month: string, year: string): string {
    const monthNorm = month.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const monthNum = MOIS_FR[monthNorm] || MOIS_FR[month.toLowerCase()];
    if (!monthNum) return '';
    return `${year}-${monthNum}-${day.padStart(2, '0')}`;
  }

  private static calculateEndDate(startDate: string, duree: string, unit: 'jours' | 'mois'): string {
    try {
      const [year, month, day] = startDate.split('-').map(Number);
      const date = new Date(year, month - 1, day);

      if (unit === 'mois') {
        date.setMonth(date.getMonth() + parseInt(duree));
      } else {
        date.setDate(date.getDate() + parseInt(duree));
      }

      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    } catch {
      return startDate;
    }
  }

  private static calculateConfidence(
    type: DocumentType,
    cibles: string[],
    dateAutorisation: string | undefined,
    duree: string,
    autorite: Autorite
  ): number {
    let confidence = 0.3;

    // Type reconnu
    if (type !== 'autre') confidence += 0.2;

    // Cibles trouvées
    if (cibles.length > 0) confidence += 0.2;
    if (cibles.length > 1) confidence += 0.05;

    // Date d'autorisation trouvée
    if (dateAutorisation) confidence += 0.15;

    // Durée extraite (pas la valeur par défaut)
    if (duree) confidence += 0.1;

    // Cohérence type/autorité
    if ((type.includes('prolongation') && autorite === 'jld') ||
        (type === 'autorisation_initiale_geoloc' && autorite === 'procureur') ||
        (type === 'autorisation_initiale_ecoute' && autorite === 'jld')) {
      confidence += 0.05;
    }

    return Math.min(confidence, 0.98);
  }
}
