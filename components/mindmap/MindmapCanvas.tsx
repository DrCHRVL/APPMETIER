// components/mindmap/MindmapCanvas.tsx
// Canvas react-flow rendant le graphe complet. Layout figé via d3-force,
// drag/zoom/pan gérés par react-flow. La prop centerRequest permet à
// l'extérieur de demander un recentrage animé sur un nœud précis.

'use client';

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ContentieuxDefinition, ContentieuxId } from '@/types/userTypes';
import type { CartographieLayoutConfig } from '@/types/cartographieTypes';
import type { DossierNode, GraphEdge, GraphNode, MecNode } from '@/utils/mindmapGraph';
import type { ClusterAnnotation } from '@/stores/useCartographieOverlayStore';
import { getCollisionRadius, getDossierBox, getNodeRadius, useForceLayout } from './useForceLayout';
import { buildInfluenceClusters, buildSubClusters, matchAnnotation, type InfluenceCluster } from './influenceHull';
import { computeClusterColors } from './clusterColors';

// ──────────────────────────────────────────────
// PROPS
// ──────────────────────────────────────────────

/** Tolérance (px) entre l'appui et le relâchement en dessous de laquelle un
 *  geste sur le fond compte comme un clic et non comme un déplacement. */
const PANE_CLICK_MAX_DRAG = 4;

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
  /** Surbrillance externe (ex. camp choisi dans la légende) : seuls ces ids
   *  restent nets, le reste est estompé. null/undefined = pas de filtre. */
  highlightSet?: Set<string> | null;
  /** IDs canoniques des MEC marqués manuellement comme "à surveiller" :
   *  rendus avec un anneau rouge vif pour les repérer dans la carte. */
  pinnedIds?: string[];
  /** Ancrage zonal : regroupe les galaxies par service d'enquête dominant
   *  (puits de gravité doux au niveau macro). Effet au prochain recompactage. */
  groupByService?: boolean;
  /** Paramètres avancés d'espacement (réglages du module Cartographie). Effet
   *  au prochain recompactage. */
  layout?: CartographieLayoutConfig;
  onNodeClick?: (node: GraphNode) => void;
  onNodeDoubleClick?: (node: GraphNode) => void;
  /** Clic dans le vide de la carte (fond, hors nœud et hors aire) : sert à
   *  relâcher la sélection en cours. Un déplacement de la carte (pan) n'en
   *  déclenche pas — cf. le garde-fou de distance dans le composant. */
  onPaneClick?: () => void;
}

// ──────────────────────────────────────────────
// NŒUDS PERSONNALISÉS
// ──────────────────────────────────────────────

