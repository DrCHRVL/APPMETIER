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
  /** Contentieux distincts dans lesquels il apparaît (signal de transversalité) */
  contentieuxIds: ContentieuxId[];
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
  /** Notes manuelles (issues d'une fiche ex nihilo) */
  manualNotes?: string;
  /** Alias manuels — fusionnés avec les variants */
  manualAlias?: string[];
  /** Statut renseigné manuellement */
  manualStatut?: string;
  /** True si le MEC n'apparaît dans aucun dossier réel */
  isManualOnly?: boolean;
}

export interface DossierNode {
  type: 'dossier';
  /** Identifiant unique. Pour un dossier réel : `${contentieuxId}_${enqueteId}`.
   *  Pour un dossier ex nihilo : préfixé `dexn_…`. */
  id: string;
  enqueteId: number;
  contentieuxId: ContentieuxId;
  /** Numéro de l'enquête ou label du dossier ex nihilo */
  numero: string;
  /** Statut : en_cours, archive, instruction (pour les dossiers réels) */
  statut: Enquete['statut'];
  /** Date de création (ISO) */
  dateCreation: string;
  /** Nombre de MEC dans ce dossier (taille du nœud dossier) */
  nbMec: number;
  /** True pour un dossier créé manuellement par l'utilisateur */
  isExNihilo?: boolean;
  /** Notes manuelles */
  notes?: string;
}

export type GraphNode = MecNode | DossierNode;

export interface GraphEdge {
  /** Identifiant unique. Pour les arêtes de données : `${mecId}__${dossierId}`.
   *  Pour les liens renseignement : `lien_…`. */
  id: string;
  source: string;
  target: string;
  /** 'data' = arête déduite des dossiers ; 'renseignement' = lien manuel utilisateur. */
  kind: 'data' | 'renseignement';
  /** Libellé optionnel (utile pour les liens renseignement) */
  label?: string;
  /** Notes manuelles (liens renseignement) */
  notes?: string;
}

