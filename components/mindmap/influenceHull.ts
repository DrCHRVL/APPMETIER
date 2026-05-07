// components/mindmap/influenceHull.ts
// Outils géométriques pour les "aires d'influence". L'aire d'un cluster est
// rendue comme l'union d'un cercle par membre (rayon = collisionRadius +
// padding) et d'une capsule par arête intra-cluster (tube de largeur
// 2 * padding). Ce choix géométrique évite l'écueil des hulls convexes :
// un nœud spatialement piégé dans le triangle des membres n'est jamais
// englobé visuellement, parce que la forme suit les membres et leurs
// liens, jamais leur enveloppe externe.
//
// Tout est pur (pas de dépendance React/d3) — testable et réutilisable.

import type { ContentieuxId } from '@/types/userTypes';
import type { GraphEdge, GraphNode } from '@/utils/mindmapGraph';
import type { PositionedNode } from './useForceLayout';

export interface ClusterCircle {
  x: number;
  y: number;
  r: number;
}

export interface ClusterCapsule {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Demi-largeur du tube (= padding). */
  r: number;
}

export interface InfluenceCluster {
  id: string;                 // identifiant stable (concat des ids de nœuds triés)
  nodeIds: string[];
  /** Cercles centrés sur chaque membre (rayon = collisionRadius + padding). */
  circles: ClusterCircle[];
  /** Capsules le long des arêtes intra-cluster (tubes à bouts arrondis). */
  capsules: ClusterCapsule[];
  /** Bounding box de l'union circles+capsules (utile pour positionner un nœud SVG englobant). */
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  /** Couleur dérivée du contentieux dominant de la composante. */
  color: string;
  /** Contentieux dominant (id), ou undefined si que des dossiers ex nihilo. */
  dominantContentieux?: ContentieuxId;
}

/**
 * Tente de retrouver l'annotation manuelle qui correspond à un cluster.
 * Match par index Jaccard (intersection / union des nodeIds) ≥ seuil.
 * En cas d'égalité, on retourne la plus récente (le tri se fait côté
 * appelant si besoin — ici on prend simplement le meilleur score).
 */
export function matchAnnotation<T extends { nodeIds: string[] }>(
  cluster: InfluenceCluster,
  annotations: T[],
  threshold = 0.5,
): T | undefined {
  if (annotations.length === 0) return undefined;
  const clusterSet = new Set(cluster.nodeIds);
  let best: T | undefined;
  let bestScore = 0;
  for (const ann of annotations) {
    if (ann.nodeIds.length === 0) continue;
    let inter = 0;
    for (const id of ann.nodeIds) if (clusterSet.has(id)) inter++;
    const union = clusterSet.size + ann.nodeIds.length - inter;
    if (union === 0) continue;
    const jaccard = inter / union;
    if (jaccard >= threshold && jaccard > bestScore) {
      bestScore = jaccard;
      best = ann;
    }
  }
  return best;
}

// ──────────────────────────────────────────────
// COMPOSANTES CONNEXES
// ──────────────────────────────────────────────

export function connectedComponents(
  nodes: GraphNode[],
  edges: GraphEdge[],
): GraphNode[][] {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n.id, new Set());
  for (const e of edges) {
    // Cohérent avec buildSubClusters et useForceLayout : seuls les liens
    // `data` définissent l'appartenance à une composante. Un lien
    // renseignement entre deux réseaux distincts ne doit pas fusionner
    // leurs aires d'influence en une seule excroissance visuelle.
    if (e.kind !== 'data') continue;
    if (!adj.has(e.source) || !adj.has(e.target)) continue;
    adj.get(e.source)!.add(e.target);
    adj.get(e.target)!.add(e.source);
  }

  const visited = new Set<string>();
  const out: GraphNode[][] = [];
  for (const n of nodes) {
    if (visited.has(n.id)) continue;
    const comp: GraphNode[] = [];
    const queue: string[] = [n.id];
    visited.add(n.id);
    while (queue.length) {
      const id = queue.shift()!;
      const node = byId.get(id);
      if (node) comp.push(node);
      for (const nb of adj.get(id) || []) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    out.push(comp);
  }
  return out;
}

// ──────────────────────────────────────────────
// CALCUL DES CLUSTERS PRÊTS À RENDRE
// ──────────────────────────────────────────────

export interface BuildInfluenceOptions {
  /** Composantes ignorées si elles ont moins de N nœuds. */
  minNodes?: number;
  /** Padding visuel autour de chaque nœud, en pixels monde. */
  nodePadding?: number;
}

