// components/mindmap/MindmapCanvas.tsx
// Canvas react-flow rendant le sous-graphe (focus ou vue d'ensemble).
// Layout figé via d3-force, drag/zoom/pan gérés par react-flow.

'use client';

import React, { useCallback, useMemo } from 'react';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ContentieuxDefinition, ContentieuxId } from '@/types/userTypes';
import type { DossierNode, GraphEdge, GraphNode, MecNode } from '@/utils/mindmapGraph';
import { getNodeRadius, useForceLayout } from './useForceLayout';

// ──────────────────────────────────────────────
// PROPS
// ──────────────────────────────────────────────

interface MindmapCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  contentieuxDefs: ContentieuxDefinition[];
  /** ID du nœud sous focus (highlight visuel) */
  focusedId?: string;
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
  color: string;
  contentieuxLabel: string;
};

const HIDDEN_HANDLE_STYLE: React.CSSProperties = {
  opacity: 0,
  width: 1,
  height: 1,
  minWidth: 0,
  minHeight: 0,
  border: 'none',
  background: 'transparent',
  pointerEvents: 'none',
};

const MecNodeView = ({ data }: NodeProps<Node<MecNodeData>>) => {
  const { displayName, dossierIds, focused, radius, recent } = data;
  const size = radius * 2;
  return (
    <div
      title={`${displayName} — ${dossierIds.length} dossier(s)`}
      style={{ width: size, height: size }}
      className={`
        flex items-center justify-center rounded-full text-white text-center
        font-medium select-none transition-all duration-150
        ${focused
          ? 'ring-4 ring-yellow-300 shadow-lg scale-105'
          : 'shadow-md hover:scale-105'
        }
      `}
    >
      <Handle type="target" position={Position.Top} style={HIDDEN_HANDLE_STYLE} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} style={HIDDEN_HANDLE_STYLE} isConnectable={false} />
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
  const { numero, statut, focused, radius, color, contentieuxLabel, nbMec } = data;
  const width = Math.max(120, radius * 4);
  const height = Math.max(48, radius * 1.6);
  const archived = statut === 'archive';
  return (
    <div
      title={`${contentieuxLabel} • ${numero} • ${nbMec} MEC`}
      style={{
        width,
        height,
        background: archived ? '#f3f4f6' : `${color}15`,
        borderColor: color,
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
      <Handle type="target" position={Position.Top} style={HIDDEN_HANDLE_STYLE} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} style={HIDDEN_HANDLE_STYLE} isConnectable={false} />
      <span
        className="font-mono font-semibold leading-tight"
        style={{ color, fontSize: Math.max(11, Math.min(14, radius / 3)) }}
      >
        {numero}
      </span>
      <span className="text-[10px] text-slate-600 mt-0.5">
        {nbMec} MEC{statut === 'instruction' ? ' • instruction' : ''}
      </span>
    </div>
  );
};

const NODE_TYPES = {
  mec: MecNodeView,
  dossier: DossierNodeView,
} as const;

// ──────────────────────────────────────────────
// CANVAS
// ──────────────────────────────────────────────

const CTX_FALLBACK_COLOR = '#64748b';

const MindmapCanvasInner: React.FC<MindmapCanvasProps> = ({
  nodes,
  edges,
  contentieuxDefs,
  focusedId,
  onNodeClick,
  onNodeDoubleClick,
}) => {
  const positions = useForceLayout(nodes, edges);

  const ctxColorById = useMemo(() => {
    const m = new Map<ContentieuxId, { color: string; label: string }>();
    for (const def of contentieuxDefs) m.set(def.id, { color: def.color, label: def.label });
    return m;
  }, [contentieuxDefs]);

  const rfNodes: Node[] = useMemo(() => {
    return nodes.map(n => {
      const pos = positions.get(n.id);
      const radius = getNodeRadius(n);
      const focused = focusedId === n.id;
      if (n.type === 'mec') {
        const data: MecNodeData = { ...n, focused, radius };
        return {
          id: n.id,
          type: 'mec',
          position: { x: (pos?.x ?? 0) - radius, y: (pos?.y ?? 0) - radius },
          data: data as unknown as Record<string, unknown>,
          draggable: true,
        } satisfies Node;
      }
      const ctx = ctxColorById.get(n.contentieuxId);
      const data: DossierNodeData = {
        ...n,
        focused,
        radius,
        color: ctx?.color || CTX_FALLBACK_COLOR,
        contentieuxLabel: ctx?.label || n.contentieuxId,
      };
      const width = Math.max(120, radius * 4);
      const height = Math.max(48, radius * 1.6);
      return {
        id: n.id,
        type: 'dossier',
        position: { x: (pos?.x ?? 0) - width / 2, y: (pos?.y ?? 0) - height / 2 },
        data: data as unknown as Record<string, unknown>,
        draggable: true,
      } satisfies Node;
    });
  }, [nodes, positions, focusedId, ctxColorById]);

  const rfEdges: Edge[] = useMemo(() => {
    return edges.map(e => {
      const highlighted = focusedId && (e.source === focusedId || e.target === focusedId);
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        style: {
          stroke: highlighted ? '#facc15' : '#94a3b8',
          strokeWidth: highlighted ? 2.5 : 1.5,
        },
      };
    });
  }, [edges, focusedId]);

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
      <MiniMap
        zoomable
        pannable
        nodeColor={(n) => {
          if (n.type === 'mec') return '#475569';
          const data = n.data as DossierNodeData | undefined;
          return data?.color || CTX_FALLBACK_COLOR;
        }}
      />
    </ReactFlow>
  );
};

export const MindmapCanvas: React.FC<MindmapCanvasProps> = (props) => (
  <ReactFlowProvider>
    <MindmapCanvasInner {...props} />
  </ReactFlowProvider>
);
