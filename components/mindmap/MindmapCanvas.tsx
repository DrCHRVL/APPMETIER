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
import type { ClusterAnnotation } from '@/stores/useCartographieOverlayStore';
import { getCollisionRadius, getDossierBox, getNodeRadius, useForceLayout } from './useForceLayout';
import { buildInfluenceClusters, buildSubClusters, matchAnnotation, type InfluenceCluster } from './influenceHull';
import { computeClusterColors } from './clusterColors';

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
  /** Annotations manuelles des clusters (matchées par recouvrement Jaccard). */
  clusterAnnotations?: ClusterAnnotation[];
  /** Appelé quand l'utilisateur clique sur le label d'un cluster (création
   *  si existing absent, édition sinon). */
  onAnnotateCluster?: (cluster: InfluenceCluster, existing?: ClusterAnnotation) => void;
  /** Mode ego-network : si défini, ne montre clairement que les voisins
   *  jusqu'à `egoDepth` du nœud. Le reste passe en opacity dimmed. */
  egoNodeId?: string;
  egoDepth?: number;
  /** IDs canoniques des MEC marqués manuellement comme "à surveiller" :
   *  rendus avec un anneau rouge vif pour les repérer dans la carte. */
  pinnedIds?: string[];
  /** Ancrage zonal : regroupe les galaxies par service d'enquête dominant
   *  (puits de gravité doux au niveau macro). Effet au prochain recompactage. */
  groupByService?: boolean;
  onNodeClick?: (node: GraphNode) => void;
  onNodeDoubleClick?: (node: GraphNode) => void;
}

// ──────────────────────────────────────────────
// NŒUDS PERSONNALISÉS
// ──────────────────────────────────────────────

type MecNodeData = MecNode & { focused: boolean; radius: number; dimmed: boolean; isPinned: boolean };
type DossierNodeData = DossierNode & {
  focused: boolean;
  radius: number;
  width: number;
  height: number;
  /** Rotation appliquée au contenu (radians). Calculée pour minimiser le
   *  chevauchement visuel avec les arêtes entrantes. */
  rotation: number;
  /** Couleur de fond, dérivée du réseau (composante connexe), pâlie selon
   *  la distance au noyau du cluster. */
  color: string;
  /** Couleur de bordure, codant le contentieux d'origine (gardée même quand
   *  le fond est dérivé du réseau). */
  borderColor: string;
  contentieuxLabel: string;
  isExNihilo: boolean;
  dimmed: boolean;
};

type HullNodeData = {
  cluster: InfluenceCluster;
  containsFocus: boolean;
  /** Couleur effective : couleur custom de l'annotation si présente, sinon
   *  contentieux dominant. */
  effectiveColor: string;
  /** Variant visuel : main (grand blob) ou sub (mini-aire intra-composante). */
  variant: 'main' | 'sub';
  /** Si true, dim opacity (mode ego). */
  dimmed: boolean;
};

