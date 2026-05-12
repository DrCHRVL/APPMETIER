// components/mindmap/useForceLayout.ts
//
// Layout "carte stellaire" : on calcule les positions x/y des nœuds en
// 2 étages.
//
//   Étage 1 (macro) : détection des galaxies (composantes connexes via MECs
//                     partagés) + placement de leurs centres par mini-simu
//                     d3-force au niveau galactique (cf. ./galaxies.ts).
//                     Les galaxies se *repoussent* sans chevauchement et
//                     s'attirent uniquement via leurs MECs partagés (ce qui
//                     n'arrive pas dans notre définition — un MEC partagé
//                     est forcément intra-galactique). Pas de cardinal :
//                     les puits viennent de la disposition macro.
//
//   Étage 2 (micro) : chaque nœud est ancré à sa galaxie via forceX/Y
//                     (anchor doux) puis on laisse d3-force trouver
//                     l'équilibre local entre link, charge, collide.
//                     Les MECs partagés (comètes) se positionnent
//                     spontanément au barycentre pondéré de leurs
//                     dossiers (= chaque lien tire pareil → côté avec
//                     plus de liens = plus proche).
//
//   Post-pass       : hull-SAT au niveau galactique pour effacer les
//                     chevauchements résiduels qui auraient pu apparaître
//                     pendant la simu intra-cluster.
//
// Le layout est ensuite *figé* (positions persistées en cache). Les drags
// utilisateur sont gérés par react-flow indépendamment ; les ajouts
// ultérieurs déclenchent un mode "remous" qui ne libère que la galaxie
// concernée pour préserver le reste de la carte.

import { useMemo } from 'react';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import type { GraphEdge, GraphNode } from '@/utils/mindmapGraph';
import { applyOrbitalLayout, detectGalaxies, hullSatRelax, layoutGalaxyCenters } from './galaxies';

export interface PositionedNode {
  id: string;
  x: number;
  y: number;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  radius: number;
}

// Itérations en démarrage à froid (aucun nœud connu en cache).
const ITERATIONS_COLD = 300;
// Itérations en démarrage à chaud (positions précédentes restaurées).
const ITERATIONS_WARM = 90;
// Alpha initial en warm start.
const WARM_ALPHA = 0.35;
// Seuil au-delà duquel le graphe est "essentiellement connu" (warm start).
const WARM_KNOWN_RATIO = 0.6;
const CENTER_X = 0;
const CENTER_Y = 0;
const LINK_DISTANCE = 180;
const CHARGE_STRENGTH = -550;
// Distance max d'effet de la charge : au-delà, deux nœuds ne se repoussent
// plus. Évite que la répulsion globale lutte contre la séparation
// inter-galactique déjà gérée à l'étage macro.
const CHARGE_DISTANCE_MAX = 600;
// Attraction d'un nœud vers le centre de sa galaxie. Joue le rôle qu'avait
// la gravité de zone, sauf que la cible est calculée par layoutGalaxyCenters
// (placement macro), pas par un cardinal arbitraire.
const GALAXY_GRAVITY_STRENGTH = 0.18;
// Rappel central très doux pour les nœuds dans une galaxie naine (sans
// MEC partagé ni voisin). Sans ce filet, ils pourraient dériver.
const ORPHAN_RECALL_STRENGTH = 0.01;

// Cache localStorage : positions de nœuds + signature de galaxie. v6 marque
// (v5) le retrait des liens renseignement de la détection des galaxies +
// la prise en compte des tailles réelles des planètes, puis (v6) l'ajout
// d'un halo de répulsion proportionnel à la masse des galaxies.
const POSITIONS_STORAGE_KEY = 'mindmap.layout.positions.v6';
// Cache séparé pour les centres de galaxies (clé = anchorId). v3 = halo
// de masse → les centres bougent, on invalide.
const GALAXY_CENTERS_STORAGE_KEY = 'mindmap.layout.galaxies.v3';
// Cache des angles orbitaux par MEC (clé = id MEC). v2 : prise en compte
// des directions préférées (liens renseignement) → invalidation pour que
// les planètes liées se réorientent vers leur partenaire.
const ORBITAL_ANGLES_STORAGE_KEY = 'mindmap.layout.orbits.v2';
// Borne dure des coordonnées finales (filet de sécurité NaN/explosion).
const POSITION_CLAMP = 15_000;
// Seuil de bascule remous / warm full.
const REMOUS_CHANGE_RATIO = 0.10;
const ITERATIONS_REMOUS = 30;
const REMOUS_ALPHA = 0.30;