/**
 * Construit la géométrie d'un cluster (cercles + capsules) à partir d'une
 * liste de membres et de leurs arêtes internes. Calcule aussi la bbox de
 * l'union pour le positionnement SVG.
 */
function buildClusterShape(
  members: GraphNode[],
  intraEdges: GraphEdge[],
  positions: Map<string, PositionedNode>,
  collisionRadiusOf: (n: GraphNode) => number,
  nodePadding: number,
): {
  circles: ClusterCircle[];
  capsules: ClusterCapsule[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
} | undefined {
  const circles: ClusterCircle[] = [];
  const positionByNodeId = new Map<string, PositionedNode>();

  for (const n of members) {
    const pos = positions.get(n.id);
    if (!pos) continue;
    const r = collisionRadiusOf(n) + nodePadding;
    circles.push({ x: pos.x, y: pos.y, r });
    positionByNodeId.set(n.id, pos);
  }
  if (circles.length === 0) return undefined;

  // Capsules : pour chaque arête entre deux membres, un tube de demi-largeur
  // = padding (le rayon du cercle aux extrémités est plus grand mais c'est ok :
  // l'union absorbe l'étranglement éventuel).
  const capsules: ClusterCapsule[] = [];
  for (const e of intraEdges) {
    const a = positionByNodeId.get(e.source);
    const b = positionByNodeId.get(e.target);
    if (!a || !b) continue;
    capsules.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, r: nodePadding });
  }

  // Bbox de l'union : suffisant de borner par les cercles, puisque les
  // capsules vivent entre deux centres dont les disques sont déjà dans la bbox
  // (le rayon de capsule ≤ rayon de cercle pour un nœud non dégénéré).
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of circles) {
    if (c.x - c.r < minX) minX = c.x - c.r;
    if (c.y - c.r < minY) minY = c.y - c.r;
    if (c.x + c.r > maxX) maxX = c.x + c.r;
    if (c.y + c.r > maxY) maxY = c.y + c.r;
  }
  // Sécurité : étend par max(rayon capsule) au cas où un membre a un rayon
  // de cercle inférieur au padding (peu probable, mais stable).
  for (const cap of capsules) {
    const pad = cap.r;
    if (cap.x1 - pad < minX) minX = cap.x1 - pad;
    if (cap.y1 - pad < minY) minY = cap.y1 - pad;
    if (cap.x1 + pad > maxX) maxX = cap.x1 + pad;
    if (cap.y1 + pad > maxY) maxY = cap.y1 + pad;
    if (cap.x2 - pad < minX) minX = cap.x2 - pad;
    if (cap.y2 - pad < minY) minY = cap.y2 - pad;
    if (cap.x2 + pad > maxX) maxX = cap.x2 + pad;
    if (cap.y2 + pad > maxY) maxY = cap.y2 + pad;
  }

  return { circles, capsules, bbox: { minX, minY, maxX, maxY } };
}

export function buildInfluenceClusters(
  nodes: GraphNode[],
  edges: GraphEdge[],
  positions: Map<string, PositionedNode>,
  collisionRadiusOf: (n: GraphNode) => number,
  contentieuxColor: (id: ContentieuxId) => string | undefined,
  options: BuildInfluenceOptions = {},
): InfluenceCluster[] {
  const minNodes = options.minNodes ?? 3;
  const nodePadding = options.nodePadding ?? 28;

  const components = connectedComponents(nodes, edges);
  const clusters: InfluenceCluster[] = [];

  for (const comp of components) {
    if (comp.length < minNodes) continue;

    const compIds = new Set(comp.map(n => n.id));
    const intraEdges = edges.filter(e => compIds.has(e.source) && compIds.has(e.target));

    const shape = buildClusterShape(comp, intraEdges, positions, collisionRadiusOf, nodePadding);
    if (!shape) continue;

    // Couleur : contentieux dominant (compté sur les nœuds dossier).
    const ctxCount = new Map<ContentieuxId, number>();
    for (const n of comp) {
      if (n.type !== 'dossier') continue;
      if ((n as { isExNihilo?: boolean }).isExNihilo) continue;
      ctxCount.set(n.contentieuxId, (ctxCount.get(n.contentieuxId) || 0) + 1);
    }
    let dominantContentieux: ContentieuxId | undefined;
    let topCount = 0;
    for (const [id, c] of ctxCount) {
      if (c > topCount) {
        topCount = c;
        dominantContentieux = id;
      }
    }
    const color = (dominantContentieux && contentieuxColor(dominantContentieux)) || '#94a3b8';

    // Identifiant stable pour la mémoïsation côté React.
    const id = comp.map(n => n.id).sort().join('|');

    clusters.push({
      id,
      nodeIds: comp.map(n => n.id),
      circles: shape.circles,
      capsules: shape.capsules,
      bbox: shape.bbox,
      color,
      dominantContentieux,
    });
  }

  return clusters;
}