type MecNodeData = MecNode & { focused: boolean; radius: number; dimmed: boolean; isPinned: boolean } & Record<string, unknown>;
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
} & Record<string, unknown>;

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
  const { displayName, dossierIds, focused, radius, recent, contentieuxIds, dimmed, manualBonus, isPinned, isVictime, isSuspect, suspectRole, isCondamne, campLabel, role } = data as MecNodeData & { isSuspect?: boolean; suspectRole?: string; isCondamne?: boolean; campLabel?: string; role?: string };
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
        : isCondamne
          ? 'ring-2 ring-emerald-500 shadow-md hover:scale-105'
          : isBoosted
            ? 'ring-2 ring-amber-400 shadow-md hover:scale-105'
            : isBridge
              ? 'ring-2 ring-violet-400/70 shadow-md hover:scale-105'
              : 'shadow-md hover:scale-105';
  const titleExtra = (isSuspect
    ? ` • Suspect${suspectRole ? ` (${suspectRole})` : ''}`
    : isCondamne
      ? ' • Condamné (résultat d\'audience)'
      : isBridge
        ? ` • ${contentieuxIds.length} contentieux`
        : '')
    + (campLabel ? ` • camp ${campLabel}` : '')
    + (role ? ` • ${role === 'chef_reseau' ? 'chef de réseau' : 'lieutenant'}` : '');
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
          // La couleur de camp ne teinte PAS la bulle : elle vit dans l'aura
          // peinte au niveau des sphères de réseau (cf. CampAuraView). La
          // bulle garde ses codes habituels (suspect / condamné / récent).
          background: isSuspect
            ? 'linear-gradient(135deg, #7c2d12 0%, #9a3412 100%)'
            : isCondamne
              ? 'linear-gradient(135deg, #064e3b 0%, #047857 100%)'
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
        {isCondamne && (
          <span className="opacity-80 italic" style={{ fontSize: Math.max(8, Math.min(11, radius / 4.5)) }}>
            (Condamné)
          </span>
        )}
        {role && (
          <span className="opacity-90 font-semibold" style={{ fontSize: Math.max(8, Math.min(11, radius / 4.5)) }}>
            {role === 'chef_reseau' ? '★ Chef de réseau' : '☆ Lieutenant'}
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

// ──────────────────────────────────────────────
// AURA DE CAMP
// ──────────────────────────────────────────────
//
// La couleur d'un camp ne teinte pas les bulles des personnes : elle est
// peinte DANS la sphère de réseau, comme une nappe qui suit les membres du
// camp (un disque flouté par membre + un tube le long des liens entre
// membres proches). Le flou gaussien + le mode de fusion « multiply » font
// que deux camps qui se touchent se brouillent et se mélangent à la
// frontière — on lit la zone de friction d'un coup d'œil.

/** Rayon ajouté autour de chaque membre pour la nappe de camp (px). */
const CAMP_AURA_PADDING = 34;
/** Rayon du flou gaussien (px monde). */
const CAMP_AURA_BLUR = 22;
/** Longueur max d'un tube entre deux membres liés : au-delà, on ne peint
 *  pas de traînée de couleur à travers la carte (chaque poche du camp garde
 *  sa propre nappe). */
const CAMP_AURA_MAX_CAPSULE = 700;

type CampAuraData = {
  label: string;
  color: string;
  circles: Array<{ x: number; y: number; r: number }>;
  capsules: Array<{ x1: number; y1: number; x2: number; y2: number; r: number }>;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  dimmed: boolean;
} & Record<string, unknown>;

const CampAuraView = ({ data, id }: NodeProps<Node<CampAuraData>>) => {
  const { color, circles, capsules, bbox, dimmed, label } = data;
  const pad = CAMP_AURA_BLUR * 2;
  const w = bbox.maxX - bbox.minX + pad * 2;
  const h = bbox.maxY - bbox.minY + pad * 2;
  const ox = bbox.minX - pad;
  const oy = bbox.minY - pad;
  const filterId = `campblur_${id}`;
  return (
    <svg
      width={w}
      height={h}
      style={{
        pointerEvents: 'none',
        overflow: 'visible',
        // multiply : deux nappes qui se recouvrent se MÉLANGENT (rouge ∩
        // bleu → violet sombre), et la nappe se fond dans la sphère de
        // réseau au lieu de la masquer.
        mixBlendMode: 'multiply',
        opacity: dimmed ? 0.1 : 1,
        transition: 'opacity 200ms',
      }}
      aria-label={`Camp ${label}`}
    >
      <defs>
        <filter id={filterId} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation={CAMP_AURA_BLUR} />
        </filter>
      </defs>
      <g filter={`url(#${filterId})`} opacity={0.34} fill={color} stroke={color}>
        {capsules.map((cap, i) => (
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
        {circles.map((c, i) => (
          <circle key={`c_${i}`} cx={c.x - ox} cy={c.y - oy} r={c.r} stroke="none" />
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
  campAura: CampAuraView,
  clusterLabel: ClusterLabelView,
} as const;

// ──────────────────────────────────────────────
// LIENS RENSEIGNEMENT : CONTOURNEMENT D'OBSTACLES
// ──────────────────────────────────────────────
//
// Un lien de renseignement peut relier deux réseaux éloignés ; tracé en
// bezier « neutre », il traversait de part en part les dossiers posés sur
// son chemin (illisible : le trait semblait rattacher des affaires qui
// n'ont rien à voir). On calcule donc, pour chaque lien renseignement, un
// point de contrôle qui fait bomber la courbe DU CÔTÉ LE MOINS ENCOMBRÉ,
// assez pour passer à distance des nœuds interposés.
//
// Modèle : courbe quadratique B(t) = (1-t)²A + 2t(1-t)C + t²B. L'écart à
// la corde vaut 2t(1-t)·(C - M) (M = milieu de la corde), maximal en t=0.5
// où il vaut |C - M| / 2. Pour dégager un obstacle situé au paramètre t₀ à
// distance signée s de la corde, il faut |C - M| ≥ (s + r + marge) / (2t₀(1-t₀)).

const DETOUR_MARGIN = 30;      // marge visuelle autour des obstacles (px)
const DETOUR_MAX_BULGE = 900;  // amplitude max du point de contrôle (px)

/**
 * Point de contrôle de contournement pour le segment A→B, ou null si la
 * ligne droite ne traverse aucun nœud tiers. `obstacles` = centres +
 * rayons de collision de tous les nœuds sauf les extrémités.
 */
export function computeRensDetour(
  a: { x: number; y: number },
  b: { x: number; y: number },
  obstacles: Array<{ x: number; y: number; r: number }>,
): { cx: number; cy: number } | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 40) return null;
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux; // normale (côté « + »)

  // Obstacles qui bloquent réellement la corde, avec leur paramètre et
  // leur distance signée à la ligne.
  let needPlus = 0;   // amplitude requise pour passer côté +
  let needMinus = 0;  // amplitude requise pour passer côté −
  let blocked = false;
  for (const o of obstacles) {
    const vx = o.x - a.x, vy = o.y - a.y;
    const t = (vx * ux + vy * uy) / len;
    if (t <= 0.03 || t >= 0.97) continue; // collé à une extrémité : ignorer
    const s = vx * nx + vy * ny;          // distance signée à la corde
    const clearance = o.r + DETOUR_MARGIN;
    if (Math.abs(s) >= clearance) continue;
    blocked = true;
    // t borné pour ne pas faire exploser l'amplitude près des extrémités.
    const tc = Math.min(0.85, Math.max(0.15, t));
    const denom = 2 * tc * (1 - tc);
    // Passer côté + exige de dépasser s + clearance ; côté − l'inverse.
    needPlus = Math.max(needPlus, (s + clearance) / denom);
    needMinus = Math.max(needMinus, (clearance - s) / denom);
  }
  if (!blocked) return null;

  const side = needPlus <= needMinus ? 1 : -1;
  const bulge = Math.min(side === 1 ? needPlus : needMinus, DETOUR_MAX_BULGE);
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  return { cx: mx + nx * side * bulge, cy: my + ny * side * bulge };
}

type RensDetourEdgeData = {
  cx: number;
  cy: number;
  label?: string;
  highlighted?: boolean;
} & Record<string, unknown>;

/** Edge custom : bezier quadratique passant par le point de contrôle de
 *  contournement, avec le libellé posé au sommet de la courbe (là où le
 *  trait est le plus loin des réseaux traversés). */
const RensDetourEdge = ({ sourceX, sourceY, targetX, targetY, data, style, markerEnd }: EdgeProps) => {
  const d = (data || {}) as RensDetourEdgeData;
  const cx = d.cx ?? (sourceX + targetX) / 2;
  const cy = d.cy ?? (sourceY + targetY) / 2;
  const path = `M ${sourceX},${sourceY} Q ${cx},${cy} ${targetX},${targetY}`;
  // Sommet de la quadratique (t = 0.5).
  const lx = 0.25 * sourceX + 0.5 * cx + 0.25 * targetX;
  const ly = 0.25 * sourceY + 0.5 * cy + 0.25 * targetY;
  return (
    <>
      <BaseEdge path={path} style={style} markerEnd={markerEnd} />
      {d.label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`,
              pointerEvents: 'none',
            }}
            className="rounded px-1 py-0.5 text-[11px] font-semibold"
          >
            <span style={{ background: '#eff6ff', color: '#1d4ed8', padding: '2px 4px', borderRadius: 3 }}>
              {d.label}
            </span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};

const EDGE_TYPES = {
  rensDetour: RensDetourEdge,
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
  highlightSet,
  pinnedIds,
  groupByService = false,
  layout,
  onNodeClick,
  onNodeDoubleClick,
  onPaneClick,
}) => {
  const pinnedSet = useMemo(() => new Set(pinnedIds || []), [pinnedIds]);
  const positions = useForceLayout(nodes, edges, refreshKey, { groupByService, layout });
  const { setCenter, fitView } = useReactFlow();

  // Recentrage : UNE SEULE fois par demande explicite (recherche, Top 10,
  // panneau de gestion). `positions` est une Map reconstruite à chaque
  // rebuild du graphe — or les sources distantes sont repullées en boucle
  // par le service de contributions. Sans ce garde-fou sur `seq`, chaque
  // sync refaisait tourner l'effet et ramenait la caméra sur le dernier
  // nœud cherché : impossible de naviguer sans être tiré vers l'ancre.
  const handledCenterSeqRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!centerRequest) return;
    if (handledCenterSeqRef.current === centerRequest.seq) return;
    const pos = positions.get(centerRequest.id);
    // Layout pas encore stabilisé pour ce nœud : on ne consomme PAS la
    // demande, un prochain calcul de positions la rejouera.
    if (!pos) return;
    handledCenterSeqRef.current = centerRequest.seq;
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

  // Nappes de camp : pour chaque camp, l'union (floutée au rendu) d'un
  // disque par membre et d'un tube par lien entre membres proches. La
  // couleur du camp vit ICI, dans la sphère de réseau — pas sur les bulles.
  const campAuras = useMemo(() => {
    const byCamp = new Map<string, { color: string; members: MecNode[] }>();
    for (const n of nodes) {
      if (n.type !== 'mec' || !n.campLabel) continue;
      let entry = byCamp.get(n.campLabel);
      if (!entry) {
        entry = { color: n.campColor || '#475569', members: [] };
        byCamp.set(n.campLabel, entry);
      }
      entry.members.push(n);
    }
    type AuraGeom = {
      label: string;
      color: string;
      circles: Array<{ x: number; y: number; r: number }>;
      capsules: Array<{ x1: number; y1: number; x2: number; y2: number; r: number }>;
      bbox: { minX: number; minY: number; maxX: number; maxY: number };
      memberIds: string[];
    };
    if (byCamp.size === 0) return [] as AuraGeom[];

    const out: AuraGeom[] = [];
    for (const [label, { color, members }] of byCamp) {
      const memberSet = new Set(members.map(m => m.id));
      const circles: CampAuraData['circles'] = [];
      const posById = new Map<string, { x: number; y: number }>();
      for (const m of members) {
        const p = positions.get(m.id);
        if (!p) continue;
        posById.set(m.id, p);
        circles.push({ x: p.x, y: p.y, r: getCollisionRadius(m) + CAMP_AURA_PADDING });
      }
      if (circles.length === 0) continue;
      const capsules: CampAuraData['capsules'] = [];
      // Deux membres du même camp DANS le même dossier : reliés via le
      // dossier (arête mec→dossier chacun), pas entre eux — on capsule
      // directement les paires de membres suffisamment proches pour que la
      // nappe soit continue autour d'un même système.
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const a = posById.get(members[i].id);
          const b = posById.get(members[j].id);
          if (!a || !b) continue;
          const d = Math.hypot(b.x - a.x, b.y - a.y);
          const linked = members[i].dossierIds.some(did => members[j].dossierIds.includes(did));
          if (d > CAMP_AURA_MAX_CAPSULE) continue;
          if (!linked && d > CAMP_AURA_MAX_CAPSULE / 2) continue;
          capsules.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, r: CAMP_AURA_PADDING });
        }
      }
      // Liens de renseignement entre membres (peuvent dépasser la distance
      // « proche » : le trait existe, la nappe le suit — borné quand même).
      for (const e of edges) {
        if (e.kind !== 'renseignement') continue;
        if (!memberSet.has(e.source) || !memberSet.has(e.target)) continue;
        const a = posById.get(e.source);
        const b = posById.get(e.target);
        if (!a || !b) continue;
        if (Math.hypot(b.x - a.x, b.y - a.y) > CAMP_AURA_MAX_CAPSULE) continue;
        capsules.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, r: CAMP_AURA_PADDING * 0.7 });
      }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const c of circles) {
        if (c.x - c.r < minX) minX = c.x - c.r;
        if (c.y - c.r < minY) minY = c.y - c.r;
        if (c.x + c.r > maxX) maxX = c.x + c.r;
        if (c.y + c.r > maxY) maxY = c.y + c.r;
      }
      out.push({
        label, color, circles, capsules,
        bbox: { minX, minY, maxX, maxY },
        memberIds: members.map(m => m.id),
      });
    }
    return out;
  }, [nodes, edges, positions]);

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
    if (egoVisibleSet && !egoVisibleSet.has(id)) return true;
    if (highlightSet && !highlightSet.has(id)) return true;
    return false;
  }, [egoVisibleSet, highlightSet]);

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
      const clusterDimmed = (!!egoVisibleSet && !c.nodeIds.some(id => egoVisibleSet.has(id)))
        || (!!highlightSet && !c.nodeIds.some(id => highlightSet.has(id)));
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
      const subDimmed = (!!egoVisibleSet && !sc.nodeIds.some(id => egoVisibleSet.has(id)))
        || (!!highlightSet && !sc.nodeIds.some(id => highlightSet.has(id)));
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

    // Nappes de camp : au-dessus des sphères et sous les nœuds. Rendues
    // APRÈS les sub-hulls (même zIndex → ordre du tableau) pour que la
    // couleur du camp reste visible par-dessus les mini-aires.
    for (const aura of campAuras) {
      // Une nappe s'estompe quand un filtre actif (ego ou surbrillance d'un
      // autre camp) exclut TOUS ses membres.
      const dimmed = !!highlightSet && !aura.memberIds.some(id => highlightSet.has(id));
      const egoDimmedAura = !!egoVisibleSet && !aura.memberIds.some(id => egoVisibleSet.has(id));
      const data: CampAuraData = {
        label: aura.label,
        color: aura.color,
        circles: aura.circles,
        capsules: aura.capsules,
        bbox: aura.bbox,
        dimmed: dimmed || egoDimmedAura,
      };
      out.push({
        id: `campaura_${aura.label}`,
        type: 'campAura',
        position: { x: aura.bbox.minX - CAMP_AURA_BLUR * 2, y: aura.bbox.minY - CAMP_AURA_BLUR * 2 },
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
  }, [nodes, positions, focusedId, ctxColorById, dossierRotations, influenceClusters, subClusters, campAuras, focusedClusterId, clusterAnnotations, egoVisibleSet, highlightSet, isDimmed, clusterColors, pinnedSet]);

  // Obstacles pour le contournement des liens renseignement : tous les
  // nœuds positionnés avec leur rayon de collision (les extrémités du lien
  // sont exclues au calcul, par lien).
  const detourObstacles = useMemo(() => {
    const out: Array<{ id: string; x: number; y: number; r: number }> = [];
    for (const n of nodes) {
      const p = positions.get(n.id);
      if (!p) continue;
      out.push({ id: n.id, x: p.x, y: p.y, r: getCollisionRadius(n) });
    }
    return out;
  }, [nodes, positions]);

  const rfEdges: Edge[] = useMemo(() => {
    return edges.map(e => {
      const highlighted = focusedId && (e.source === focusedId || e.target === focusedId);
      const isRens = e.kind === 'renseignement';
      // Lien renseignement qui traverserait des nœuds tiers (typique : un
      // lien entre deux réseaux crimorg passant au travers d'un dossier
      // ECOFI posé entre les deux) → courbe de contournement dédiée.
      let detour: { cx: number; cy: number } | null = null;
      if (isRens) {
        const a = positions.get(e.source);
        const b = positions.get(e.target);
        if (a && b) {
          detour = computeRensDetour(
            a, b,
            detourObstacles.filter(o => o.id !== e.source && o.id !== e.target),
          );
        }
      }
      const isSuspectEdge = e.kind === 'suspect';
      const isCondamneEdge = e.kind === 'condamne';
      // Bezier doux dès qu'un des deux endpoints est connecté à plus d'un autre
      // nœud — sinon trait droit (cas dyade isolée, plus net).
      // Les liens "renseignement", "suspect" et "condamné" utilisent toujours une courbe.
      const dMax = Math.max(nodeDegree.get(e.source) || 0, nodeDegree.get(e.target) || 0);
      const useCurve = isRens || isSuspectEdge || isCondamneEdge || dMax > 1;
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: detour ? 'rensDetour' : (useCurve ? 'simplebezier' : 'straight'),
        data: detour
          ? { cx: detour.cx, cy: detour.cy, label: e.label, highlighted: !!highlighted }
          : undefined,
        label: isRens && !detour ? e.label : undefined,
        labelStyle: isRens && !detour ? { fill: '#1d4ed8', fontSize: 11, fontWeight: 600 } : undefined,
        labelBgStyle: isRens && !detour ? { fill: '#eff6ff' } : undefined,
        labelBgPadding: isRens && !detour ? ([4, 2] as [number, number]) : undefined,
        labelBgBorderRadius: isRens && !detour ? 3 : undefined,
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
            : isCondamneEdge
              ? {
                  stroke: highlighted ? '#047857' : '#10b981',
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
  }, [edges, focusedId, nodeDegree, positions, detourObstacles]);

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

  // Clic dans le vide → on remonte l'info au parent (qui relâche la
  // sélection). Piège : le navigateur émet un `click` même après un
  // glisser-déposer, donc un simple déplacement de la carte annulerait la
  // sélection. React Flow filtre déjà ce cas (`paneClickDistance`), mais on
  // double la garde ici — elle couvre aussi le tactile : on mémorise le point
  // de départ du geste et on n'appelle le parent que si le pointeur n'a
  // pratiquement pas bougé.
  const paneDownRef = useRef<{ x: number; y: number } | null>(null);
  const handlePanePointerDown = useCallback((e: React.PointerEvent) => {
    paneDownRef.current = { x: e.clientX, y: e.clientY };
  }, []);
  const handlePaneClick = useCallback(
    (e: React.MouseEvent) => {
      const down = paneDownRef.current;
      paneDownRef.current = null;
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > PANE_CLICK_MAX_DRAG) return;
      onPaneClick?.();
    },
    [onPaneClick],
  );

  return (
    // touch-action:none permet à ReactFlow de gérer le pinch-zoom nativement
    // sur mobile sans conflit avec le scroll système.
    <div
      style={{ width: '100%', height: '100%', touchAction: 'none' }}
      onPointerDownCapture={handlePanePointerDown}
    >
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      // minZoom très bas (0.01) : quand la carte devient « commune à tous »
      // (tous contentieux confondus, ajouts de toute l'équipe), le nuage de
      // nœuds peut s'étendre bien au-delà de ±3000 px. On laisse donc
      // l'utilisateur dézoomer beaucoup plus loin pour reprendre une vue
      // d'ensemble, même sur une carte très dense. fitView reste libre de
      // choisir un zoom d'entrée confortable (~0.2–0.3) dans la plage élargie.
      minZoom={0.01}
      maxZoom={2.5}
      onNodeClick={handleClick}
      onNodeDoubleClick={handleDoubleClick}
      onPaneClick={handlePaneClick}
      // Tolérance de React Flow (1 px par défaut) : un clic sur le fond reste
      // un clic même si la main tremble un peu. Au-delà, c'est un pan.
      paneClickDistance={PANE_CLICK_MAX_DRAG}
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