function radiusOf(node: GraphNode): number {
  if (node.type === 'mec') return 28 + Math.round(node.score * 42);
  const cap = Math.min(node.nbMec, 8);
  return 24 + Math.round((cap / 8) * 32);
}

const DOSSIER_BOX_PADDING = 8;
const COLLIDE_PADDING = 20;

export function getDossierBox(node: GraphNode): { width: number; height: number } {
  const r = radiusOf(node);
  if (node.type === 'mec') {
    const d = r * 2;
    return { width: d, height: d };
  }
  const fontSize = Math.max(11, Math.min(14, r / 3));
  const charCount = (node.numero || '').length;
  const textWidth = charCount * fontSize * 0.62;
  const width = Math.max(120, Math.min(360, Math.ceil(textWidth + 2 * DOSSIER_BOX_PADDING + 16)));
  const height = Math.max(48, Math.round(r * 1.6));
  return { width, height };
}

export function getCollisionRadius(node: GraphNode): number {
  if (node.type === 'mec') return radiusOf(node);
  const { width, height } = getDossierBox(node);
  return Math.sqrt(width * width + height * height) / 2;
}

// ──────────────────────────────────────────────
// CACHE DE POSITIONS (persistance entre rendus + sessions)
// ──────────────────────────────────────────────
interface CachedPosition {
  x: number;
  y: number;
  /** Signature de la galaxie au moment du calcul (anchorId de la galaxie).
   *  Permet de détecter qu'un nœud a changé de galaxie depuis le dernier
   *  run → libération en mode remous. */
  galaxySig?: string;
}
const positionCache = new Map<string, CachedPosition>();
const galaxyCenterCache = new Map<string, { x: number; y: number }>();
const orbitalAngleCache = new Map<string, number>();
let positionCacheHydrated = false;
let galaxyCenterCacheHydrated = false;
let orbitalAngleCacheHydrated = false;
let lastSeenRefreshKey: number | null = null;

function hydratePositionCache(): void {
  if (positionCacheHydrated) return;
  positionCacheHydrated = true;
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(POSITIONS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, CachedPosition>;
    if (!parsed || typeof parsed !== 'object') return;
    for (const [id, pos] of Object.entries(parsed)) {
      if (!pos) continue;
      if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) continue;
      if (Math.abs(pos.x) > POSITION_CLAMP || Math.abs(pos.y) > POSITION_CLAMP) continue;
      const entry: CachedPosition = { x: pos.x, y: pos.y };
      if (typeof pos.galaxySig === 'string') entry.galaxySig = pos.galaxySig;
      positionCache.set(id, entry);
    }
  } catch {
    // Quota plein / JSON corrompu : on repart sans cache.
  }
}

function persistPositionCache(): void {
  if (typeof window === 'undefined') return;
  try {
    const obj: Record<string, CachedPosition> = {};
    for (const [id, pos] of positionCache) obj[id] = pos;
    window.localStorage.setItem(POSITIONS_STORAGE_KEY, JSON.stringify(obj));
  } catch { /* ignore */ }
}

function hydrateGalaxyCenterCache(): void {
  if (galaxyCenterCacheHydrated) return;
  galaxyCenterCacheHydrated = true;
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(GALAXY_CENTERS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, { x: number; y: number }>;
    if (!parsed || typeof parsed !== 'object') return;
    for (const [id, c] of Object.entries(parsed)) {
      if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
      if (Math.abs(c.x) > POSITION_CLAMP || Math.abs(c.y) > POSITION_CLAMP) continue;
      galaxyCenterCache.set(id, { x: c.x, y: c.y });
    }
  } catch { /* ignore */ }
}

