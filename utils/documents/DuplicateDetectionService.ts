// utils/documents/DuplicateDetectionService.ts
// Service de détection avancée de doublons avec matching flou
// Gère les variations humaines : formats téléphone, plaques, dates ±N jours

import { Enquete, EcouteData, GeolocData } from '@/types/interfaces';
import { ParsedActe } from './ServerDocumentScanner';

// ─── Types ───

export interface DuplicateMatch {
  /** Acte existant dans l'enquête qui matche */
  existingType: 'ecoute' | 'geoloc';
  /** Index dans le tableau existant */
  existingIndex: number;
  /** Données existantes */
  existingData: EcouteData | GeolocData;
  /** Score de similarité (0-1) */
  similarity: number;
  /** Détail des correspondances trouvées */
  matchDetails: MatchDetail[];
  /** Divergences détectées (corrections potentielles) */
  divergences: Divergence[];
  /** Suggestion d'action */
  suggestion: 'doublon_exact' | 'doublon_probable' | 'correction_possible' | 'acte_different';
}

export interface MatchDetail {
  field: string;
  label: string;
  parsedValue: string;
  existingValue: string;
  matchType: 'exact' | 'normalized' | 'partial' | 'fuzzy' | 'mismatch';
  score: number;
}

export interface Divergence {
  field: string;
  label: string;
  existingValue: string;
  parsedValue: string;
  /** Quelle valeur semble plus correcte */
  recommendation: 'keep_existing' | 'use_parsed' | 'review';
  reason: string;
}

export interface VerificationResult {
  /** Actes parsés qui sont des doublons confirmés */
  doublonsConfirmes: { parsed: ParsedActe; match: DuplicateMatch }[];
  /** Actes parsés qui ressemblent à des existants (doublons probables) */
  doublonsProbables: { parsed: ParsedActe; match: DuplicateMatch }[];
  /** Corrections suggérées pour les actes existants */
  corrections: CorrectionSuggestion[];
  /** Actes parsés qui sont vraiment nouveaux */
  nouveaux: ParsedActe[];
}

export interface CorrectionSuggestion {
  /** Type d'acte existant */
  acteType: 'ecoute' | 'geoloc';
  /** Index dans le tableau existant */
  acteIndex: number;
  /** Données existantes */
  existingData: EcouteData | GeolocData;
  /** Document source de la correction */
  sourceDocument: string;
  /** Corrections proposées */
  corrections: Divergence[];
}

// ─── Seuils de matching ───

const THRESHOLDS = {
  /** Au-dessus = doublon confirmé */
  DOUBLON_EXACT: 0.85,
  /** Au-dessus = doublon probable */
  DOUBLON_PROBABLE: 0.55,
  /** Tolérance de date en jours */
  DATE_TOLERANCE_DAYS: 3,
  /** Poids de chaque critère dans le score */
  WEIGHTS: {
    cible: 0.45,    // Le plus important : même cible (tel/plaque)
    type: 0.15,     // Même type d'acte
    date: 0.30,     // Même date d'autorisation (avec tolérance)
    details: 0.10,  // Détails supplémentaires (tribunal, durée)
  }
};

// ─── Service principal ───

export class DuplicateDetectionService {

  // ════════════════════════════════════════════════════════════
  // 1. POINT D'ENTRÉE : VÉRIFICATION COMPLÈTE
  // ════════════════════════════════════════════════════════════