// Snapshot des données overlay nécessaires à la construction du graphe.
// Importé sans référence circulaire vers le store.
export interface OverlayInput {
  mecsExNihilo?: Array<{
    id: string;
    displayName: string;
    alias?: string[];
    statut?: string;
    notes?: string;
  }>;
  dossiersExNihilo?: Array<{
    id: string;
    label: string;
    dateApprox?: string;
    mecIds: string[];
    notes?: string;
  }>;
  liensRenseignement?: Array<{
    id: string;
    source: string;
    target: string;
    label?: string;
    notes?: string;
  }>;
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
//
// Formule "réseau" : récompense la transversalité (apparaître dans
// plusieurs contentieux distincts pèse plus qu'être ME plusieurs fois
// sur le même dossier).

const SCORE_DOSSIER = 2;
const SCORE_CONTENTIEUX = 3;
const SCORE_MISE_EN_EXAMEN = 1;
const SCORE_CHEF = 0.3;
const RECENT_MULTIPLIER = 1.2;
const RECENT_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

function computeRawScore(mec: Omit<MecNode, 'score' | 'rawScore' | 'type'>): number {
  let raw =
    mec.dossierIds.length * SCORE_DOSSIER +
    mec.contentieuxIds.length * SCORE_CONTENTIEUX +
    mec.nbMisEnExamen * SCORE_MISE_EN_EXAMEN +
    mec.nbChefs * SCORE_CHEF;
  if (mec.recent) raw *= RECENT_MULTIPLIER;
  return raw;
}

// ──────────────────────────────────────────────
// CONSTRUCTION DU GRAPHE
// ──────────────────────────────────────────────

/**
 * Construit le graphe biparti à partir d'une liste d'enquêtes contextualisées,
 * éventuellement enrichi par les données overlay (MEC ex nihilo, dossiers ex
 * nihilo, liens renseignement).
 *
 * Les MEC portant le même nom normalisé sont fusionnés en un seul nœud — un MEC
 * ex nihilo qui partage son canonical avec un MEC réel se fond dans le nœud
 * existant et lui apporte ses notes/alias/statut manuels.
 */
export function buildMindmapGraph(
  sources: EnqueteWithContext[],
  overlay?: OverlayInput,
): MindmapGraph {
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
          contentieuxIds: [],
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
      if (!mecNode.contentieuxIds.includes(contentieuxId)) {
        mecNode.contentieuxIds.push(contentieuxId);
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
        edges.push({ id: edgeKey, source: canonical, target: dossierId, kind: 'data' });
      }
    }
  }

  // ── Overlay : MEC ex nihilo ─────────────────
  // Création ou fusion (par canonical) avec les MEC déjà extraits des dossiers.
  if (overlay?.mecsExNihilo) {
    for (const m of overlay.mecsExNihilo) {
      const canonical = m.id || normalizeMecName(m.displayName);
      if (!canonical) continue;
      let mecNode = mecById.get(canonical);
      if (!mecNode) {
        mecNode = {
          type: 'mec',
          id: canonical,
          displayName: m.displayName,
          variants: m.alias ? [...m.alias] : [],
          dossierIds: [],
          contentieuxIds: [],
          nbMisEnExamen: 0,
          nbChefs: 0,
          recent: false,
          score: 0,
          rawScore: 0,
          statuts: [],
          isManualOnly: true,
        };
        mecById.set(canonical, mecNode);
      }
      mecNode.manualNotes = m.notes;
      mecNode.manualAlias = m.alias;
      mecNode.manualStatut = m.statut;
      // Enrichit la liste des variants pour la recherche
      if (m.alias && m.alias.length > 0) {
        const merged = new Set([...mecNode.variants, ...m.alias]);
        mecNode.variants = Array.from(merged).filter(v => v !== mecNode!.displayName);
      }
    }
  }

  // ── Overlay : dossiers ex nihilo ────────────
  if (overlay?.dossiersExNihilo) {
    for (const d of overlay.dossiersExNihilo) {
      const node: DossierNode = {
        type: 'dossier',
        id: d.id,
        enqueteId: -1,
        contentieuxId: 'autre' as ContentieuxId,
        numero: d.label,
        statut: 'archive',
        dateCreation: d.dateApprox || new Date().toISOString(),
        nbMec: d.mecIds.length,
        isExNihilo: true,
        notes: d.notes,
      };
      dossierById.set(d.id, node);

      for (const rawMecId of d.mecIds) {
        const canonical = normalizeMecName(rawMecId) || rawMecId;
        if (!canonical) continue;
        // Crée un nœud MEC fantôme si le canonical n'existe pas encore (cas rare,
        // ex. on a référencé un MEC ex nihilo qui a été supprimé entre-temps).
        if (!mecById.has(canonical)) {
          mecById.set(canonical, {
            type: 'mec',
            id: canonical,
            displayName: rawMecId,
            variants: [],
            dossierIds: [],
            contentieuxIds: [],
            nbMisEnExamen: 0,
            nbChefs: 0,
            recent: false,
            score: 0,
            rawScore: 0,
            statuts: [],
            isManualOnly: true,
          });
        }
        const mec = mecById.get(canonical)!;
        if (!mec.dossierIds.includes(d.id)) mec.dossierIds.push(d.id);
        // Le fait d'être lié à un dossier (même ex nihilo) annule l'isolement
        mec.isManualOnly = false;

        const edgeKey = `${canonical}__${d.id}`;
        if (!edgeKeys.has(edgeKey)) {
          edgeKeys.add(edgeKey);
          edges.push({ id: edgeKey, source: canonical, target: d.id, kind: 'data' });
        }
      }
    }
  }

  // ── Overlay : liens renseignement ───────────
  // Filtrés : les endpoints doivent exister dans le graphe.
  if (overlay?.liensRenseignement) {
    for (const l of overlay.liensRenseignement) {
      const sourceExists = mecById.has(l.source) || dossierById.has(l.source);
      const targetExists = mecById.has(l.target) || dossierById.has(l.target);
      if (!sourceExists || !targetExists) continue;
      edges.push({
        id: l.id,
        source: l.source,
        target: l.target,
        kind: 'renseignement',
        label: l.label,
        notes: l.notes,
      });
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

/**
 * Retourne les MEC à afficher dans le Top 10. Les MEC épinglés sont
 * toujours présents en tête (triés entre eux par score), suivis des
 * autres MEC complétant jusqu'à `limit`. Si plus de `limit` MEC sont
 * épinglés, ils sont tous retournés (la liste peut donc dépasser
 * `limit`).
 */
export function getTopMec(
  graph: MindmapGraph,
  limit: number = 10,
  pinnedIds?: Iterable<string>,
): MecNode[] {
  const pinned = pinnedIds ? new Set(pinnedIds) : null;
  const all = [...graph.mecById.values()].sort((a, b) => b.rawScore - a.rawScore);

  if (!pinned || pinned.size === 0) {
    return all.slice(0, limit);
  }

  const pinnedMecs: MecNode[] = [];
  const others: MecNode[] = [];
  for (const mec of all) {
    if (pinned.has(mec.id)) pinnedMecs.push(mec);
    else others.push(mec);
  }
  const fillCount = Math.max(0, limit - pinnedMecs.length);
  return [...pinnedMecs, ...others.slice(0, fillCount)];
}
