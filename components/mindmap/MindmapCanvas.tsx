// components/mindmap/MindmapCanvas.tsx
// Canvas react-flow rendant le graphe complet. Layout figé via d3-force,
// drag/zoom/pan gérés par react-flow. La prop centerRequest permet à
// l'extérieur de demander un recentrage animé sur un nœud précis.

'use client';

import React, { useCallback, useEffect, useMemo } from 'react';
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ContentieuxDefinition, ContentieuxId } from '@/types/userTypes';
import type { DossierNode, GraphEdge, GraphNode, MecNode } from '@/utils/mindmapGraph';
import { getCollisionRadius, getDossierBox, getNodeRadius, useForceLayout } from './useForceLayout';
import { buildInfluenceClusters, polygonToPath, type InfluenceCluster } from './influenceHull';

// ──────────────────────────────────────────────
// PROPS
// ──────────────────────────────────────────────

interface MindmapCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  contentieuxDefs: ContentieuxDefinition[];
  /** ID du nœud sélectionné (highlight visuel) */
  focusedId?: string;
  /** Demande de recentrage de la caméra. Le seq sert à re-déclencher l'animation
   *  même si on cible deux fois de suite le même nœud. */
  centerRequest?: { id: string; seq: number };
  /** Compteur incrémenté à chaque clic "actualiser" : force le recalcul du
   *  layout même si les références nodes/edges sont stables. */
  refreshKey?: number;
  /** Active/désactive le rendu des aires d'influence (par défaut activé). */
  showInfluence?: boolean;
  onNodeClick?: (node: GraphNode) => void;
  onNodeDoubleClick?: (node: GraphNode) => void;
}

// ──────────────────────────────────────────────
// NŒUDS PERSONNALISÉS
// ──────────────────────────────────────────────

type MecNodeData = MecNode & { focused: boolean; radius: number };
type DossierNodeData = DossierNode & {
  focused: boolean;
  radius: number;
  width: number;
  height: number;
  /** Rotation appliquée au contenu (radians). Calculée pour minimiser le
   *  chevauchement visuel avec les arêtes entrantes. */
  rotation: number;
  color: string;
  contentieuxLabel: string;
  isExNihilo: boolean;
};

type HullNodeData = {
  cluster: InfluenceCluster;
  containsFocus: boolean;
};

// Handles centrés (top:50%, left:50%) pour que les arêtes convergent au centre
// visuel de chaque nœud — indispensable pour que la rotation des dossiers
// n'introduise pas de décalage entre rectangle dessiné et endpoint d'arête.
const CENTERED_HANDLE_STYLE: React.CSSProperties = {
  opacity: 0,
  width: 1,
  height: 1,
  minWidth: 0,
  minHeight: 0,
  border: 'none',
  background: 'transparent',
  pointerEvents: 'none',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
};

const MecNodeView = ({ data }: NodeProps<Node<MecNodeData>>) => {
  const { displayName, dossierIds, focused, radius, recent, contentieuxIds } = data;
  const size = radius * 2;
  // MEC "pont" : présent sur ≥ 2 contentieux distincts → halo violet pour
  // matérialiser la transversalité (signal du score, mais visuel).
  const isBridge = contentieuxIds.length > 1;
  return (
    <div
      title={`${displayName} — ${dossierIds.length} dossier(s)${isBridge ? ` • ${contentieuxIds.length} contentieux` : ''}`}
      style={{ width: size, height: size }}
      className={`
        flex items-center justify-center rounded-full text-white text-center
        font-medium select-none transition-all duration-150
        ${focused
          ? 'ring-4 ring-yellow-300 shadow-lg scale-105'
          : isBridge
            ? 'ring-2 ring-violet-400/70 shadow-md hover:scale-105'
            : 'shadow-md hover:scale-105'
        }
      `}
    >
      <Handle type="target" position={Position.Top} style={CENTERED_HANDLE_STYLE} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} style={CENTERED_HANDLE_STYLE} isConnectable={false} />
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: recent
            ? 'linear-gradient(135deg, #1f2937 0%, #374151 100%)'
            : 'linear-gradient(135deg, #475569 0%, #64748b 100%)',
        }}
      />
      <span
        className="relative z-10 px-2 leading-tight"
        style={{ fontSize: Math.max(10, Math.min(13, radius / 3.5)) }}
      >
        {displayName}
      </span>
    </div>
  );
};

