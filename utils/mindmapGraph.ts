// utils/mindmapGraph.ts
// Construit le graphe biparti MEC ↔ Dossier pour le module Mindmap.
//
// Modèle :
//   - Un nœud "MEC" représente une personne mise en cause, identifiée par
//     un nom canonique (normalisé). Plusieurs MisEnCause de dossiers
//     différents portant le même nom canonique fusionnent en un seul nœud.
//   - Un nœud "Dossier" représente une enquête (en cours, archivée ou
//     instruction).
//   - Une arête relie un MEC à chaque dossier où il est cité.
//
// Le score d'un MEC (taille du nœud) suit la formule MVP :
//   score = (nb_dossiers × 1)
//         + (nb_mises_en_examen × 3)
//         + (nb_chefs_inculpation × 0.5)
//   × 1.2 si au moins une mention sur les 12 derniers mois
//
// La formule sera affinée à l'usage — l'objectif ici est d'avoir un signal
// visuel cohérent dès le MVP.

import { Enquete, MisEnCause } from '@/types/interfaces';
import type { MisEnExamen } from '@/types/instructionTypes';
import { ContentieuxId } from '@/types/userTypes';

// ──────────────────────────────────────────────
// TYPES
// ──────────────────────────────────────────────

export interface MecNode {
  type: 'mec';
  /** Identifiant canonique (nom normalisé) — clé stable cross-dossiers */
  id: string;
  /** Nom d'affichage (forme la plus fréquente parmi les variantes) */
  displayName: string;
  /** Variantes orthographiques rencontrées */
  variants: string[];
  /** Dossiers où ce MEC apparaît */
  dossierIds: string[];
  /** Nombre de mises en examen formelles (via misEnExamen sur les instructions) */
  nbMisEnExamen: number;
  /** Total des chefs d'inculpation cumulés */
  nbChefs: number;
  /** A été mentionné au moins une fois dans les 12 derniers mois */
  recent: boolean;
  /** Score composite normalisé entre 0 et 1 (max du graphe = 1) */
  score: number;
  /** Score brut avant normalisation */
  rawScore: number;
  /** Statuts uniques rencontrés (pour coloration éventuelle) */
  statuts: string[];
}

export interface DossierNode {
  type: 'dossier';
  /** Identifiant unique : `${contentieuxId}_${enqueteId}` */
  id: string;
  enqueteId: number;
  contentieuxId: ContentieuxId;
  /** Numéro de l'enquête (affichage) */
  numero: string;
  /** Statut : en_cours, archive, instruction */
  statut: Enquete['statut'];
  /** Date de création (ISO) */
  dateCreation: string;
  /** Nombre de MEC dans ce dossier (taille du nœud dossier) */
  nbMec: number;
}

export type GraphNode = MecNode | DossierNode;

export interface GraphEdge {
  /** Identifiant unique : `${mecId}__${dossierId}` */
  id: string;
  source: string; // mecId
  target: string; // dossierId
}

export interface MindmapGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  mecById: Map<string, MecNode>;
  dossierById: Map<string, DossierNode>;
}

// Source d'une enquête : enquête simple ou instruction (avec misEnExamen)
export interface EnqueteWithContext {
  enquete: Enquete;
  contentieuxId: ContentieuxId;
  misEnExamen?: MisEnExamen[];
}

// ──────────────────────────────────────────────
// NORMALISATION
// ──────────────────────────────────────────────

/**
 * Normalise un nom pour matching cross-dossiers.
 * Volontairement simple pour le MVP — on pourra raffiner avec Levenshtein
 * et une UI de fusion manuelle en V2 si on observe des faux négatifs.
 */
export function normalizeMecName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ──────────────────────────────────────────────
// SCORE COMPOSITE
// ──────────────────────────────────────────────

const SCORE_DOSSIER = 1;
const SCORE_MISE_EN_EXAMEN = 3;
const SCORE_CHEF = 0.5;
const RECENT_MULTIPLIER = 1.2;
const RECENT_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

function computeRawScore(mec: Omit<MecNode, 'score' | 'rawScore' | 'type'>): number {
  let raw =
    mec.dossierIds.length * SCORE_DOSSIER +
    mec.nbMisEnExamen * SCORE_MISE_EN_EXAMEN +
    mec.nbChefs * SCORE_CHEF;
  if (mec.recent) raw *= RECENT_MULTIPLIER;
  return raw;
}

// ──────────────────────────────────────────────
// CONSTRUCTION DU GRAPHE
// ──────────────────────────────────────────────

/**
 * Construit le graphe biparti à partir d'une liste d'enquêtes contextualisées.
 * Les MEC portant le même nom normalisé sont fusionnés en un seul nœud.
 */
