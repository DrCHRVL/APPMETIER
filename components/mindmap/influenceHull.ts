// components/mindmap/influenceHull.ts
// Outils géométriques pour les "aires d'influence" : détection de composantes
// connexes, hull convexe enrichi, lissage Chaikin pour produire des blobs
// organiques par cluster.
//
// Tout est pur (pas de dépendance React/d3) — testable et réutilisable.

import type { ContentieuxId } from '@/types/userTypes';
import type { GraphEdge, GraphNode } from '@/utils/mindmapGraph';
import type { PositionedNode } from './useForceLayout';

export type Pt = [number, number];

export interface InfluenceCluster {
  id: string;                 // identifiant stable (concat des ids de nœuds triés)
  nodeIds: string[];
  /** Polygone lissé prêt à être rendu en SVG (coordonnées monde). */
  polygon: Pt[];
  /** Bounding box du polygone (utile pour positionner un nœud SVG englobant). */
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
// CONVEX HULL (Andrew's monotone chain)
// ──────────────────────────────────────────────

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

export function convexHull(points: Pt[]): Pt[] {
  if (points.length <= 1) return points.slice();
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// ──────────────────────────────────────────────
// CHAIKIN SMOOTHING (closed polygon)
// ──────────────────────────────────────────────

export function chaikin(points: Pt[], iterations = 3): Pt[] {
  if (points.length < 3) return points.slice();
  let pts = points.slice();
  for (let it = 0; it < iterations; it++) {
    const next: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p0 = pts[i];
      const p1 = pts[(i + 1) % pts.length];
      next.push([0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]]);
      next.push([0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]]);
    }
    pts = next;
  }
  return pts;
}

// ──────────────────────────────────────────────
// PADDING PAR ÉCHANTILLONNAGE DE CERCLES
// ──────────────────────────────────────────────
// Plutôt que d'offsetter le polygone (calculs d'intersection d'arêtes
// parallèles, fragile aux concavités), on génère N points sur un cercle
// autour de chaque nœud puis on prend le hull convexe de l'ensemble. Le
// résultat épouse naturellement chaque nœud avec le padding voulu.

function circleSamples(cx: number, cy: number, radius: number, samples: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * Math.PI * 2;
    out.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]);
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
  /** Nombre d'échantillons par cercle (8 = bon compromis vitesse/lissage). */
  samples?: number;
  /** Itérations Chaikin (3 = blob doux ; 1 = quasi-polygone). */
  smoothIterations?: number;
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
  const samples = options.samples ?? 8;
  const smoothIterations = options.smoothIterations ?? 3;

  const components = connectedComponents(nodes, edges);
  const clusters: InfluenceCluster[] = [];

  for (const comp of components) {
    if (comp.length < minNodes) continue;

    // 1. Échantillonnage : un cercle autour de chaque nœud.
    const sampled: Pt[] = [];
    for (const n of comp) {
      const pos = positions.get(n.id);
      if (!pos) continue;
      const r = collisionRadiusOf(n) + nodePadding;
      sampled.push(...circleSamples(pos.x, pos.y, r, samples));
    }
    if (sampled.length < 3) continue;

    // 2. Hull convexe.
    const hull = convexHull(sampled);
    if (hull.length < 3) continue;

    // 3. Lissage Chaikin → blob organique.
    const polygon = chaikin(hull, smoothIterations);

    // 4. Bounding box.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of polygon) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    // 5. Couleur : contentieux dominant (compté sur les nœuds dossier).
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

    // 6. Identifiant stable pour la mémoïsation côté React.
    const id = comp.map(n => n.id).sort().join('|');

    clusters.push({
      id,
      nodeIds: comp.map(n => n.id),
      polygon,
      bbox: { minX, minY, maxX, maxY },
      color,
      dominantContentieux,
    });
  }

  return clusters;
}

// ──────────────────────────────────────────────
// SÉRIALISATION SVG
// ──────────────────────────────────────────────

/** Convertit un polygone (liste de points monde) en attribut `d` SVG. */
export function polygonToPath(points: Pt[], offsetX = 0, offsetY = 0): string {
  if (points.length === 0) return '';
  let d = `M ${(points[0][0] - offsetX).toFixed(1)} ${(points[0][1] - offsetY).toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${(points[i][0] - offsetX).toFixed(1)} ${(points[i][1] - offsetY).toFixed(1)}`;
  }
  d += ' Z';
  return d;
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
  /** Échantillons par cercle pour le hull. */
  samples?: number;
  /** Itérations Chaikin (généralement plus faible que pour le main hull,
   *  pour garder une silhouette nette qui se distingue du grand blob). */
  smoothIterations?: number;
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
  const samples = options.samples ?? 8;
  const smoothIterations = options.smoothIterations ?? 2;
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
    const dPos = positions.get(dId);
    if (!dPos) continue;

    const members: GraphNode[] = [dNode];
    for (const nb of adj.get(dId) || []) {
      const m = nodeById.get(nb);
      if (m?.type === 'mec' && (mecDossierCount.get(m.id) || 0) === 1) {
        members.push(m);
      }
    }
    if (members.length < minNodes) continue;

    // Échantillonnage cercles → hull → Chaikin (mêmes étapes que le main hull
    // mais avec un padding plus serré, pour visuellement "rentrer" dans le
    // grand blob).
    const sampled: Pt[] = [];
    for (const m of members) {
      const p = positions.get(m.id);
      if (!p) continue;
      const r = collisionRadiusOf(m) + padding;
      for (let i = 0; i < samples; i++) {
        const a = (i / samples) * Math.PI * 2;
        sampled.push([p.x + Math.cos(a) * r, p.y + Math.sin(a) * r]);
      }
    }
    if (sampled.length < 3) continue;

    const hull = convexHull(sampled);
    if (hull.length < 3) continue;
    const polygon = chaikin(hull, smoothIterations);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of polygon) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    subClusters.push({
      id: `sub_${dId}`,
      nodeIds: members.map(m => m.id),
      polygon,
      bbox: { minX, minY, maxX, maxY },
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