type ClusterLabelData = {
  cluster: InfluenceCluster;
  annotation?: ClusterAnnotation;
  effectiveColor: string;
  /** Largeur disponible (= bbox du hull) pour caler la longueur du label. */
  width: number;
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
  const { displayName, dossierIds, focused, radius, recent, contentieuxIds, dimmed, manualBonus, isPinned, isVictime, isSuspect, suspectRole } = data as MecNodeData & { isSuspect?: boolean; suspectRole?: string };
  const size = radius * 2;
  // MEC "pont" : présent sur ≥ 2 contentieux distincts → halo violet pour
  // matérialiser la transversalité (signal du score, mais visuel).
  const isBridge = contentieuxIds.length > 1;
  const isBoosted = (manualBonus || 0) > 0;
  // Marqueur de visibilité manuel : prime sur tout autre anneau pour rester
  // bien repérable dans la carte (l'utilisateur l'a posé exprès).
  const ringClass = isPinned
    ? 'ring-4 ring-red-500 shadow-lg'
    : focused
      ? 'ring-4 ring-yellow-300 shadow-lg scale-105'
      : isSuspect
        ? 'ring-2 ring-orange-400 shadow-md hover:scale-105'
        : isBoosted
          ? 'ring-2 ring-amber-400 shadow-md hover:scale-105'
          : isBridge
            ? 'ring-2 ring-violet-400/70 shadow-md hover:scale-105'
            : 'shadow-md hover:scale-105';
  const titleExtra = isSuspect
    ? ` • Suspect${suspectRole ? ` (${suspectRole})` : ''}`
    : isBridge
      ? ` • ${contentieuxIds.length} contentieux`
      : '';
  return (
    <div
      title={`${displayName} — ${dossierIds.length} dossier(s)${titleExtra}${isBoosted ? ' • importance manuelle' : ''}${isPinned ? ' • marqué' : ''}`}
      style={{ width: size, height: size, opacity: dimmed ? 0.18 : 1, transition: 'opacity 200ms' }}
      className={`
        flex items-center justify-center rounded-full text-white text-center
        font-medium select-none transition-all duration-150
        ${ringClass}
      `}
    >
      <Handle type="target" position={Position.Top} style={CENTERED_HANDLE_STYLE} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} style={CENTERED_HANDLE_STYLE} isConnectable={false} />
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: isSuspect
            ? 'linear-gradient(135deg, #7c2d12 0%, #9a3412 100%)'
            : recent
              ? 'linear-gradient(135deg, #1f2937 0%, #374151 100%)'
              : 'linear-gradient(135deg, #475569 0%, #64748b 100%)',
        }}
      />
      <span
        className="relative z-10 px-2 leading-tight flex flex-col items-center"
        style={{ fontSize: Math.max(10, Math.min(13, radius / 3.5)) }}
      >
        {displayName}
        {isVictime && (
          <span className="opacity-80 italic" style={{ fontSize: Math.max(8, Math.min(11, radius / 4.5)) }}>
            (Victime)
          </span>
        )}
        {isSuspect && (
          <span className="opacity-80 italic" style={{ fontSize: Math.max(8, Math.min(11, radius / 4.5)) }}>
            {suspectRole ? `(${suspectRole})` : '(Suspect)'}
          </span>
        )}
      </span>
    </div>
  );
};