const DossierNodeView = ({ data }: NodeProps<Node<DossierNodeData>>) => {
  const { numero, statut, focused, radius, width, height, rotation, color, contentieuxLabel, nbMec, isExNihilo } = data;
  const archived = statut === 'archive' && !isExNihilo;
  return (
    <div
      title={`${isExNihilo ? 'Dossier manuel' : contentieuxLabel} • ${numero} • ${nbMec} MEC`}
      style={{
        width,
        height,
        background: isExNihilo ? '#fff' : (archived ? '#f3f4f6' : `${color}15`),
        borderColor: color,
        borderStyle: isExNihilo ? 'dashed' : 'solid',
        transform: rotation ? `rotate(${rotation}rad)` : undefined,
        transformOrigin: '50% 50%',
      }}
      className={`
        relative flex flex-col items-center justify-center rounded-lg border-2
        text-center select-none transition-all duration-150
        ${focused
          ? 'ring-4 ring-yellow-300 shadow-lg scale-105'
          : 'shadow-sm hover:scale-105'
        }
        ${archived ? 'opacity-60' : ''}
      `}
    >
      <Handle type="target" position={Position.Top} style={CENTERED_HANDLE_STYLE} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} style={CENTERED_HANDLE_STYLE} isConnectable={false} />
      <span
        className="font-mono font-semibold leading-tight"
        style={{ color, fontSize: Math.max(11, Math.min(14, radius / 3)) }}
      >
        {numero}
      </span>
      <span className="text-[10px] text-slate-600 mt-0.5">
        {isExNihilo
          ? `${nbMec} MEC • manuel`
          : `${nbMec} MEC${statut === 'instruction' ? ' • instruction' : ''}`}
      </span>
    </div>
  );
};

// Aire d'influence : SVG rendu en arrière-plan (zIndex négatif) qui suit
// pan/zoom comme un nœud normal.
const HullNodeView = ({ data }: NodeProps<Node<HullNodeData>>) => {
  const { cluster, containsFocus } = data;
  const w = cluster.bbox.maxX - cluster.bbox.minX;
  const h = cluster.bbox.maxY - cluster.bbox.minY;
  const path = polygonToPath(cluster.polygon, cluster.bbox.minX, cluster.bbox.minY);
  return (
    <svg
      width={w}
      height={h}
      style={{
        pointerEvents: 'none',
        overflow: 'visible',
        opacity: containsFocus ? 1 : 0.85,
        transition: 'opacity 200ms',
      }}
    >
      <path
        d={path}
        fill={cluster.color}
        fillOpacity={containsFocus ? 0.18 : 0.10}
        stroke={cluster.color}
        strokeOpacity={containsFocus ? 0.55 : 0.30}
        strokeWidth={containsFocus ? 2 : 1.25}
        strokeLinejoin="round"
      />
    </svg>
  );
};

const NODE_TYPES = {
  mec: MecNodeView,
  dossier: DossierNodeView,
  hull: HullNodeView,
} as const;

// ──────────────────────────────────────────────
// CALCUL DES ROTATIONS DOSSIER
// ──────────────────────────────────────────────
//
// Chaque dossier est tourné pour que son grand axe soit perpendiculaire à
// la direction moyenne de ses arêtes : les liens entrent par les côtés
// courts plutôt que de traverser le label. Capé à ±20° pour que le texte
// reste lisible, snappé à 0° en deçà de ~7° pour éviter les rotations
// minuscules visuellement bruitées.

const ROTATION_CAP = Math.PI / 9;       // 20°
const ROTATION_SNAP_THRESHOLD = Math.PI / 24; // ~7.5°