// ──────────────────────────────────────────────
// SOUS-CLUSTERS INTRA-COMPOSANTE
// ──────────────────────────────────────────────
//
// À l'intérieur d'un cluster, on regroupe les MEC par dossier "primaire" :
// un MEC connecté à un seul dossier du cluster est attaché à ce dossier.
// Les MEC connectés à ≥ 2 dossiers du cluster sont des "ponts" et ne sont
// dans aucun sub-cluster (ils restent dans le grand blob, mais n'ont pas
// de mini-aire propre — ce qui est exactement ce qu'on veut visuellement :
// le pont sort visuellement de tous les sous-groupes).

export interface SubClusterOptions {
  /** Padding radial autour de chaque nœud du sub-cluster (px monde). */
  nodePadding?: number;
  /** Taille minimale d'un sub-cluster (dossier + MECs) pour être rendu. */
  minNodes?: number;
}

export function buildSubClusters(
  cluster: InfluenceCluster,
  nodes: GraphNode[],
  edges: GraphEdge[],
  positions: Map<string, PositionedNode>,
  collisionRadiusOf: (n: GraphNode) => number,
  options: SubClusterOptions = {},
): InfluenceCluster[] {
  const padding = options.nodePadding ?? 18;
  const minNodes = options.minNodes ?? 3;

  // Index rapide des nœuds du cluster.
  const clusterIds = new Set(cluster.nodeIds);
  const inCluster = (id: string) => clusterIds.has(id);
  const nodeById = new Map<string, GraphNode>();
  for (const n of nodes) if (clusterIds.has(n.id)) nodeById.set(n.id, n);

  // Adjacence restreinte au cluster.
  const adj = new Map<string, string[]>();
  for (const id of clusterIds) adj.set(id, []);
  for (const e of edges) {
    if (e.kind !== 'data') continue; // les liens renseignement ne définissent pas l'appartenance
    if (!inCluster(e.source) || !inCluster(e.target)) continue;
    adj.get(e.source)!.push(e.target);
    adj.get(e.target)!.push(e.source);
  }

  // Liste des dossiers du cluster.
  const dossierIds: string[] = [];
  for (const id of clusterIds) {
    const n = nodeById.get(id);
    if (n?.type === 'dossier') dossierIds.push(id);
  }
  // Un seul dossier dans le cluster → pas de sous-structure utile, le grand
  // blob est déjà parfaitement clair.
  if (dossierIds.length < 2) return [];

  // Pour chaque MEC, compte combien de dossiers du cluster il touche.
  const mecDossierCount = new Map<string, number>();
  for (const id of clusterIds) {
    const n = nodeById.get(id);
    if (n?.type !== 'mec') continue;
    let count = 0;
    for (const nb of adj.get(id) || []) {
      const nbNode = nodeById.get(nb);
      if (nbNode?.type === 'dossier') count++;
    }
    mecDossierCount.set(id, count);
  }

  const subClusters: InfluenceCluster[] = [];

  for (const dId of dossierIds) {
    const dNode = nodeById.get(dId);
    if (!dNode) continue;

    const members: GraphNode[] = [dNode];
    for (const nb of adj.get(dId) || []) {
      const m = nodeById.get(nb);
      if (m?.type === 'mec' && (mecDossierCount.get(m.id) || 0) === 1) {
        members.push(m);
      }
    }
    if (members.length < minNodes) continue;

    // Capsules : seules les arêtes dossier↔MEC (sub-cluster en étoile autour
    // du dossier).
    const memberIds = new Set(members.map(m => m.id));
    const intraEdges = edges.filter(e =>
      e.kind === 'data' && memberIds.has(e.source) && memberIds.has(e.target),
    );

    const shape = buildClusterShape(members, intraEdges, positions, collisionRadiusOf, padding);
    if (!shape) continue;

    subClusters.push({
      id: `sub_${dId}`,
      nodeIds: members.map(m => m.id),
      circles: shape.circles,
      capsules: shape.capsules,
      bbox: shape.bbox,
      // Couleur héritée du cluster parent (le contentieux dominant). On
      // pourrait raffiner par contentieux du dossier mais le sous-blob
      // doit être lisible comme variation du grand, pas comme entité
      // autonome.
      color: cluster.color,
      dominantContentieux: cluster.dominantContentieux,
    });
  }

  return subClusters;
}