const DossierNodeView = ({ data }: NodeProps<Node<DossierNodeData>>) => {
  const { numero, statut, focused, radius, width, height, rotation, color, borderColor, contentieuxLabel, nbMec, isExNihilo, dimmed } = data;
  const archived = statut === 'archive' && !isExNihilo;
  // Double codage couleur : le fond suit la couleur du réseau (atténuée
  // selon la distance au noyau) ; la bordure garde la couleur du
  // contentieux pour qu'on lise à la fois "réseau" et "type d'affaire".
  // Pour les ex nihilo, on ne sait pas dériver de réseau utile → fond blanc
  // pour rester neutre, bordure violette dashed comme avant.
  const baseAlpha = isExNihilo ? '#fff' : (archived ? '#f3f4f6' : color);
  const labelColor = borderColor;
  return (
    <div
      title={`${isExNihilo ? 'Dossier manuel' : contentieuxLabel} • ${numero} • ${nbMec} MEC`}
      style={{
        width,
        height,
        background: baseAlpha,
        borderColor,
        borderWidth: 3,
        borderStyle: isExNihilo ? 'dashed' : 'solid',
        transform: rotation ? `rotate(${rotation}rad)` : undefined,
        transformOrigin: '50% 50%',
        boxShadow: focused ? undefined : '0 2px 8px rgba(15, 23, 42, 0.15)',
        opacity: dimmed ? 0.18 : (archived ? 0.6 : 1),
        transition: 'opacity 200ms',
      }}
      className={`
        relative flex flex-col items-center justify-center rounded-lg
        text-center select-none transition-all duration-150
        ${focused
          ? 'ring-4 ring-yellow-300 shadow-lg scale-105'
          : 'hover:scale-105'
        }
      `}
    >
      <Handle type="target" position={Position.Top} style={CENTERED_HANDLE_STYLE} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} style={CENTERED_HANDLE_STYLE} isConnectable={false} />
      <span
        className="font-mono font-semibold leading-tight"
        style={{ color: labelColor, fontSize: Math.max(11, Math.min(14, radius / 3)) }}
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
// pan/zoom comme un nœud normal. variant 'sub' = mini-aire dossier-centrée
// rendue par-dessus le grand blob avec un fill plus marqué.
//
// La forme est l'union d'un cercle par membre et d'une capsule par arête
// intra-cluster. Group opacity (et non fillOpacity) sur le <g> : les
// chevauchements internes ne s'additionnent pas en surbrillance, et la
// silhouette résultante n'englobe que les vrais membres et leurs liens —
// jamais un nœud non-membre piégé spatialement entre eux.
const HullNodeView = ({ data }: NodeProps<Node<HullNodeData>>) => {
  const { cluster, containsFocus, effectiveColor, variant, dimmed } = data;
  const w = cluster.bbox.maxX - cluster.bbox.minX;
  const h = cluster.bbox.maxY - cluster.bbox.minY;
  const ox = cluster.bbox.minX;
  const oy = cluster.bbox.minY;

  const isSub = variant === 'sub';
  const fillOpacity = isSub
    ? (containsFocus ? 0.28 : 0.18)
    : (containsFocus ? 0.22 : 0.14);

  return (
    <svg
      width={w}
      height={h}
      style={{
        pointerEvents: 'none',
        overflow: 'visible',
        opacity: dimmed ? 0.15 : (containsFocus ? 1 : 0.85),
        transition: 'opacity 200ms',
      }}
    >
      <g opacity={fillOpacity} fill={effectiveColor} stroke={effectiveColor}>
        {cluster.capsules.map((cap, i) => (
          <line
            key={`cap_${i}`}
            x1={cap.x1 - ox}
            y1={cap.y1 - oy}
            x2={cap.x2 - ox}
            y2={cap.y2 - oy}
            strokeWidth={2 * cap.r}
            strokeLinecap="round"
            fill="none"
          />
        ))}
        {cluster.circles.map((c, i) => (
          <circle
            key={`c_${i}`}
            cx={c.x - ox}
            cy={c.y - oy}
            r={c.r}
            stroke="none"
          />
        ))}
      </g>
    </svg>
  );
};

// Label de cluster : pill cliquable centrée au-dessus du blob. Affiche le nom
// si annoté, ou un placeholder "+ Nommer ce réseau" sinon. Le clic est
// géré au niveau MindmapCanvas via onNodeClick (router par node.type).
const ClusterLabelView = ({ data }: NodeProps<Node<ClusterLabelData>>) => {
  const { annotation, effectiveColor } = data;
  const annotated = !!annotation;
  return (
    <div
      title={annotated ? `${annotation!.label}${annotation!.notes ? ` — ${annotation!.notes}` : ''}` : 'Nommer ce réseau'}
      className={`
        inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
        text-[11px] font-semibold whitespace-nowrap select-none
        cursor-pointer transition-all duration-150 hover:scale-105
        ${annotated
          ? 'bg-white shadow-md border-2'
          : 'bg-white/70 hover:bg-white border border-dashed text-slate-500 hover:text-slate-800'
        }
      `}
      style={annotated ? {
        borderColor: effectiveColor,
        color: effectiveColor,
      } : { borderColor: '#cbd5e1' }}
    >
      {annotated ? (
        <>
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: effectiveColor }}
          />
          {annotation!.label}
        </>
      ) : (
        <>+ Nommer ce réseau</>
      )}
    </div>
  );
};