function persistGalaxyCenterCache(): void {
  if (typeof window === 'undefined') return;
  try {
    const obj: Record<string, { x: number; y: number }> = {};
    for (const [id, c] of galaxyCenterCache) obj[id] = c;
    window.localStorage.setItem(GALAXY_CENTERS_STORAGE_KEY, JSON.stringify(obj));
  } catch { /* ignore */ }
}

function hydrateOrbitalAngleCache(): void {
  if (orbitalAngleCacheHydrated) return;
  orbitalAngleCacheHydrated = true;
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(ORBITAL_ANGLES_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, number>;
    if (!parsed || typeof parsed !== 'object') return;
    for (const [id, a] of Object.entries(parsed)) {
      if (typeof a !== 'number' || !Number.isFinite(a)) continue;
      orbitalAngleCache.set(id, a);
    }
  } catch { /* ignore */ }
}

function persistOrbitalAngleCache(): void {
  if (typeof window === 'undefined') return;
  try {
    const obj: Record<string, number> = {};
    for (const [id, a] of orbitalAngleCache) obj[id] = a;
    window.localStorage.setItem(ORBITAL_ANGLES_STORAGE_KEY, JSON.stringify(obj));
  } catch { /* ignore */ }
}

/**
 * Position de démarrage pour un nœud nouvellement apparu. On vise le
 * voisin connu le plus proche pour éviter une traversée du graphe.
 */
function seedNewNode(
  id: string,
  adj: Map<string, string[]>,
): { x: number; y: number } | undefined {
  const neighbors = adj.get(id);
  if (!neighbors || neighbors.length === 0) return undefined;
  let sumX = 0, sumY = 0, count = 0;
  for (const nb of neighbors) {
    const cached = positionCache.get(nb);
    if (cached) { sumX += cached.x; sumY += cached.y; count++; }
  }
  if (count === 0) return undefined;
  // Petit jitter déterministe pour ne pas atterrir sur le voisin.
  const h = (() => {
    let v = 0x811c9dc5;
    for (let i = 0; i < id.length; i++) {
      v ^= id.charCodeAt(i);
      v = (v + ((v << 1) + (v << 4) + (v << 7) + (v << 8) + (v << 24))) >>> 0;
    }
    return v >>> 0;
  })();
  const theta = ((h & 0xffff) / 0xffff) * Math.PI * 2;
  return { x: sumX / count + Math.cos(theta) * 40, y: sumY / count + Math.sin(theta) * 40 };
}

/**
 * Retourne une Map id → {x, y} stable tant que la liste des nœuds/arêtes ne change pas.
 *
 * `refreshKey` : incrémenter pour forcer un warm full ; appeler aussi
 *                `clearLayoutCache()` avant pour un véritable "recompacter".
 */