function computeDossierRotations(
  nodes: GraphNode[],
  edges: GraphEdge[],
  positions: Map<string, { x: number; y: number }>,
): Map<string, number> {
  const out = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    if (!adj.has(e.target)) adj.set(e.target, []);
    adj.get(e.source)!.push(e.target);
    adj.get(e.target)!.push(e.source);
  }
  for (const n of nodes) {
    if (n.type !== 'dossier') continue;
    const pos = positions.get(n.id);
    if (!pos) { out.set(n.id, 0); continue; }
    const neighbors = adj.get(n.id) || [];
    if (neighbors.length < 2) { out.set(n.id, 0); continue; }

    let mx = 0, my = 0, count = 0;
    for (const nbId of neighbors) {
      const np = positions.get(nbId);
      if (!np) continue;
      const dx = np.x - pos.x;
      const dy = np.y - pos.y;
      const len = Math.hypot(dx, dy) || 1;
      mx += dx / len;
      my += dy / len;
      count++;
    }
    if (count === 0) { out.set(n.id, 0); continue; }

    // Direction moyenne des arêtes → on veut le grand axe perpendiculaire.
    let angle = Math.atan2(my, mx) + Math.PI / 2;
    // Normalise dans (-π/2, π/2] : le rectangle est symétrique à 180°.
    while (angle > Math.PI / 2) angle -= Math.PI;
    while (angle <= -Math.PI / 2) angle += Math.PI;
    if (angle > ROTATION_CAP) angle = ROTATION_CAP;
    if (angle < -ROTATION_CAP) angle = -ROTATION_CAP;
    if (Math.abs(angle) < ROTATION_SNAP_THRESHOLD) angle = 0;

    out.set(n.id, angle);
  }
  return out;
}

// ──────────────────────────────────────────────
// CANVAS
// ──────────────────────────────────────────────

const CTX_FALLBACK_COLOR = '#64748b';

