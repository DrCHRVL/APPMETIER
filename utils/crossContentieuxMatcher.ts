// utils/crossContentieuxMatcher.ts
// Détecte les informations communes entre enquêtes de différents contentieux.
// Utilise un coefficient de similarité pour gérer les variations humaines.

import { Enquete } from '@/types/interfaces';
import { ContentieuxId } from '@/types/userTypes';

// ──────────────────────────────────────────────
// TYPES
// ──────────────────────────────────────────────

export interface CrossMatch {
  type: 'nom' | 'telephone' | 'immatriculation';
  /** Valeur normalisée qui a matché */
  normalizedValue: string;
  /** Valeurs originales des deux côtés */
  originalValues: [string, string];
  /** Coefficient de similarité (0-1) */
  similarity: number;
  /** Enquête source */
  enqueteA: { id: number; numero: string; contentieuxId: ContentieuxId };
  /** Enquête cible */
  enqueteB: { id: number; numero: string; contentieuxId: ContentieuxId };
}

export interface CrossMatchGroup {
  type: 'nom' | 'telephone' | 'immatriculation';
  label: string;
  matches: CrossMatch[];
}

// ──────────────────────────────────────────────
// NORMALISATION
// ──────────────────────────────────────────────

/** Supprime accents, met en minuscule, retire les espaces inutiles */
function normalizeText(text: string): string {
  return text
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalise un numéro de téléphone : garde uniquement les chiffres, gère +33 */
function normalizePhone(phone: string): string {
  let digits = phone.replace(/[^0-9+]/g, '');
  // Convertir +33 en 0
  if (digits.startsWith('+33')) digits = '0' + digits.slice(3);
  if (digits.startsWith('0033')) digits = '0' + digits.slice(4);
  // Garder uniquement les chiffres
  return digits.replace(/[^0-9]/g, '');
}

/** Normalise une immatriculation : lettres+chiffres sans séparateurs */
function normalizePlate(plate: string): string {
  return plate
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

// ──────────────────────────────────────────────
// SIMILARITÉ (Levenshtein normalisée)
// ──────────────────────────────────────────────

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // Optimisation : matrices 2 lignes au lieu de m*n
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // suppression
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

/** Coefficient de similarité entre 0 et 1 */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const dist = levenshteinDistance(a, b);
  const maxLen = Math.max(a.length, b.length);
  return 1 - dist / maxLen;
}

/** Vérifie si l'un contient l'autre (pour les noms partiels: "DUPONT" dans "DUPONT Jean") */
function containsMatch(a: string, b: string): number {
  if (a.length < 3 || b.length < 3) return 0;
  if (a.includes(b) || b.includes(a)) {
    const shorter = Math.min(a.length, b.length);
    const longer = Math.max(a.length, b.length);
    return shorter / longer; // Plus la proportion est grande, meilleur le score
  }
  return 0;
}

// ──────────────────────────────────────────────
// EXTRACTION DES DONNÉES COMPARABLES
// ──────────────────────────────────────────────

interface EnqueteData {
  enqueteId: number;
  enqueteNumero: string;
  contentieuxId: ContentieuxId;
  noms: string[];         // Noms des mis en cause
  telephones: string[];   // Numéros d'écoutes / cibles
  immatriculations: string[]; // Véhicules géolocalisés
}

function extractData(enquete: Enquete, contentieuxId: ContentieuxId): EnqueteData {
  const noms = (enquete.misEnCause || [])
    .map(m => m.nom)
    .filter(n => n && n.trim().length >= 2);

  const telephones: string[] = [];
  for (const ecoute of (enquete.ecoutes || [])) {
    if (ecoute.numero) telephones.push(ecoute.numero);
    if (ecoute.cible) {
      // Si la cible ressemble à un numéro de téléphone
      const cleaned = ecoute.cible.replace(/[^0-9+]/g, '');
      if (cleaned.length >= 8) telephones.push(ecoute.cible);
    }
  }

  const immatriculations: string[] = [];
  for (const geoloc of (enquete.geolocalisations || [])) {
    if (geoloc.objet) {
      // Extraire les immatriculations du champ objet
      // Pattern français: AA-123-BB, AA123BB, etc.
      const plateMatches = geoloc.objet.match(/[A-Za-z]{2}[\s-]?\d{3}[\s-]?[A-Za-z]{2}/g);
      if (plateMatches) {
        immatriculations.push(...plateMatches);
      } else if (geoloc.objet.trim().length >= 5) {
        // Si pas de pattern détecté mais texte assez long, on le garde quand même
        immatriculations.push(geoloc.objet.trim());
      }
    }
  }

  return {
    enqueteId: enquete.id,
    enqueteNumero: enquete.numero,
    contentieuxId,
    noms,
    telephones,
    immatriculations,
  };
}

// ──────────────────────────────────────────────
// MOTEUR DE CROISEMENT
// ──────────────────────────────────────────────

const MIN_SIMILARITY = 0.70;
const MIN_PHONE_SIMILARITY = 0.85; // Plus strict pour les téléphones
const MIN_PLATE_SIMILARITY = 0.80;
const MIN_NAME_LENGTH = 3;

export function findCrossMatches(
  enquetesByContentieux: Map<ContentieuxId, Enquete[]>
): CrossMatch[] {
  const matches: CrossMatch[] = [];

  // Extraire les données de toutes les enquêtes en cours
  const allData: EnqueteData[] = [];
  for (const [cId, enquetes] of enquetesByContentieux) {
    for (const enquete of enquetes) {
      if (enquete.statut !== 'en_cours') continue;
      allData.push(extractData(enquete, cId));
    }
  }

  // Comparer chaque paire d'enquêtes de contentieux DIFFÉRENTS
  for (let i = 0; i < allData.length; i++) {
    for (let j = i + 1; j < allData.length; j++) {
      const a = allData[i];
      const b = allData[j];

      // On ne compare que des contentieux différents
      if (a.contentieuxId === b.contentieuxId) continue;

      const refA = { id: a.enqueteId, numero: a.enqueteNumero, contentieuxId: a.contentieuxId };
      const refB = { id: b.enqueteId, numero: b.enqueteNumero, contentieuxId: b.contentieuxId };

      // 1. Comparer les noms de MEC
      for (const nomA of a.noms) {
        const normA = normalizeText(nomA);
        if (normA.length < MIN_NAME_LENGTH) continue;

        for (const nomB of b.noms) {
          const normB = normalizeText(nomB);
          if (normB.length < MIN_NAME_LENGTH) continue;

          // Similarity directe
          const sim = similarity(normA, normB);
          // Vérifier aussi la correspondance partielle (nom seul vs nom+prénom)
          const containsSim = containsMatch(normA, normB);
          const bestSim = Math.max(sim, containsSim);

          if (bestSim >= MIN_SIMILARITY) {
            matches.push({
              type: 'nom',
              normalizedValue: normA,
              originalValues: [nomA, nomB],
              similarity: bestSim,
              enqueteA: refA,
              enqueteB: refB,
            });
          }
        }
      }

      // 2. Comparer les téléphones
      for (const telA of a.telephones) {
        const normA = normalizePhone(telA);
        if (normA.length < 8) continue;

        for (const telB of b.telephones) {
          const normB = normalizePhone(telB);
          if (normB.length < 8) continue;

          const sim = similarity(normA, normB);
          if (sim >= MIN_PHONE_SIMILARITY) {
            matches.push({
              type: 'telephone',
              normalizedValue: normA,
              originalValues: [telA, telB],
              similarity: sim,
              enqueteA: refA,
              enqueteB: refB,
            });
          }
        }
      }

      // 3. Comparer les immatriculations
      for (const platA of a.immatriculations) {
        const normA = normalizePlate(platA);
        if (normA.length < 5) continue;

        for (const platB of b.immatriculations) {
          const normB = normalizePlate(platB);
          if (normB.length < 5) continue;

          const sim = similarity(normA, normB);
          if (sim >= MIN_PLATE_SIMILARITY) {
            matches.push({
              type: 'immatriculation',
              normalizedValue: normA,
              originalValues: [platA, platB],
              similarity: sim,
              enqueteA: refA,
              enqueteB: refB,
            });
          }
        }
      }
    }
  }

  // Dédupliquer (même paire d'enquêtes, même type, même valeur)
  const seen = new Set<string>();
  const unique = matches.filter(m => {
    const ids = [m.enqueteA.id, m.enqueteB.id].sort().join('-');
    const key = `${m.type}:${ids}:${m.normalizedValue}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Trier par similarité décroissante
  unique.sort((a, b) => b.similarity - a.similarity);

  return unique;
}

/** Groupe les matches par type pour l'affichage */
export function groupMatches(matches: CrossMatch[]): CrossMatchGroup[] {
  const groups: CrossMatchGroup[] = [];

  const byType: Record<string, CrossMatch[]> = {};
  for (const m of matches) {
    if (!byType[m.type]) byType[m.type] = [];
    byType[m.type].push(m);
  }

  const typeLabels: Record<string, string> = {
    nom: 'Mis en cause',
    telephone: 'Lignes téléphoniques',
    immatriculation: 'Véhicules',
  };

  for (const [type, items] of Object.entries(byType)) {
    groups.push({
      type: type as CrossMatch['type'],
      label: typeLabels[type] || type,
      matches: items,
    });
  }

  return groups;
}