const NODE_TYPES = {
  mec: MecNodeView,
  dossier: DossierNodeView,
  hull: HullNodeView,
  clusterLabel: ClusterLabelView,
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
  clusterAnnotations,
  onAnnotateCluster,
  egoNodeId,
  egoDepth = 2,
  pinnedIds,
  groupByService = false,
  onNodeClick,
  onNodeDoubleClick,
}) => {
  const pinnedSet = useMemo(() => new Set(pinnedIds || []), [pinnedIds]);
  const positions = useForceLayout(nodes, edges, refreshKey, { groupByService });
  const { setCenter, fitView } = useReactFlow();

  useEffect(() => {
    if (!centerRequest) return;
    const pos = positions.get(centerRequest.id);
    if (!pos) return;
    setCenter(pos.x, pos.y, { zoom: 1.2, duration: 600 });
  }, [centerRequest, positions, setCenter]);

  // Re-fit la caméra quand l'utilisateur clique "Actualiser" : la prop
  // `fitView` de ReactFlow ne tire qu'au montage, et ne corrige donc pas
  // les cas où la simulation a redistribué les nœuds très loin (cluster
  // explosé, cache désynchronisé, etc.). On relance fit explicitement
  // après chaque bump de refreshKey.
  useEffect(() => {
    if (refreshKey === 0) return; // mount initial : `fitView` du composant ReactFlow s'en charge
    fitView({ padding: 0.2, duration: 400 });
  }, [refreshKey, fitView]);

  const ctxColorById = useMemo(() => {
    const m = new Map<ContentieuxId, { color: string; label: string }>();
    for (const def of contentieuxDefs) m.set(def.id, { color: def.color, label: def.label });
    return m;
  }, [contentieuxDefs]);

  // Palette par réseau (composante connexe) : chaque réseau a une teinte
  // distincte, et au sein d'un réseau les nœuds sont pâlis selon leur
  // distance BFS au noyau (MEC le plus haut score / dossier le plus
  // central). Mémoïsé sur (nodes, edges) — recalculé seulement quand la
  // structure du graphe change, pas à chaque drag.
  const clusterColors = useMemo(
    () => computeClusterColors(nodes, edges),
    [nodes, edges],
  );

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
    const built = buildInfluenceClusters(
      nodes,
      edges,
      positions,
      getCollisionRadius,
      (id) => ctxColorById.get(id)?.color,
      { minNodes: 3, nodePadding: 32 },
    );
    // Override de la couleur du hull : on prend la teinte du réseau (palette
    // cluster) plutôt que celle du contentieux dominant. Deux réseaux du
    // même contentieux sont ainsi visuellement distincts.
    return built.map(c => {
      const networkColor = clusterColors.byComponent.get(c.id);
      return networkColor ? { ...c, color: networkColor } : c;
    });
  }, [nodes, edges, positions, ctxColorById, showInfluence, clusterColors]);

  // Sous-clusters : pour chaque grand blob, on calcule des mini-aires
  // centrées sur chaque dossier (regroupant ses MEC exclusifs). Les MEC
  // pivots restent hors des sub-clusters et restent ainsi visuellement
  // entre les sous-groupes.
  const subClusters = useMemo(() => {
    if (!showInfluence) return [];
    const out: InfluenceCluster[] = [];
    for (const c of influenceClusters) {
      out.push(...buildSubClusters(
        c, nodes, edges, positions, getCollisionRadius,
        { nodePadding: 18, minNodes: 3 },
      ));
    }
    return out;
  }, [influenceClusters, nodes, edges, positions, showInfluence]);

  // Mode ego-network : calcule l'ensemble des nœuds visibles (= ego + voisins
  // jusqu'à `egoDepth`). En dehors du mode, tout est visible.
  const egoVisibleSet = useMemo(() => {
    if (!egoNodeId) return null;
    const adj = new Map<string, string[]>();
    for (const e of edges) {
      if (!adj.has(e.source)) adj.set(e.source, []);
      if (!adj.has(e.target)) adj.set(e.target, []);
      adj.get(e.source)!.push(e.target);
      adj.get(e.target)!.push(e.source);
    }
    const visited = new Set<string>([egoNodeId]);
    let frontier = new Set<string>([egoNodeId]);
    for (let i = 0; i < egoDepth; i++) {
      const next = new Set<string>();
      for (const id of frontier) {
        for (const nb of adj.get(id) || []) {
          if (!visited.has(nb)) { visited.add(nb); next.add(nb); }
        }
      }
      frontier = next;
      if (frontier.size === 0) break;
    }
    return visited;
  }, [egoNodeId, edges, egoDepth]);

  const isDimmed = useCallback((id: string) => {
    if (!egoVisibleSet) return false;
    return !egoVisibleSet.has(id);
  }, [egoVisibleSet]);

  // Composante connexe contenant le nœud focus → on l'illumine plus fort.
  const focusedClusterId = useMemo(() => {
    if (!focusedId) return undefined;
    return influenceClusters.find(c => c.nodeIds.includes(focusedId))?.id;
  }, [influenceClusters, focusedId]);

  const rfNodes: Node[] = useMemo(() => {
    const out: Node[] = [];
    const annotations: ClusterAnnotation[] = clusterAnnotations || [];

    // Hulls d'abord (zIndex négatif) : ils restent derrière les nœuds réels.
    // Le label de cluster est rendu en sus, posé sur le bord supérieur du hull.
    for (const c of influenceClusters) {
      const annotation = matchAnnotation<ClusterAnnotation>(c, annotations);
      const effectiveColor = annotation?.color || c.color;
      // En mode ego, un cluster est "dimmed" si aucun de ses nœuds n'est
      // dans la zone visible.
      const clusterDimmed = !!egoVisibleSet && !c.nodeIds.some(id => egoVisibleSet.has(id));
      const data: HullNodeData = {
        cluster: c,
        containsFocus: c.id === focusedClusterId,
        effectiveColor,
        variant: 'main',
        dimmed: clusterDimmed,
      };
      out.push({
        id: `hull_${c.id}`,
        type: 'hull',
        position: { x: c.bbox.minX, y: c.bbox.minY },
        data: data as unknown as Record<string, unknown>,
        draggable: false,
        selectable: false,
        zIndex: -2,
        style: { pointerEvents: 'none' },
      } satisfies Node);

      // Label centré horizontalement, posé sur le bord haut du blob.
      // On laisse react-flow gérer le centrage horizontal via une largeur
      // fixe : on positionne à (centerX - 100) et on laisse le contenu se
      // centrer dans une boîte de 200px (le pill auto-shrink à son contenu).
      const cx = (c.bbox.minX + c.bbox.maxX) / 2;
      const labelData: ClusterLabelData = {
        cluster: c,
        annotation,
        effectiveColor,
        width: c.bbox.maxX - c.bbox.minX,
      };
      out.push({
        id: `clusterLabel_${c.id}`,
        type: 'clusterLabel',
        position: { x: cx - 100, y: c.bbox.minY - 22 },
        data: labelData as unknown as Record<string, unknown>,
        draggable: false,
        selectable: false,
        zIndex: 10,
        style: {
          width: 200,
          display: 'flex',
          justifyContent: 'center',
          opacity: clusterDimmed ? 0.2 : 1,
          transition: 'opacity 200ms',
        },
      } satisfies Node);
    }

    // Sous-clusters : rendus par-dessus le grand blob mais sous les nœuds
    // (zIndex -1, le grand blob est à -2). Pas de label, le dossier au
    // centre fait office de titre visuel.
    for (const sc of subClusters) {
      const subDimmed = !!egoVisibleSet && !sc.nodeIds.some(id => egoVisibleSet.has(id));
      const data: HullNodeData = {
        cluster: sc,
        containsFocus: focusedId ? sc.nodeIds.includes(focusedId) : false,
        effectiveColor: sc.color,
        variant: 'sub',
        dimmed: subDimmed,
      };
      out.push({
        id: `subhull_${sc.id}`,
        type: 'hull',
        position: { x: sc.bbox.minX, y: sc.bbox.minY },
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
      const dimmed = isDimmed(n.id);
      if (n.type === 'mec') {
        const data: MecNodeData = { ...n, focused, radius, dimmed, isPinned: pinnedSet.has(n.id) };
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
      const networkColor = clusterColors.byNode.get(n.id);
      // Bordure : couleur du contentieux (pour ex nihilo on garde le violet
      // historique). Fond : couleur du réseau (cluster), à 28% d'alpha pour
      // rester un tint discret. Le RGBA via hsl(...) n'étant pas trivial,
      // on superpose simplement la couleur HSL du réseau sur le fond clair
      // par opacity côté style — voir DossierNodeView.
      const borderColor = isExNihilo ? '#7c3aed' : (ctx?.color || CTX_FALLBACK_COLOR);
      const fill = isExNihilo
        ? '#fff'
        : (networkColor?.fill || (ctx?.color ? `${ctx.color}30` : CTX_FALLBACK_COLOR));
      const data: DossierNodeData = {
        ...n,
        focused,
        radius,
        width,
        height,
        rotation: dossierRotations.get(n.id) ?? 0,
        color: fill,
        borderColor,
        contentieuxLabel: ctx?.label || n.contentieuxId,
        isExNihilo,
        dimmed,
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
  }, [nodes, positions, focusedId, ctxColorById, dossierRotations, influenceClusters, subClusters, focusedClusterId, clusterAnnotations, egoVisibleSet, isDimmed, clusterColors, pinnedSet]);

  const rfEdges: Edge[] = useMemo(() => {
    return edges.map(e => {
      const highlighted = focusedId && (e.source === focusedId || e.target === focusedId);
      const isRens = e.kind === 'renseignement';
      const isSuspectEdge = e.kind === 'suspect';
      // Bezier doux dès qu'un des deux endpoints est connecté à plus d'un autre
      // nœud — sinon trait droit (cas dyade isolée, plus net).
      // Les liens "renseignement" et "suspect" utilisent toujours une courbe.
      const dMax = Math.max(nodeDegree.get(e.source) || 0, nodeDegree.get(e.target) || 0);
      const useCurve = isRens || isSuspectEdge || dMax > 1;
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: useCurve ? 'simplebezier' : 'straight',
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
          : isSuspectEdge
            ? {
                stroke: highlighted ? '#c2410c' : '#f97316',
                strokeWidth: highlighted ? 3 : 2,
                strokeDasharray: '5 4',
                strokeOpacity: highlighted ? 1 : 0.75,
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
      // Clic sur un label de cluster → ouvre le modal d'annotation.
      if (node.type === 'clusterLabel') {
        if (!onAnnotateCluster) return;
        const labelData = node.data as unknown as ClusterLabelData;
        onAnnotateCluster(labelData.cluster, labelData.annotation);
        return;
      }
      const original = nodes.find(n => n.id === node.id);
      if (original && onNodeClick) onNodeClick(original);
    },
    [nodes, onNodeClick, onAnnotateCluster],
  );

  const handleDoubleClick: NodeMouseHandler = useCallback(
    (_, node) => {
      const original = nodes.find(n => n.id === node.id);
      if (original && onNodeDoubleClick) onNodeDoubleClick(original);
    },
    [nodes, onNodeDoubleClick],
  );

  return (
    // touch-action:none permet à ReactFlow de gérer le pinch-zoom nativement
    // sur mobile sans conflit avec le scroll système.
    <div style={{ width: '100%', height: '100%', touchAction: 'none' }}>
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={NODE_TYPES}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      // minZoom à 0.1 : avec R=2200 + jitter 600, un cluster sain reste
      // sous ±3000 px (POSITION_CLAMP=15000 est un filet hors champ qui
      // ne devrait jamais se déclencher). fitView dimensionne donc à un
      // zoom typique de ~0.2–0.3, bien au-dessus de la borne basse.
      minZoom={0.1}
      maxZoom={2.5}
      onNodeClick={handleClick}
      onNodeDoubleClick={handleDoubleClick}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={24} size={1} color="#e2e8f0" />
      <Controls showInteractive={false} />
    </ReactFlow>
    </div>
  );
};

export const MindmapCanvas: React.FC<MindmapCanvasProps> = (props) => (
  <ReactFlowProvider>
    <MindmapCanvasInner {...props} />
  </ReactFlowProvider>
);