export function useForceLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  refreshKey: number = 0,
): Map<string, PositionedNode> {
  return useMemo(() => {
    if (nodes.length === 0) return new Map();

    hydratePositionCache();
    hydrateGalaxyCenterCache();
    hydrateOrbitalAngleCache();

    // ─────────────────────────────────────────────────────────────
    // 1. Adjacence + détection des galaxies
    // ─────────────────────────────────────────────────────────────
    const adj = new Map<string, string[]>();
    for (const n of nodes) adj.set(n.id, []);
    for (const e of edges) {
      if (!adj.has(e.source) || !adj.has(e.target)) continue;
      adj.get(e.source)!.push(e.target);
      adj.get(e.target)!.push(e.source);
    }

    const { galaxies, galaxyIdxByNodeId } = detectGalaxies(nodes, edges);
    const galaxyByIdx = new Map(galaxies.map(g => [g.index, g]));
    const galaxySigByNodeId = new Map<string, string>();
    for (const n of nodes) {
      const idx = galaxyIdxByNodeId.get(n.id);
      const g = idx !== undefined ? galaxyByIdx.get(idx) : undefined;
      galaxySigByNodeId.set(n.id, g?.anchorId ?? '');
    }

    // ─────────────────────────────────────────────────────────────
    // 2. Détection des changements depuis le dernier run
    // ─────────────────────────────────────────────────────────────
    const newNodes = new Set<string>();
    const galaxyChangedNodes = new Set<string>();
    let knownCount = 0;
    for (const n of nodes) {
      const cached = positionCache.get(n.id);
      if (!cached) { newNodes.add(n.id); continue; }
      knownCount++;
      const cachedSig = cached.galaxySig ?? '';
      const currentSig = galaxySigByNodeId.get(n.id) ?? '';
      if (cachedSig !== currentSig) galaxyChangedNodes.add(n.id);
    }
    const changedNodes = new Set<string>([...newNodes, ...galaxyChangedNodes]);
    const knownRatio = knownCount / nodes.length;
    const changedRatio = changedNodes.size / nodes.length;

    // ─────────────────────────────────────────────────────────────
    // 3. Choix du mode de simulation
    // ─────────────────────────────────────────────────────────────
    const isExplicitStir =
      lastSeenRefreshKey !== null && lastSeenRefreshKey !== refreshKey;
    lastSeenRefreshKey = refreshKey;

    type Mode = 'cold' | 'warmFull' | 'remous' | 'cached';
    let mode: Mode;
    if (knownRatio < WARM_KNOWN_RATIO) mode = 'cold';
    else if (isExplicitStir) mode = 'warmFull';
    else if (changedNodes.size === 0) mode = 'cached';
    else if (changedRatio > REMOUS_CHANGE_RATIO) mode = 'warmFull';
    else mode = 'remous';

    if (mode === 'cached') {
      const positions = new Map<string, PositionedNode>();
      for (const n of nodes) {
        const c = positionCache.get(n.id);
        if (!c) continue;
        positions.set(n.id, { id: n.id, x: c.x, y: c.y });
      }
      return positions;
    }

    // ─────────────────────────────────────────────────────────────
    // 4. Placement des centres de galaxies (étage macro)
    // ─────────────────────────────────────────────────────────────
    // En remous on garde les centres en cache pour ne pas faire bouger
    // les galaxies non concernées. En cold/warmFull on les recalcule mais
    // le seed depuis le cache préserve la disposition globale.
    const galaxyCenters = layoutGalaxyCenters(galaxies, galaxyCenterCache);

    // ─────────────────────────────────────────────────────────────
    // 5. Set libéré (mode remous uniquement)
    // ─────────────────────────────────────────────────────────────
    const releasedNodes = new Set<string>();
    if (mode === 'remous') {
      const releasedGalaxies = new Set<number>();
      for (const id of changedNodes) {
        const idx = galaxyIdxByNodeId.get(id);
        if (idx !== undefined) releasedGalaxies.add(idx);
      }
      for (const n of nodes) {
        const idx = galaxyIdxByNodeId.get(n.id);
        if (idx !== undefined && releasedGalaxies.has(idx)) releasedNodes.add(n.id);
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 6. SimNodes (pinning des nœuds non libérés en remous)
    // ─────────────────────────────────────────────────────────────
    type SimNodePinnable = SimNode & {
      x?: number; y?: number;
      fx?: number | null; fy?: number | null;
    };
    const simNodes: SimNode[] = nodes.map(n => {
      const cached = positionCache.get(n.id);
      const seed = cached || seedNewNode(n.id, adj);
      const sn: SimNodePinnable = { id: n.id, radius: getCollisionRadius(n) };
      if (seed) { sn.x = seed.x; sn.y = seed.y; }
      else {
        // Aucun seed disponible : on démarre près du centre de galaxie pour
        // accélérer la convergence et éviter d'atterrir à (0,0) au milieu
        // d'une autre galaxie.
        const idx = galaxyIdxByNodeId.get(n.id);
        const c = idx !== undefined ? galaxyCenters.get(idx) : undefined;
        if (c) { sn.x = c.x; sn.y = c.y; }
      }
      if (mode === 'remous' && cached && !releasedNodes.has(n.id)) {
        sn.fx = cached.x;
        sn.fy = cached.y;
      }
      return sn;
    });

    const simLinks: SimulationLinkDatum<SimNode>[] = edges.map(e => ({
      source: e.source,
      target: e.target,
    }));

    // ─────────────────────────────────────────────────────────────
    // 7. Cible de gravité pour chaque nœud = centre de sa galaxie
    // ─────────────────────────────────────────────────────────────
    const targetByNodeId = new Map<string, { x: number; y: number }>();
    for (const n of nodes) {
      const idx = galaxyIdxByNodeId.get(n.id);
      if (idx === undefined) continue;
      const c = galaxyCenters.get(idx);
      if (!c) continue;
      targetByNodeId.set(n.id, { x: c.x, y: c.y });
    }

    // ─────────────────────────────────────────────────────────────
    // 8. Simulation intra-galactique
    // ─────────────────────────────────────────────────────────────
    let iterations: number;
    let initialAlpha: number;
    if (mode === 'cold') { iterations = ITERATIONS_COLD; initialAlpha = 1; }
    else if (mode === 'warmFull') { iterations = ITERATIONS_WARM; initialAlpha = WARM_ALPHA; }
    else { iterations = ITERATIONS_REMOUS; initialAlpha = REMOUS_ALPHA; }

    const sim = forceSimulation(simNodes)
      .alpha(initialAlpha)
      .force(
        'link',
        forceLink<SimNode, SimulationLinkDatum<SimNode>>(simLinks)
          .id(d => d.id)
          .distance(LINK_DISTANCE)
          .strength(0.6),
      )
      .force(
        'charge',
        forceManyBody<SimNode>()
          .strength(CHARGE_STRENGTH)
          .distanceMax(CHARGE_DISTANCE_MAX),
      )
      .force('center', forceCenter(CENTER_X, CENTER_Y).strength(0.02))
      .force(
        'collide',
        forceCollide<SimNode>().radius(d => d.radius + COLLIDE_PADDING).strength(1),
      )
      .force(
        'galaxyX',
        forceX<SimNode>(d => targetByNodeId.get(d.id)?.x ?? 0)
          .strength(d => (targetByNodeId.has(d.id) ? GALAXY_GRAVITY_STRENGTH : ORPHAN_RECALL_STRENGTH)),
      )
      .force(
        'galaxyY',
        forceY<SimNode>(d => targetByNodeId.get(d.id)?.y ?? 0)
          .strength(d => (targetByNodeId.has(d.id) ? GALAXY_GRAVITY_STRENGTH : ORPHAN_RECALL_STRENGTH)),
      );

    sim.stop();
    for (let i = 0; i < iterations; i++) sim.tick();

    // ─────────────────────────────────────────────────────────────
    // 9. Layout orbital : on extrait d3-force du jeu pour les planètes
    //    et on les pose proprement sur un (ou deux) anneau(x) autour
    //    de leur étoile, en masquant le secteur tourné vers le voisin
    //    le plus proche pour éviter les bras qui dépassent.
    // ─────────────────────────────────────────────────────────────
    const positionsForOrbits = new Map<string, { x: number; y: number }>();
    for (const sn of simNodes as Array<SimNode & { x?: number; y?: number }>) {
      positionsForOrbits.set(sn.id, { x: sn.x ?? 0, y: sn.y ?? 0 });
    }
    // En remous on ne touche pas aux planètes des galaxies figées : on
    // restreint l'orbital pass aux galaxies libérées.
    const orbitalGalaxies = mode === 'remous'
      ? galaxies.filter(g => Array.from(g.memberIds).some(id => releasedNodes.has(id)))
      : galaxies;
    // Cibles renseignement par MEC : permet d'orienter la planète sur son
    // anneau vers son partenaire renseignement (lien plus court, ne
    // traverse plus le système).
    const renseignementTargetsByMecId = new Map<string, string[]>();
    for (const e of edges) {
      if (e.kind !== 'renseignement') continue;
      const sn = nodes.find(n => n.id === e.source);
      const tn = nodes.find(n => n.id === e.target);
      if (sn?.type === 'mec' && sn.dossierIds.length === 1) {
        if (!renseignementTargetsByMecId.has(sn.id)) renseignementTargetsByMecId.set(sn.id, []);
        renseignementTargetsByMecId.get(sn.id)!.push(e.target);
      }
      if (tn?.type === 'mec' && tn.dossierIds.length === 1) {
        if (!renseignementTargetsByMecId.has(tn.id)) renseignementTargetsByMecId.set(tn.id, []);
        renseignementTargetsByMecId.get(tn.id)!.push(e.source);
      }
    }
    const newAngles = applyOrbitalLayout(
      orbitalGalaxies,
      nodes,
      positionsForOrbits,
      orbitalAngleCache,
      {
        collisionRadiusOf: getCollisionRadius,
        renseignementTargetsByMecId,
      },
    );
    for (const [mecId, ang] of newAngles) orbitalAngleCache.set(mecId, ang);

    // ─────────────────────────────────────────────────────────────
    // 10. Hull-SAT post-pass : éjecte les galaxies qui se chevauchent
    //     encore après l'expansion orbitale.
    // ─────────────────────────────────────────────────────────────
    const deltas = hullSatRelax(galaxies, positionsForOrbits);

    // ─────────────────────────────────────────────────────────────
    // 11. Export + mise à jour des caches
    // ─────────────────────────────────────────────────────────────
    const positions = new Map<string, PositionedNode>();
    for (const sn of simNodes as Array<SimNode & { x?: number; y?: number }>) {
      const idx = galaxyIdxByNodeId.get(sn.id);
      const delta = idx !== undefined ? deltas.get(idx) : undefined;
      // Si l'orbital layout a réécrit la position de cette planète,
      // on l'utilise comme base ; sinon on prend la position de la simu.
      const orbital = positionsForOrbits.get(sn.id);
      let x = orbital?.x ?? (Number.isFinite(sn.x) ? (sn.x as number) : 0);
      let y = orbital?.y ?? (Number.isFinite(sn.y) ? (sn.y as number) : 0);
      if (delta) { x += delta.dx; y += delta.dy; }
      if (x > POSITION_CLAMP) x = POSITION_CLAMP;
      else if (x < -POSITION_CLAMP) x = -POSITION_CLAMP;
      if (y > POSITION_CLAMP) y = POSITION_CLAMP;
      else if (y < -POSITION_CLAMP) y = -POSITION_CLAMP;
      positions.set(sn.id, { id: sn.id, x, y });
      const galaxySig = galaxySigByNodeId.get(sn.id) ?? '';
      positionCache.set(sn.id, { x, y, galaxySig });
    }

    // Mise à jour du cache des centres de galaxies (après hull-SAT).
    for (const g of galaxies) {
      const c = galaxyCenters.get(g.index);
      if (!c) continue;
      const delta = deltas.get(g.index);
      const cx = c.x + (delta?.dx ?? 0);
      const cy = c.y + (delta?.dy ?? 0);
      galaxyCenterCache.set(g.anchorId, { x: cx, y: cy });
    }

    persistPositionCache();
    persistGalaxyCenterCache();
    persistOrbitalAngleCache();
    return positions;
  }, [nodes, edges, refreshKey]);
}

export function getNodeRadius(node: GraphNode): number {
  return radiusOf(node);
}

/**
 * Vide le cache de positions + galaxies (mémoire + localStorage). Au
 * prochain layout, un démarrage à froid (alpha=1, 300 ticks) repositionne
 * tout depuis zéro. Utile pour le bouton "Recompacter la carte".
 */
export function clearLayoutCache(): void {
  positionCache.clear();
  galaxyCenterCache.clear();
  orbitalAngleCache.clear();
  if (typeof window !== 'undefined') {
    try { window.localStorage.removeItem(POSITIONS_STORAGE_KEY); } catch { /* ignore */ }
    try { window.localStorage.removeItem(GALAXY_CENTERS_STORAGE_KEY); } catch { /* ignore */ }
    try { window.localStorage.removeItem(ORBITAL_ANGLES_STORAGE_KEY); } catch { /* ignore */ }
  }
}