const MindmapCanvasInner: React.FC<MindmapCanvasProps> = ({
  nodes,
  edges,
  contentieuxDefs,
  focusedId,
  centerRequest,
  refreshKey = 0,
  showInfluence = true,
  onNodeClick,
  onNodeDoubleClick,
}) => {
  const positions = useForceLayout(nodes, edges, refreshKey);
  const { setCenter } = useReactFlow();

  useEffect(() => {
    if (!centerRequest) return;
    const pos = positions.get(centerRequest.id);
    if (!pos) return;
    setCenter(pos.x, pos.y, { zoom: 1.2, duration: 600 });
  }, [centerRequest, positions, setCenter]);

  const ctxColorById = useMemo(() => {
    const m = new Map<ContentieuxId, { color: string; label: string }>();
    for (const def of contentieuxDefs) m.set(def.id, { color: def.color, label: def.label });
    return m;
  }, [contentieuxDefs]);

  // Degré (data edges uniquement) par nœud → utilisé pour décider quelles
  // arêtes courber : un MEC à plusieurs dossiers gagne des bezier pour
  // séparer visuellement la "patte d'oie" qu'on aurait en lignes droites.
  const nodeDegree = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of edges) {
      if (e.kind !== 'data') continue;
      m.set(e.source, (m.get(e.source) || 0) + 1);
      m.set(e.target, (m.get(e.target) || 0) + 1);
    }
    return m;
  }, [edges]);

  const dossierRotations = useMemo(
    () => computeDossierRotations(nodes, edges, positions),
    [nodes, edges, positions],
  );

  const influenceClusters = useMemo(() => {
    if (!showInfluence) return [];
    return buildInfluenceClusters(
      nodes,
      edges,
      positions,
      getCollisionRadius,
      (id) => ctxColorById.get(id)?.color,
      { minNodes: 3, nodePadding: 32, samples: 10, smoothIterations: 3 },
    );
  }, [nodes, edges, positions, ctxColorById, showInfluence]);

  // Composante connexe contenant le nœud focus → on l'illumine plus fort.
  const focusedClusterId = useMemo(() => {
    if (!focusedId) return undefined;
    return influenceClusters.find(c => c.nodeIds.includes(focusedId))?.id;
  }, [influenceClusters, focusedId]);

  const rfNodes: Node[] = useMemo(() => {
    const out: Node[] = [];

    // Hulls d'abord (zIndex négatif) : ils restent derrière les nœuds réels.
    for (const c of influenceClusters) {
      const data: HullNodeData = { cluster: c, containsFocus: c.id === focusedClusterId };
      out.push({
        id: `hull_${c.id}`,
        type: 'hull',
        position: { x: c.bbox.minX, y: c.bbox.minY },
        data: data as unknown as Record<string, unknown>,
        draggable: false,
        selectable: false,
        zIndex: -1,
        style: { pointerEvents: 'none' },
      } satisfies Node);
    }

    for (const n of nodes) {
      const pos = positions.get(n.id);
      const radius = getNodeRadius(n);
      const focused = focusedId === n.id;
      if (n.type === 'mec') {
        const data: MecNodeData = { ...n, focused, radius };
        out.push({
          id: n.id,
          type: 'mec',
          position: { x: (pos?.x ?? 0) - radius, y: (pos?.y ?? 0) - radius },
          data: data as unknown as Record<string, unknown>,
          draggable: true,
        } satisfies Node);
        continue;
      }
      const ctx = ctxColorById.get(n.contentieuxId);
      const isExNihilo = !!n.isExNihilo;
      const { width, height } = getDossierBox(n);
      const data: DossierNodeData = {
        ...n,
        focused,
        radius,
        width,
        height,
        rotation: dossierRotations.get(n.id) ?? 0,
        color: isExNihilo ? '#7c3aed' : (ctx?.color || CTX_FALLBACK_COLOR),
        contentieuxLabel: ctx?.label || n.contentieuxId,
        isExNihilo,
      };
      out.push({
        id: n.id,
        type: 'dossier',
        position: { x: (pos?.x ?? 0) - width / 2, y: (pos?.y ?? 0) - height / 2 },
        data: data as unknown as Record<string, unknown>,
        draggable: true,
      } satisfies Node);
    }
    return out;
  }, [nodes, positions, focusedId, ctxColorById, dossierRotations, influenceClusters, focusedClusterId]);

  const rfEdges: Edge[] = useMemo(() => {
    return edges.map(e => {
      const highlighted = focusedId && (e.source === focusedId || e.target === focusedId);
      const isRens = e.kind === 'renseignement';
      // Bezier doux dès qu'un des deux endpoints est connecté à plus d'un autre
      // nœud — sinon trait droit (cas dyade isolée, plus net).
      const dMax = Math.max(nodeDegree.get(e.source) || 0, nodeDegree.get(e.target) || 0);
      const useCurve = !isRens && dMax > 1;
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: isRens ? 'straight' : (useCurve ? 'simplebezier' : 'straight'),
        label: isRens ? e.label : undefined,
        labelStyle: isRens ? { fill: '#1d4ed8', fontSize: 11, fontWeight: 600 } : undefined,
        labelBgStyle: isRens ? { fill: '#eff6ff' } : undefined,
        labelBgPadding: isRens ? ([4, 2] as [number, number]) : undefined,
        labelBgBorderRadius: isRens ? 3 : undefined,
        style: isRens
          ? {
              stroke: highlighted ? '#1e40af' : '#3b82f6',
              strokeWidth: highlighted ? 4 : 3,
              strokeDasharray: '8 5',
              strokeLinecap: 'round',
            }
          : {
              stroke: highlighted ? '#f59e0b' : '#64748b',
              strokeWidth: highlighted ? 4 : 2.5,
              strokeOpacity: highlighted ? 1 : 0.85,
              strokeLinecap: 'round',
            },
      };
    });
  }, [edges, focusedId, nodeDegree]);

  const handleClick: NodeMouseHandler = useCallback(
    (_, node) => {
      const original = nodes.find(n => n.id === node.id);
      if (original && onNodeClick) onNodeClick(original);
    },
    [nodes, onNodeClick],
  );

  const handleDoubleClick: NodeMouseHandler = useCallback(
    (_, node) => {
      const original = nodes.find(n => n.id === node.id);
      if (original && onNodeDoubleClick) onNodeDoubleClick(original);
    },
    [nodes, onNodeDoubleClick],
  );

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={NODE_TYPES}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.1}
      maxZoom={2.5}
      onNodeClick={handleClick}
      onNodeDoubleClick={handleDoubleClick}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={24} size={1} color="#e2e8f0" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
};

export const MindmapCanvas: React.FC<MindmapCanvasProps> = (props) => (
  <ReactFlowProvider>
    <MindmapCanvasInner {...props} />
  </ReactFlowProvider>
);