  /**
   * Analyse une liste d'actes parsés contre les actes existants de l'enquête.
   * Retourne un résultat classé : doublons, probables, corrections, nouveaux.
   */
  static verifyAgainstExisting(
    parsedActes: ParsedActe[],
    enquete: Enquete
  ): VerificationResult {
    const result: VerificationResult = {
      doublonsConfirmes: [],
      doublonsProbables: [],
      corrections: [],
      nouveaux: [],
    };

    // Collecter les corrections par acte existant (pour éviter les doublons de suggestion)
    const correctionsMap = new Map<string, CorrectionSuggestion>();

    for (const parsed of parsedActes) {
      const bestMatch = this.findBestMatch(parsed, enquete);

      if (!bestMatch) {
        result.nouveaux.push(parsed);
        continue;
      }

      if (bestMatch.suggestion === 'doublon_exact') {
        result.doublonsConfirmes.push({ parsed, match: bestMatch });
      } else if (bestMatch.suggestion === 'doublon_probable') {
        result.doublonsProbables.push({ parsed, match: bestMatch });
      } else if (bestMatch.suggestion === 'correction_possible') {
        result.doublonsProbables.push({ parsed, match: bestMatch });
      } else {
        result.nouveaux.push(parsed);
      }

      // Collecter les corrections si l'acte existe et a des divergences
      if (bestMatch.divergences.length > 0 &&
          bestMatch.similarity >= THRESHOLDS.DOUBLON_PROBABLE) {
        const key = `${bestMatch.existingType}_${bestMatch.existingIndex}`;
        if (!correctionsMap.has(key)) {
          correctionsMap.set(key, {
            acteType: bestMatch.existingType,
            acteIndex: bestMatch.existingIndex,
            existingData: bestMatch.existingData,
            sourceDocument: parsed.source.fileName,
            corrections: bestMatch.divergences,
          });
        }
      }
    }

    result.corrections = Array.from(correctionsMap.values());
    return result;
  }

  // ════════════════════════════════════════════════════════════
  // 2. RECHERCHE DU MEILLEUR MATCH
  // ════════════════════════════════════════════════════════════

  /**
   * Cherche le meilleur match pour un acte parsé parmi les actes existants.
   */
  static findBestMatch(parsed: ParsedActe, enquete: Enquete): DuplicateMatch | null {
    let bestMatch: DuplicateMatch | null = null;
    let bestScore = 0;

    // Comparer avec les écoutes existantes (y compris les requêtes — une requête JLD
    // pour un numéro déjà en écoute est le document d'autorisation initiale, pas un nouvel acte)
    if (parsed.type.includes('ecoute')) {
      for (let i = 0; i < (enquete.ecoutes || []).length; i++) {
        const ecoute = enquete.ecoutes![i];
        const match = this.compareWithEcoute(parsed, ecoute, i);
        if (match && match.similarity > bestScore) {
          bestScore = match.similarity;
          bestMatch = match;
        }
      }
    }

    // Comparer avec les géolocs existantes (idem pour les requêtes géoloc)
    if (parsed.type.includes('geoloc')) {
      for (let i = 0; i < (enquete.geolocalisations || []).length; i++) {
        const geoloc = enquete.geolocalisations![i];
        const match = this.compareWithGeoloc(parsed, geoloc, i);
        if (match && match.similarity > bestScore) {
          bestScore = match.similarity;
          bestMatch = match;
        }
      }
    }

    return bestMatch;
  }

  // ════════════════════════════════════════════════════════════
  // 3. COMPARAISON AVEC UNE ÉCOUTE EXISTANTE
  // ════════════════════════════════════════════════════════════

