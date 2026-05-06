// components/mindmap/useForceLayout.ts
// Calcule les positions x/y des nœuds du graphe via d3-force.
// Layout pré-calculé en mode synchrone (300 ticks) puis figé : l'utilisateur
// peut ensuite drag-and-drop manuellement les nœuds dans react-flow.

import { useMemo } from 'react';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import type { GraphEdge, GraphNode } from '@/utils/mindmapGraph';

export interface PositionedNode {
  id: string;
  x: number;
  y: number;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  radius: number;
}

const ITERATIONS = 300;
const CENTER_X = 0;
const CENTER_Y = 0;
const LINK_DISTANCE = 180;
const CHARGE_STRENGTH = -550;

function radiusOf(node: GraphNode): number {
  if (node.type === 'mec') {
    // 28 → 70 px selon le score normalisé
    return 28 + Math.round(node.score * 42);
  }
  // dossier : 24 → 56 selon nb MEC (capé à 8)
  const cap = Math.min(node.nbMec, 8);
  return 24 + Math.round((cap / 8) * 32);
}

// Padding ajouté autour de chaque rectangle dossier pour empêcher le contenu
// de deux badges de se toucher visuellement (même quand les rectangles eux-mêmes
// n'ont pas formellement de pixels en commun — l'œil lit ça comme un chevauchement).
const DOSSIER_BOX_PADDING = 8;
const COLLIDE_PADDING = 20;

/**
 * Dimensions réelles du rectangle dossier, calculées à partir du `numero`.
 * Doit rester synchronisée avec le rendu de DossierNodeView (MindmapCanvas) :
 * même formule de font-size, même chaîne mesurée. Mutualisée ici pour que
 * la collision et le placement utilisent strictement la même boîte.
 */
export function getDossierBox(node: GraphNode): { width: number; height: number } {
  const r = radiusOf(node);
  if (node.type === 'mec') {
    const d = r * 2;
    return { width: d, height: d };
  }
  const fontSize = Math.max(11, Math.min(14, r / 3));
  // ~0.62em par caractère en font-mono ; on prend la chaîne la plus longue
  // affichée (numero) et on ajoute le padding visuel + bordure.
  const charCount = (node.numero || '').length;
  const textWidth = charCount * fontSize * 0.62;
  const width = Math.max(120, Math.min(360, Math.ceil(textWidth + 2 * DOSSIER_BOX_PADDING + 16)));
  const height = Math.max(48, Math.round(r * 1.6));
  return { width, height };
}

// Rayon utilisé pour la détection de collision : pour un dossier (rectangle),
// on prend la demi-diagonale de la boîte réelle, sinon les dossiers larges
// se chevauchent puisque d3-force les considère comme des cercles.
export function getCollisionRadius(node: GraphNode): number {
  if (node.type === 'mec') return radiusOf(node);
  const { width, height } = getDossierBox(node);
  return Math.sqrt(width * width + height * height) / 2;
}

/**
 * Retourne une Map id → {x, y} stable tant que la liste des nœuds/arêtes ne change pas.
 * La structure des positions est figée après le calcul ; les drags utilisateur
 * sont gérés par react-flow indépendamment.
 *
 * `refreshKey` permet de forcer un recalcul même quand `nodes`/`edges` ont une
 * identité stable (utile en mode offline pour redistribuer le layout après un
 * ajout extérieur).
 */
export function useForceLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  refreshKey: number = 0,
): Map<string, PositionedNode> {
  return useMemo(() => {
    if (nodes.length === 0) return new Map();

    const simNodes: SimNode[] = nodes.map(n => ({
      id: n.id,
      radius: getCollisionRadius(n),
    }));

    const simLinks: SimulationLinkDatum<SimNode>[] = edges.map(e => ({
      source: e.source,
      target: e.target,
    }));

    const sim = forceSimulation(simNodes)
      .force(
        'link',
        forceLink<SimNode, SimulationLinkDatum<SimNode>>(simLinks)
          .id(d => d.id)
          .distance(LINK_DISTANCE)
          .strength(0.6),
      )
      .force('charge', forceManyBody<SimNode>().strength(CHARGE_STRENGTH))
      .force('center', forceCenter(CENTER_X, CENTER_Y))
      .force('collide', forceCollide<SimNode>().radius(d => d.radius + COLLIDE_PADDING).strength(1))
      .stop();

    for (let i = 0; i < ITERATIONS; i++) sim.tick();

    const positions = new Map<string, PositionedNode>();
    for (const n of simNodes) {
      const sn = n as SimNode & { x?: number; y?: number };
      positions.set(sn.id, { id: sn.id, x: sn.x ?? 0, y: sn.y ?? 0 });
    }
    return positions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, refreshKey]);
}

export function getNodeRadius(node: GraphNode): number {
  return radiusOf(node);
}