export function buildMindmapGraph(sources: EnqueteWithContext[]): MindmapGraph {
  const mecById = new Map<string, MecNode>();
  const dossierById = new Map<string, DossierNode>();
  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();

  const variantCounts = new Map<string, Map<string, number>>(); // canonicalId → variant → count
  const now = Date.now();

  for (const { enquete, contentieuxId, misEnExamen } of sources) {
    if (!enquete.misEnCause || enquete.misEnCause.length === 0) continue;

    const dossierId = `${contentieuxId}_${enquete.id}`;
    const dossierDate = new Date(enquete.dateMiseAJour || enquete.dateCreation).getTime();
    const isRecent = !Number.isNaN(dossierDate) && now - dossierDate <= RECENT_WINDOW_MS;

    // Index des chefs d'inculpation par nom canonique (côté MisEnExamen)
    const chefsByCanonical = new Map<string, number>();
    const examenedCanonical = new Set<string>();
    if (misEnExamen) {
      for (const exa of misEnExamen) {
        const canonical = normalizeMecName(exa.nom);
        if (!canonical) continue;
        examenedCanonical.add(canonical);
        chefsByCanonical.set(
          canonical,
          (chefsByCanonical.get(canonical) || 0) + (exa.infractions?.length || 0),
        );
      }
    }

    // Crée le nœud dossier
    const dossierNode: DossierNode = {
      type: 'dossier',
      id: dossierId,
      enqueteId: enquete.id,
      contentieuxId,
      numero: enquete.numero,
      statut: enquete.statut,
      dateCreation: enquete.dateCreation,
      nbMec: enquete.misEnCause.length,
    };
    dossierById.set(dossierId, dossierNode);

    // Parcours des MEC du dossier
    for (const mec of enquete.misEnCause) {
      const canonical = normalizeMecName(mec.nom);
      if (!canonical) continue;

      // Compte les variantes pour choisir le displayName le plus fréquent
      let variantsForId = variantCounts.get(canonical);
      if (!variantsForId) {
        variantsForId = new Map();
        variantCounts.set(canonical, variantsForId);
      }
      variantsForId.set(mec.nom, (variantsForId.get(mec.nom) || 0) + 1);

      // Nœud MEC (création paresseuse)
      let mecNode = mecById.get(canonical);
      if (!mecNode) {
        mecNode = {
          type: 'mec',
          id: canonical,
          displayName: mec.nom,
          variants: [],
          dossierIds: [],
          nbMisEnExamen: 0,
          nbChefs: 0,
          recent: false,
          score: 0,
          rawScore: 0,
          statuts: [],
        };
        mecById.set(canonical, mecNode);
      }

      if (!mecNode.dossierIds.includes(dossierId)) {
        mecNode.dossierIds.push(dossierId);
      }
      if (mec.statut && !mecNode.statuts.includes(mec.statut)) {
        mecNode.statuts.push(mec.statut);
      }
      if (isRecent) mecNode.recent = true;

      if (examenedCanonical.has(canonical)) {
        mecNode.nbMisEnExamen += 1;
        mecNode.nbChefs += chefsByCanonical.get(canonical) || 0;
      }

      // Arête MEC ↔ Dossier (déduplique si plusieurs MisEnCause portent le même nom dans le dossier)
      const edgeKey = `${canonical}__${dossierId}`;
      if (!edgeKeys.has(edgeKey)) {
        edgeKeys.add(edgeKey);
        edges.push({ id: edgeKey, source: canonical, target: dossierId });
      }
    }
  }

  // Finalisation : displayName le plus fréquent + score normalisé
  let maxRaw = 0;
  for (const [canonical, mecNode] of mecById) {
    const variants = variantCounts.get(canonical);
    if (variants && variants.size > 0) {
      let bestName = mecNode.displayName;
      let bestCount = 0;
      for (const [name, count] of variants) {
        if (count > bestCount) {
          bestCount = count;
          bestName = name;
        }
      }
      mecNode.displayName = bestName;
      mecNode.variants = Array.from(variants.keys()).filter(v => v !== bestName);
    }
    mecNode.rawScore = computeRawScore(mecNode);
    if (mecNode.rawScore > maxRaw) maxRaw = mecNode.rawScore;
  }

  if (maxRaw > 0) {
    for (const mecNode of mecById.values()) {
      mecNode.score = mecNode.rawScore / maxRaw;
    }
  }

  return {
    nodes: [...mecById.values(), ...dossierById.values()],
    edges,
    mecById,
    dossierById,
  };
}

// ──────────────────────────────────────────────
// SOUS-GRAPHE EN MODE FOCUS
// ──────────────────────────────────────────────

/**
 * Extrait le sous-graphe centré sur un nœud, à `depth` sauts.
 * - depth=1 : le nœud + ses voisins directs
 * - depth=2 : + les voisins des voisins
 */
export function extractFocusSubgraph(
  graph: MindmapGraph,
  centerId: string,
  depth: number = 1,
): MindmapGraph {
  if (!graph.mecById.has(centerId) && !graph.dossierById.has(centerId)) {
    return { nodes: [], edges: [], mecById: new Map(), dossierById: new Map() };
  }

  // BFS sur les voisins
  const adj = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (!adj.has(edge.source)) adj.set(edge.source, new Set());
    if (!adj.has(edge.target)) adj.set(edge.target, new Set());
    adj.get(edge.source)!.add(edge.target);
    adj.get(edge.target)!.add(edge.source);
  }

  const visited = new Set<string>([centerId]);
  let frontier = new Set<string>([centerId]);
  for (let i = 0; i < depth; i++) {
    const next = new Set<string>();
    for (const id of frontier) {
      const neighbors = adj.get(id);
      if (!neighbors) continue;
      for (const n of neighbors) {
        if (!visited.has(n)) {
          visited.add(n);
          next.add(n);
        }
      }
    }
    frontier = next;
    if (frontier.size === 0) break;
  }

  const mecById = new Map<string, MecNode>();
  const dossierById = new Map<string, DossierNode>();
  const nodes: GraphNode[] = [];

  for (const id of visited) {
    const mec = graph.mecById.get(id);
    if (mec) {
      mecById.set(id, mec);
      nodes.push(mec);
      continue;
    }
    const dossier = graph.dossierById.get(id);
    if (dossier) {
      dossierById.set(id, dossier);
      nodes.push(dossier);
    }
  }

  const edges = graph.edges.filter(e => visited.has(e.source) && visited.has(e.target));

  return { nodes, edges, mecById, dossierById };
}

// ──────────────────────────────────────────────
// TOP 10
// ──────────────────────────────────────────────

export function getTopMec(graph: MindmapGraph, limit: number = 10): MecNode[] {
  return [...graph.mecById.values()]
    .sort((a, b) => b.rawScore - a.rawScore)
    .slice(0, limit);
}