  private static compareWithEcoute(
    parsed: ParsedActe,
    ecoute: EcouteData,
    index: number
  ): DuplicateMatch | null {
    const matchDetails: MatchDetail[] = [];
    const divergences: Divergence[] = [];

    // ── Score cible (numéro de téléphone) ──
    let cibleScore = 0;
    let bestCibleDetail: MatchDetail | null = null;

    for (const cible of parsed.cibles) {
      const detail = this.comparePhoneNumbers(cible, ecoute.numero);
      if (detail.score > cibleScore) {
        cibleScore = detail.score;
        bestCibleDetail = detail;
      }
    }

    if (bestCibleDetail) {
      matchDetails.push(bestCibleDetail);
    } else {
      matchDetails.push({
        field: 'cible',
        label: 'Numéro de téléphone',
        parsedValue: parsed.cibles.join(', ') || '(aucun)',
        existingValue: ecoute.numero,
        matchType: 'mismatch',
        score: 0,
      });
    }

    // Si aucune correspondance de cible du tout, pas la peine de continuer
    if (cibleScore === 0) return null;

    // ── Divergence numéro : le document a un numéro plus complet que l'existant ──
    if (bestCibleDetail && bestCibleDetail.matchType !== 'exact' && bestCibleDetail.score >= 0.5) {
      // Vérifier si le document fournit un numéro plus complet (ex: "14 21" → "07.49.03.14.21")
      const parsedDigits = this.extractAllDigits(bestCibleDetail.parsedValue);
      const existingDigits = this.extractAllDigits(ecoute.numero);

      if (parsedDigits.length > existingDigits.length) {
        // Le document a plus de chiffres → proposer l'enrichissement
        const parsedFull = this.extractFullPhone(bestCibleDetail.parsedValue);
        if (parsedFull) {
          const formatted = parsedFull.replace(/(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1.$2.$3.$4.$5');
          divergences.push({
            field: 'numero',
            label: 'Numéro de téléphone',
            existingValue: ecoute.numero,
            parsedValue: formatted,
            recommendation: 'use_parsed',
            reason: `Le numéro enregistré (${ecoute.numero}) est partiel. Le document contient le numéro complet : ${formatted}.`,
          });
        }
      }
    }

    // ── Score type ──
    const typeScore = this.compareActeTypes(parsed.type, 'ecoute', ecoute);
    matchDetails.push({
      field: 'type',
      label: 'Type d\'acte',
      parsedValue: parsed.type,
      existingValue: 'ecoute',
      matchType: typeScore >= 0.8 ? 'exact' : typeScore > 0 ? 'fuzzy' : 'mismatch',
      score: typeScore,
    });

    // ── Score date ──
    const dateDetail = this.compareDates(parsed.dateAutorisation, ecoute.dateDebut, 'Date d\'autorisation');
    matchDetails.push(dateDetail);

    // Divergence de date : si proche mais pas identique
    if (dateDetail.score > 0.3 && dateDetail.score < 1.0 && dateDetail.matchType !== 'exact') {
      divergences.push({
        field: 'dateDebut',
        label: 'Date d\'autorisation',
        existingValue: ecoute.dateDebut,
        parsedValue: parsed.dateAutorisation,
        recommendation: 'review',
        reason: `Date enregistrée (${ecoute.dateDebut}) diffère de la date sur le document (${parsed.dateAutorisation}). ` +
                `Possible confusion entre date de réception et date d'autorisation.`,
      });
    }

    // ── Score détails ──
    let detailScore = 0.5; // Base
    if (parsed.tribunal && ecoute.description?.toUpperCase().includes(parsed.tribunal.toUpperCase())) {
      detailScore += 0.25;
    }
    if (parsed.duree === ecoute.duree) {
      detailScore += 0.25;
    }
    matchDetails.push({
      field: 'details',
      label: 'Détails (tribunal, durée)',
      parsedValue: `${parsed.tribunal || '?'}, ${parsed.duree} ${parsed.dureeUnit}`,
      existingValue: `${ecoute.description || '?'}, ${ecoute.duree} ${ecoute.dureeUnit || 'jours'}`,
      matchType: detailScore >= 0.8 ? 'exact' : 'fuzzy',
      score: detailScore,
    });

    // ── Score global pondéré ──
    const similarity =
      cibleScore * THRESHOLDS.WEIGHTS.cible +
      typeScore * THRESHOLDS.WEIGHTS.type +
      dateDetail.score * THRESHOLDS.WEIGHTS.date +
      detailScore * THRESHOLDS.WEIGHTS.details;

    // ── Déterminer la suggestion ──
    let suggestion: DuplicateMatch['suggestion'];
    if (similarity >= THRESHOLDS.DOUBLON_EXACT) {
      suggestion = 'doublon_exact';
    } else if (similarity >= THRESHOLDS.DOUBLON_PROBABLE) {
      suggestion = divergences.length > 0 ? 'correction_possible' : 'doublon_probable';
    } else if (cibleScore >= 0.5) {
      // Même cible mais le reste diffère → peut-être un autre acte pour la même cible
      suggestion = 'acte_different';
    } else {
      suggestion = 'acte_different';
    }

    return {
      existingType: 'ecoute',
      existingIndex: index,
      existingData: ecoute,
      similarity,
      matchDetails,
      divergences,
      suggestion,
    };
  }

  // ════════════════════════════════════════════════════════════
  // 4. COMPARAISON AVEC UNE GÉOLOC EXISTANTE
  // ════════════════════════════════════════════════════════════

  private static compareWithGeoloc(
    parsed: ParsedActe,
    geoloc: GeolocData,
    index: number
  ): DuplicateMatch | null {
    const matchDetails: MatchDetail[] = [];
    const divergences: Divergence[] = [];

    // ── Score cible (véhicule/plaque ou téléphone) ──
    let cibleScore = 0;
    let bestCibleDetail: MatchDetail | null = null;

    for (const cible of parsed.cibles) {
      // Essayer la comparaison par plaque
      const plaqueDetail = this.comparePlates(cible, geoloc.objet);
      if (plaqueDetail.score > cibleScore) {
        cibleScore = plaqueDetail.score;
        bestCibleDetail = plaqueDetail;
      }

      // Essayer la comparaison par téléphone (géoloc sur ligne)
      const phoneDetail = this.comparePhoneNumbers(cible, geoloc.objet);
      if (phoneDetail.score > cibleScore) {
        cibleScore = phoneDetail.score;
        bestCibleDetail = phoneDetail;
      }

      // Essayer la comparaison par mots-clés véhicule
      const vehicleDetail = this.compareVehicleDescriptions(cible, geoloc.objet);
      if (vehicleDetail.score > cibleScore) {
        cibleScore = vehicleDetail.score;
        bestCibleDetail = vehicleDetail;
      }
    }

    if (bestCibleDetail) {
      matchDetails.push(bestCibleDetail);
    } else {
      matchDetails.push({
        field: 'cible',
        label: 'Véhicule / plaque',
        parsedValue: parsed.cibles.join(', ') || '(aucun)',
        existingValue: geoloc.objet,
        matchType: 'mismatch',
        score: 0,
      });
    }

    // Si aucune correspondance de cible, pas de match possible
    if (cibleScore === 0) return null;

    // ── Divergence objet : le document a une description plus complète ──
    if (bestCibleDetail && bestCibleDetail.matchType !== 'exact' && bestCibleDetail.score >= 0.5) {
      const parsedDesc = parsed.objetDescription || parsed.cibles.join(', ');
      if (parsedDesc && parsedDesc.length > geoloc.objet.length) {
        divergences.push({
          field: 'objet',
          label: 'Description / objet',
          existingValue: geoloc.objet,
          parsedValue: parsedDesc,
          recommendation: 'use_parsed',
          reason: `La description enregistrée (${geoloc.objet}) est moins complète que celle du document (${parsedDesc}).`,
        });
      }
    }

    // ── Score type ──
    const typeScore = this.compareActeTypes(parsed.type, 'geoloc', geoloc);
    matchDetails.push({
      field: 'type',
      label: 'Type d\'acte',
      parsedValue: parsed.type,
      existingValue: 'geoloc',
      matchType: typeScore >= 0.8 ? 'exact' : typeScore > 0 ? 'fuzzy' : 'mismatch',
      score: typeScore,
    });

    // ── Score date ──
    const dateDetail = this.compareDates(parsed.dateAutorisation, geoloc.dateDebut, 'Date d\'autorisation');
    matchDetails.push(dateDetail);

    if (dateDetail.score > 0.3 && dateDetail.score < 1.0 && dateDetail.matchType !== 'exact') {
      divergences.push({
        field: 'dateDebut',
        label: 'Date d\'autorisation',
        existingValue: geoloc.dateDebut,
        parsedValue: parsed.dateAutorisation,
        recommendation: 'review',
        reason: `Date enregistrée (${geoloc.dateDebut}) diffère de la date sur le document (${parsed.dateAutorisation}). ` +
                `Possible confusion entre date de réception et date d'autorisation.`,
      });
    }

    // ── Score détails ──
    let detailScore = 0.5;
    if (parsed.duree === geoloc.duree) detailScore += 0.25;
    if (parsed.dureeUnit === (geoloc.dureeUnit || 'jours')) detailScore += 0.25;

    matchDetails.push({
      field: 'details',
      label: 'Détails (durée)',
      parsedValue: `${parsed.duree} ${parsed.dureeUnit}`,
      existingValue: `${geoloc.duree} ${geoloc.dureeUnit || 'jours'}`,
      matchType: detailScore >= 0.8 ? 'exact' : 'fuzzy',
      score: detailScore,
    });

    // ── Score global ──
    const similarity =
      cibleScore * THRESHOLDS.WEIGHTS.cible +
      typeScore * THRESHOLDS.WEIGHTS.type +
      dateDetail.score * THRESHOLDS.WEIGHTS.date +
      detailScore * THRESHOLDS.WEIGHTS.details;

    let suggestion: DuplicateMatch['suggestion'];
    if (similarity >= THRESHOLDS.DOUBLON_EXACT) {
      suggestion = 'doublon_exact';
    } else if (similarity >= THRESHOLDS.DOUBLON_PROBABLE) {
      suggestion = divergences.length > 0 ? 'correction_possible' : 'doublon_probable';
    } else if (cibleScore >= 0.5) {
      suggestion = 'acte_different';
    } else {
      suggestion = 'acte_different';
    }

    return {
      existingType: 'geoloc',
      existingIndex: index,
      existingData: geoloc,
      similarity,
      matchDetails,
      divergences,
      suggestion,
    };
  }

  // ════════════════════════════════════════════════════════════
  // 5. COMPARAISON FLOUE DE NUMÉROS DE TÉLÉPHONE
  // ════════════════════════════════════════════════════════════

  /**
   * Compare deux chaînes pouvant contenir des numéros de téléphone.
   * Gère tous les formats :
   * - "07-73-15-76-90", "0773157690", "07.73.15.76.90"
   * - "76 90" (juste les 4 derniers)
   * - "76.90" (4 derniers avec point)
   * - "07.73.15.76.90 + observations inutiles"
   */
  static comparePhoneNumbers(a: string, b: string): MatchDetail {
    const digitsA = this.extractAllDigits(a);
    const digitsB = this.extractAllDigits(b);

    // Si l'un des deux n'a aucun chiffre, pas de match
    if (digitsA.length === 0 || digitsB.length === 0) {
      return {
        field: 'cible',
        label: 'Numéro de téléphone',
        parsedValue: a,
        existingValue: b,
        matchType: 'mismatch',
        score: 0,
      };
    }

    // ── Match exact normalisé (10 chiffres == 10 chiffres) ──
    const fullA = this.extractFullPhone(a);
    const fullB = this.extractFullPhone(b);

    if (fullA && fullB && fullA === fullB) {
      return {
        field: 'cible',
        label: 'Numéro de téléphone',
        parsedValue: a,
        existingValue: b,
        matchType: 'exact',
        score: 1.0,
      };
    }

    // ── Match par les N derniers chiffres ──
    // Si un côté n'a que 2-4 chiffres (saisie partielle), comparer avec la fin de l'autre
    const shortDigits = digitsA.length <= digitsB.length ? digitsA : digitsB;
    const longDigits = digitsA.length <= digitsB.length ? digitsB : digitsA;

    if (shortDigits.length >= 2 && shortDigits.length <= 6 && longDigits.length >= 6) {
      // Vérifier si les chiffres courts correspondent à la fin du numéro long
      if (longDigits.endsWith(shortDigits)) {
        // Plus les chiffres courts sont longs, plus le score est élevé
        const score = 0.5 + (shortDigits.length / 10) * 0.5;
        return {
          field: 'cible',
          label: 'Numéro de téléphone',
          parsedValue: a,
          existingValue: b,
          matchType: 'partial',
          score: Math.min(score, 0.9), // Jamais 1.0 pour un match partiel
        };
      }
    }

    // ── Match par les 4 derniers chiffres ──
    if (digitsA.length >= 4 && digitsB.length >= 4) {
      const last4A = digitsA.slice(-4);
      const last4B = digitsB.slice(-4);

      if (last4A === last4B) {
        // Les 4 derniers chiffres matchent
        // Plus il y a de chiffres qui matchent en remontant, plus le score est élevé
        let matchingFromEnd = 4;
        const minLen = Math.min(digitsA.length, digitsB.length);
        for (let i = 5; i <= minLen; i++) {
          if (digitsA[digitsA.length - i] === digitsB[digitsB.length - i]) {
            matchingFromEnd = i;
          } else {
            break;
          }
        }

        const score = 0.4 + (matchingFromEnd / 10) * 0.6;
        return {
          field: 'cible',
          label: 'Numéro de téléphone',
          parsedValue: a,
          existingValue: b,
          matchType: 'fuzzy',
          score: Math.min(score, 0.95),
        };
      }
    }

    // ── Match par les 2 derniers chiffres (très faible) ──
    if (digitsA.length >= 2 && digitsB.length >= 2) {
      const last2A = digitsA.slice(-2);
      const last2B = digitsB.slice(-2);
      if (last2A === last2B) {
        return {
          field: 'cible',
          label: 'Numéro de téléphone',
          parsedValue: a,
          existingValue: b,
          matchType: 'fuzzy',
          score: 0.2,
        };
      }
    }

    return {
      field: 'cible',
      label: 'Numéro de téléphone',
      parsedValue: a,
      existingValue: b,
      matchType: 'mismatch',
      score: 0,
    };
  }

  // ════════════════════════════════════════════════════════════
  // 6. COMPARAISON FLOUE DE PLAQUES D'IMMATRICULATION
  // ════════════════════════════════════════════════════════════

  /**
   * Compare deux chaînes pouvant contenir des plaques d'immatriculation.
   * Gère : "CF-554-GE", "CF554GE", "CF 554 GE", etc.
   */
  static comparePlates(a: string, b: string): MatchDetail {
    const plateA = this.extractPlate(a);
    const plateB = this.extractPlate(b);

    if (!plateA || !plateB) {
      return {
        field: 'cible',
        label: 'Plaque d\'immatriculation',
        parsedValue: a,
        existingValue: b,
        matchType: 'mismatch',
        score: 0,
      };
    }

    // Normaliser les plaques (supprimer espaces, tirets)
    const normA = plateA.replace(/[\s\-]/g, '').toUpperCase();
    const normB = plateB.replace(/[\s\-]/g, '').toUpperCase();

    if (normA === normB) {
      return {
        field: 'cible',
        label: 'Plaque d\'immatriculation',
        parsedValue: a,
        existingValue: b,
        matchType: 'normalized',
        score: 1.0,
      };
    }

    // Match partiel : 5 caractères sur 7 identiques en position
    let matching = 0;
    const len = Math.min(normA.length, normB.length);
    for (let i = 0; i < len; i++) {
      if (normA[i] === normB[i]) matching++;
    }
    if (len > 0 && matching / len >= 0.7) {
      return {
        field: 'cible',
        label: 'Plaque d\'immatriculation',
        parsedValue: a,
        existingValue: b,
        matchType: 'fuzzy',
        score: matching / Math.max(normA.length, normB.length),
      };
    }

    return {
      field: 'cible',
      label: 'Plaque d\'immatriculation',
      parsedValue: a,
      existingValue: b,
      matchType: 'mismatch',
      score: 0,
    };
  }

  // ════════════════════════════════════════════════════════════
  // 7. COMPARAISON DE DESCRIPTIONS DE VÉHICULE
  // ════════════════════════════════════════════════════════════

  /**
   * Compare des descriptions de véhicule par mots-clés.
   * "FORD Fiesta CF-554-GE" vs "ford fiesta" vs "CF554GE"
   */
  static compareVehicleDescriptions(a: string, b: string): MatchDetail {
    const wordsA = this.extractSignificantWords(a);
    const wordsB = this.extractSignificantWords(b);

    if (wordsA.length === 0 || wordsB.length === 0) {
      return {
        field: 'cible',
        label: 'Véhicule',
        parsedValue: a,
        existingValue: b,
        matchType: 'mismatch',
        score: 0,
      };
    }

    // Compter les mots en commun
    let commonWords = 0;
    for (const wa of wordsA) {
      for (const wb of wordsB) {
        if (wa === wb || (wa.length >= 3 && wb.length >= 3 && (wa.includes(wb) || wb.includes(wa)))) {
          commonWords++;
          break;
        }
      }
    }

    const totalUniqueWords = new Set([...wordsA, ...wordsB]).size;
    const score = totalUniqueWords > 0 ? commonWords / totalUniqueWords : 0;

    // Bonus si une plaque match
    const plateA = this.extractPlate(a);
    const plateB = this.extractPlate(b);
    let plateBonus = 0;
    if (plateA && plateB) {
      const normPA = plateA.replace(/[\s\-]/g, '').toUpperCase();
      const normPB = plateB.replace(/[\s\-]/g, '').toUpperCase();
      if (normPA === normPB) plateBonus = 0.5;
    }

    const finalScore = Math.min(score + plateBonus, 1.0);

    return {
      field: 'cible',
      label: 'Véhicule',
      parsedValue: a,
      existingValue: b,
      matchType: finalScore >= 0.8 ? 'normalized' : finalScore > 0.3 ? 'fuzzy' : 'mismatch',
      score: finalScore,
    };
  }

  // ════════════════════════════════════════════════════════════
  // 8. COMPARAISON DE DATES AVEC TOLÉRANCE
  // ════════════════════════════════════════════════════════════

  /**
   * Compare deux dates avec une tolérance de ±N jours.
   * Gère le cas où la date enregistrée est la date de réception
   * et pas la date d'autorisation (typiquement +1 jour).
   */
  static compareDates(dateA: string, dateB: string, label: string): MatchDetail {
    if (!dateA || !dateB) {
      return {
        field: 'date',
        label,
        parsedValue: dateA || '(non détectée)',
        existingValue: dateB || '(non renseignée)',
        matchType: 'mismatch',
        score: 0,
      };
    }

    // Match exact
    if (dateA === dateB) {
      return {
        field: 'date',
        label,
        parsedValue: dateA,
        existingValue: dateB,
        matchType: 'exact',
        score: 1.0,
      };
    }

    // Calculer la différence en jours
    const diff = this.dateDiffDays(dateA, dateB);

    if (diff <= THRESHOLDS.DATE_TOLERANCE_DAYS) {
      // Plus la différence est petite, plus le score est élevé
      const score = 1.0 - (diff / (THRESHOLDS.DATE_TOLERANCE_DAYS + 1)) * 0.5;
      return {
        field: 'date',
        label,
        parsedValue: dateA,
        existingValue: dateB,
        matchType: 'fuzzy',
        score,
      };
    }

    return {
      field: 'date',
      label,
      parsedValue: dateA,
      existingValue: dateB,
      matchType: 'mismatch',
      score: 0,
    };
  }

  // ════════════════════════════════════════════════════════════
  // 9. COMPARAISON DE TYPES D'ACTE
  // ════════════════════════════════════════════════════════════

  private static compareActeTypes(
    parsedType: string,
    existingCategory: 'ecoute' | 'geoloc',
    existingData: EcouteData | GeolocData
  ): number {
    // Match parfait
    if (parsedType === `autorisation_initiale_${existingCategory}`) return 1.0;

    // Prolongation pour la même catégorie → match partiel (c'est lié mais pas le même acte)
    if (parsedType === `prolongation_${existingCategory}`) return 0.6;

    // Requête pour la même catégorie
    if (parsedType === `requete_${existingCategory}`) {
      // Si l'acte existant est déjà en_cours, terminé, ou a des prolongations,
      // alors la requête JLD est forcément le document d'autorisation initiale.
      // Le schéma est : requête → autorisation JLD → écoute active → prolongation.
      // Si on est déjà au stade "écoute active", la requête ne peut pas être un nouvel acte.
      const statut = existingData.statut;
      const hasProlongations = (existingData.prolongationsHistory || []).length > 0;

      if (statut === 'en_cours' || statut === 'termine' || hasProlongations) {
        return 0.9; // Quasi-certain : c'est le document d'autorisation de cet acte
      }
      if (statut === 'a_renouveler' || statut === 'prolongation_pending' || statut === 'pose_pending') {
        return 0.8; // Très probable : acte actif à un stade avancé
      }
      // Acte en attente d'autorisation → la requête pourrait être le document en cours
      return 0.5;
    }

    // Catégorie différente
    return 0;
  }

  // ════════════════════════════════════════════════════════════
  // 10. UTILITAIRES
  // ════════════════════════════════════════════════════════════

  /** Extrait tous les chiffres d'une chaîne */
  private static extractAllDigits(input: string): string {
    return input.replace(/\D/g, '');
  }

  /** Extrait un numéro de téléphone complet (10 chiffres) d'une chaîne */
  private static extractFullPhone(input: string): string | null {
    // D'abord, essayer de trouver un pattern de téléphone explicite
    const phonePatterns = [
      /(\d{2})[.\s\-]?(\d{2})[.\s\-]?(\d{2})[.\s\-]?(\d{2})[.\s\-]?(\d{2})/,
      /(\d{10})/,
    ];

    for (const pattern of phonePatterns) {
      const match = input.match(pattern);
      if (match) {
        const digits = match[0].replace(/\D/g, '');
        if (digits.length === 10 && (digits.startsWith('0') || digits.startsWith('3'))) {
          return digits;
        }
      }
    }
    return null;
  }

  /** Extrait une plaque d'immatriculation d'une chaîne */
  private static extractPlate(input: string): string | null {
    // Format SIV : AA-123-AA (avec ou sans tirets/espaces)
    const sivMatch = input.match(/([A-Z]{2})[\s\-]?(\d{3})[\s\-]?([A-Z]{2})/i);
    if (sivMatch) {
      return `${sivMatch[1].toUpperCase()}-${sivMatch[2]}-${sivMatch[3].toUpperCase()}`;
    }
    return null;
  }

  /** Extrait les mots significatifs d'une description (ignore articles, prépositions) */
  private static extractSignificantWords(input: string): string[] {
    const stopWords = new Set([
      'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'au', 'aux',
      'et', 'ou', 'en', 'par', 'pour', 'sur', 'avec', 'dans', 'à', 'a',
      'véhicule', 'vehicule', 'immatriculé', 'immatricule', 'type',
      'marque', 'modèle', 'modele', 'couleur',
    ]);

    return input
      .toUpperCase()
      .replace(/[^A-ZÀ-Ÿ0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2 && !stopWords.has(w.toLowerCase()))
      .map(w => w.toUpperCase());
  }

  /** Calcule la différence absolue en jours entre deux dates YYYY-MM-DD */
  private static dateDiffDays(dateA: string, dateB: string): number {
    try {
      const a = new Date(dateA);
      const b = new Date(dateB);
      return Math.abs(Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24)));
    } catch {
      return 999;
    }
  }
}
