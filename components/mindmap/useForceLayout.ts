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
const LINK_DISTANCE = 140;
const CHARGE_STRENGTH = -350;

function radiusOf(node: GraphNode): number {
  if (node.type === 'mec') {
    // 28 → 70 px selon le score normalisé
    return 28 + Math.round(node.score * 42);
  }
  // dossier : 24 → 56 selon nb MEC (capé à 8)
  const cap = Math.min(node.nbMec, 8);
  return 24 + Math.round((cap / 8) * 32);
}

/**
 * Retourne une Map id → {x, y} stable tant que la liste des nœuds/arêtes ne change pas.
 * La structure des positions est figée après le calcul ; les drags utilisateur
 * sont gérés par react-flow indépendamment.
 */
export function useForceLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
): Map<string, PositionedNode> {
  return useMemo(() => {
    if (nodes.length === 0) return new Map();

    const simNodes: SimNode[] = nodes.map(n => ({
      id: n.id,
      radius: radiusOf(n),
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
      .force('collide', forceCollide<SimNode>().radius(d => d.radius + 8).strength(0.9))
      .stop();

    for (let i = 0; i < ITERATIONS; i++) sim.tick();

    const positions = new Map<string, PositionedNode>();
    for (const n of simNodes) {
      const sn = n as SimNode & { x?: number; y?: number };
      positions.set(sn.id, { id: sn.id, x: sn.x ?? 0, y: sn.y ?? 0 });
    }
    return positions;
  }, [nodes, edges]);
}

export function getNodeRadius(node: GraphNode): number {
  return radiusOf(node);
}
