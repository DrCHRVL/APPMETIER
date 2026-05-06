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
