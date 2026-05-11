// components/mindmap/galaxies.ts
//
// Modèle "carte stellaire" pour la cartographie.
//
//   Planète  = MEC exclusif (lié à 1 seul dossier).
//   Système  = 1 dossier + ses planètes.
//   Galaxie  = ensemble de systèmes reliés entre eux par ≥1 MEC partagé
//              (composante connexe du sous-graphe dossier↔dossier).
//   Comète   = MEC partagé entre plusieurs dossiers. Sa position est le
//              barycentre pondéré de ses dossiers (= chaque dossier compte
//              pour 1, donc la comète penche du côté où elle a le plus de
//              liens).
//
// Toute la géométrie de placement *au-dessus* des nœuds individuels vit ici.
// Le layout intra-système (nœuds dans une galaxie) reste géré par d3-force
// dans useForceLayout.ts, qui consomme les ancres galactiques calculées ici.

import { forceCollide, forceManyBody, forceSimulation, type SimulationNodeDatum } from 'd3-force';
import type { GraphEdge, GraphNode, MecNode } from '@/utils/mindmapGraph';

export interface Galaxy {
  /** Index numérique stable au sein d'un calcul. */
  index: number;
  /** Identifiant stable inter-rendus : min lexicographique des ids dossier
   *  membres (ou des MEC si galaxie sans dossier — cas dégénéré). Permet
   *  de re-corréler une galaxie d'un rendu à l'autre malgré l'ajout/retrait
   *  de membres. */
  anchorId: string;
  /** Ids dossier appartenant à la galaxie. */
  dossierIds: Set<string>;
  /** Ids MEC exclusifs (planètes) de la galaxie. */
  exclusiveMecIds: Set<string>;
  /** Ids MEC partagés (comètes) dont *tous* les dossiers sont dans cette
   *  galaxie. Par définition de la galaxie (composante connexe via partage),
   *  un MEC partagé n'enjambe jamais 2 galaxies différentes — il est
   *  toujours intra-galactique. */
  cometMecIds: Set<string>;
  /** Tous les nœuds membres (dossiers + MECs exclusifs + comètes). */
  memberIds: Set<string>;
  /** Rayon estimé du disque englobant, calculé en fonction du nombre de
   *  membres. Utilisé pour le placement inter-galactique. */
  estimatedRadius: number;
}

export interface GalaxyPlacement {
  /** Centre de la galaxie dans l'espace monde. */
  x: number;
  y: number;
  /** Rayon estimé (cohérent avec galaxy.estimatedRadius). */
  r: number;
}

// ──────────────────────────────────────────────────────────────────────
// PARAMÈTRES (calibrés pour des graphes typiques de 5 à 500 nœuds)
// ──────────────────────────────────────────────────────────────────────

/** Rayon nominal d'orbite d'une planète autour de son étoile (px). */
export const PLANET_ORBIT_RADIUS = 110;
/** Rayon nominal d'un système (étoile + 1 anneau de planètes). */
const SYSTEM_RADIUS = 160;
/** Marge ajoutée entre deux galaxies pour le placement inter-galactique
 *  (≈ moitié d'un système). Au-dessous, hull-SAT garantit le décollage. */
const INTER_GALAXY_PADDING = 80;
/** Pas du relâchement hull-SAT (px) : on translate au max de cette
 *  amplitude par itération pour éviter les sur-corrections. */
const HULL_SAT_STEP = 0.5;
/** Nombre maximal d'itérations hull-SAT. Convergence typique en <20. */
const HULL_SAT_MAX_ITER = 60;
/** Itérations / alpha pour la simulation inter-galactique. */
const GALAXY_SIM_ITERATIONS = 200;

// ──────────────────────────────────────────────────────────────────────
// DÉTECTION DES GALAXIES
// ──────────────────────────────────────────────────────────────────────

/**
 * Construit la liste des galaxies à partir des nœuds + arêtes.
 *
 * Étapes :
 *   1. Index dossier-dossier : arête si ≥1 MEC commun (ou lien
 *      renseignement direct entre 2 dossiers).
 *   2. BFS sur ce graphe → composantes connexes = galaxies.
 *   3. Affectation des MEC : un MEC dont tous les dossiers sont dans la
 *      même galaxie y est rattaché ; sa qualification (exclusive/comète)
 *      dépend du nombre de dossiers (1 = exclusive, ≥2 = comète).
 *
 * Les nœuds totalement isolés (MEC sans dossier, dossier sans MEC) forment
 * chacun leur propre galaxie naine.
 */
export function detectGalaxies(nodes: GraphNode[], edges: GraphEdge[]): {
  galaxies: Galaxy[];
  galaxyIdxByNodeId: Map<string, number>;
} {
  const dossiers = new Map<string, GraphNode>();
  const mecs = new Map<string, MecNode>();
  for (const n of nodes) {
    if (n.type === 'dossier') dossiers.set(n.id, n);
    else mecs.set(n.id, n);
  }

  // 1. Adjacence du graphe complet (dossiers + MECs).
  //    On unifie les arêtes "data" (MEC ↔ dossier via mec.dossierIds) et
  //    "renseignement" (peuvent connecter n'importe quels nœuds, y compris
  //    MEC↔MEC ou MEC↔dossier hors dossierIds). BFS sur ce graphe donne
  //    directement les composantes connexes = galaxies.
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n.id, new Set());
  for (const mec of mecs.values()) {
    for (const did of mec.dossierIds) {
      if (!dossiers.has(did)) continue;
      adj.get(mec.id)!.add(did);
      adj.get(did)!.add(mec.id);
    }
  }
  for (const e of edges) {
    if (!adj.has(e.source) || !adj.has(e.target)) continue;
    adj.get(e.source)!.add(e.target);
    adj.get(e.target)!.add(e.source);
  }

  // 2. Composantes connexes → galaxies. On distingue ensuite les rôles
  //    de chaque membre (dossier=étoile, MEC=planète/comète).
  const galaxyIdxByNodeId = new Map<string, number>();
  const galaxies: Galaxy[] = [];
  for (const n of nodes) {
    if (galaxyIdxByNodeId.has(n.id)) continue;
    const idx = galaxies.length;
    const members: string[] = [];
    const queue: string[] = [n.id];
    galaxyIdxByNodeId.set(n.id, idx);
    while (queue.length) {
      const cur = queue.shift()!;
      members.push(cur);
      for (const nb of adj.get(cur) || []) {
        if (galaxyIdxByNodeId.has(nb)) continue;
        galaxyIdxByNodeId.set(nb, idx);
        queue.push(nb);
      }
    }
    const galaxyDossiers = new Set<string>();
    const exclusiveMecs = new Set<string>();
    const cometMecs = new Set<string>();
    for (const id of members) {
      if (dossiers.has(id)) galaxyDossiers.add(id);
      else {
        const mec = mecs.get(id);
        if (!mec) continue;
        const linkedCount = mec.dossierIds.filter(d => dossiers.has(d)).length;
        if (linkedCount <= 1) exclusiveMecs.add(id);
        else cometMecs.add(id);
      }
    }
    // Ancre stable inter-rendus : priorité à un dossier (les MECs peuvent
    // être recalculés ou renommés ; les dossiers ont des ids structurels).
    // Fallback sur le min lexicographique des membres pour les galaxies
    // sans dossier (MEC ex nihilo isolé).
    const sortedDossiers = Array.from(galaxyDossiers).sort();
    const anchorId = sortedDossiers[0] ?? members.slice().sort()[0];
    galaxies.push({
      index: idx,
      anchorId,
      dossierIds: galaxyDossiers,
      exclusiveMecIds: exclusiveMecs,
      cometMecIds: cometMecs,
      memberIds: new Set(members),
      estimatedRadius: 0,
    });
  }

  // 4. Rayon estimé : √(N) × constante, plancher pour les galaxies naines.
  for (const g of galaxies) {
    const n = g.memberIds.size;
    g.estimatedRadius = Math.max(SYSTEM_RADIUS, Math.sqrt(n) * 90);
  }

  return { galaxies, galaxyIdxByNodeId };
}

// ──────────────────────────────────────────────────────────────────────
// PLACEMENT DES CENTRES DE GALAXIES (puits gravitationnels)
// ──────────────────────────────────────────────────────────────────────

interface GalaxySimNode extends SimulationNodeDatum {
  index: number;
  r: number;
  // d3-force injecte x/y au runtime (SimulationNodeDatum les déclare
  // optionnels), on les redéclare ici pour que TS ne perde pas l'info
  // quand les types d3-force ne sont pas résolus.
  x?: number;
  y?: number;
  /** Position préférée (depuis cache), utilisée comme seed pour la stabilité. */
  seedX?: number;
  seedY?: number;
}

/**
 * Calcule un centre pour chaque galaxie en faisant tourner une mini-simu
 * d3-force au niveau galactique :
 *   - chaque galaxie = 1 corps de rayon `estimatedRadius`
 *   - répulsion (charge) modérée : juste de quoi écarter
 *   - collision dure entre disques galactiques (pas de chevauchement)
 *   - répulsion symétrique → la gravité centrale n'est pas nécessaire,
 *     forceCenter introduit un biais inward parasite. À la place, on
 *     part de positions seedées (cache ou jitter déterministe) et on
 *     laisse la collision faire le travail.
 *
 * Si `cachedCenters` est fourni, on initialise les positions depuis le
 * cache pour préserver la disposition entre rendus.
 */
export function layoutGalaxyCenters(
  galaxies: Galaxy[],
  cachedCenters?: Map<string, { x: number; y: number }>,
): Map<number, GalaxyPlacement> {
  const result = new Map<number, GalaxyPlacement>();
  if (galaxies.length === 0) return result;
  if (galaxies.length === 1) {
    result.set(galaxies[0].index, { x: 0, y: 0, r: galaxies[0].estimatedRadius });
    return result;
  }

  // Seed : cache si dispo, sinon jitter déterministe sur une spirale.
  // La spirale donne une distribution initiale propre qui réduit fortement
  // le nombre de ticks nécessaires à la collision pour décoller les corps.
  const simNodes: GalaxySimNode[] = galaxies.map((g, i) => {
    const cached = cachedCenters?.get(g.anchorId);
    if (cached && Number.isFinite(cached.x) && Number.isFinite(cached.y)) {
      return { index: g.index, r: g.estimatedRadius, x: cached.x, y: cached.y, seedX: cached.x, seedY: cached.y };
    }
    // Spirale d'Archimède : θ et r croissent ensemble → aucun chevauchement
    // initial même quand toutes les galaxies sont nouvelles.
    const theta = i * 2.4;
    const r = 200 + i * 60;
    return { index: g.index, r: g.estimatedRadius, x: r * Math.cos(theta), y: r * Math.sin(theta) };
  });

  const sim = forceSimulation(simNodes)
    .alpha(1)
    // Charge faible : la collision tient déjà le terrain, la charge n'aide
    // qu'à fluidifier la convergence quand 2 galaxies veulent la même place.
    .force('charge', forceManyBody<GalaxySimNode>().strength(d => -150 * d.r / 100))
    .force(
      'collide',
      forceCollide<GalaxySimNode>()
        .radius(d => d.r + INTER_GALAXY_PADDING)
        .strength(1)
        .iterations(2),
    );

  sim.stop();
  for (let i = 0; i < GALAXY_SIM_ITERATIONS; i++) sim.tick();

  for (const sn of simNodes) {
    result.set(sn.index, {
      x: Number.isFinite(sn.x) ? sn.x! : 0,
      y: Number.isFinite(sn.y) ? sn.y! : 0,
      r: sn.r,
    });
  }
  return result;
}

// ──────────────────────────────────────────────────────────────────────
// HULL-SAT POST-PASS
// ──────────────────────────────────────────────────────────────────────

/**
 * Relaxation finale : on regarde les positions effectives des galaxies
 * APRÈS le layout intra-système, et on pousse rigidement les galaxies
 * qui se chevauchent encore. Opère sur les disques englobants (cercle
 * couvrant tous les membres) — pas sur les polygones hull, c'est
 * suffisant pour le visuel et 100× moins coûteux.
 *
 * Retourne un Map<galaxyIdx, delta {dx, dy}> à appliquer à TOUS les
 * nœuds membres de chaque galaxie (translation rigide → l'orbite
 * relative de chaque planète autour de son étoile reste intacte).
 */
export function hullSatRelax(
  galaxies: Galaxy[],
  positionsByNodeId: Map<string, { x: number; y: number }>,
): Map<number, { dx: number; dy: number }> {
  const deltas = new Map<number, { dx: number; dy: number }>();
  if (galaxies.length < 2) return deltas;

  // Cercles englobants effectifs (post-layout). Le rayon estimé peut
  // sur-estimer la réalité (galaxie compacte) → on prend le vrai max.
  const discs = galaxies.map(g => {
    let cx = 0, cy = 0, count = 0;
    for (const id of g.memberIds) {
      const p = positionsByNodeId.get(id);
      if (!p) continue;
      cx += p.x; cy += p.y; count++;
    }
    if (count > 0) { cx /= count; cy /= count; }
    let r = 0;
    for (const id of g.memberIds) {
      const p = positionsByNodeId.get(id);
      if (!p) continue;
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d > r) r = d;
    }
    return { idx: g.index, x: cx, y: cy, r: r + INTER_GALAXY_PADDING / 2 };
  });

  // Translations cumulées par galaxie.
  const dx = new Map<number, number>();
  const dy = new Map<number, number>();
  for (const d of discs) { dx.set(d.idx, 0); dy.set(d.idx, 0); }

  for (let iter = 0; iter < HULL_SAT_MAX_ITER; iter++) {
    let moved = false;
    for (let i = 0; i < discs.length; i++) {
      for (let j = i + 1; j < discs.length; j++) {
        const a = discs[i], b = discs[j];
        const ax = a.x + (dx.get(a.idx) || 0);
        const ay = a.y + (dy.get(a.idx) || 0);
        const bx = b.x + (dx.get(b.idx) || 0);
        const by = b.y + (dy.get(b.idx) || 0);
        let vx = bx - ax;
        let vy = by - ay;
        let d2 = vx * vx + vy * vy;
        if (d2 < 0.0001) {
          // Centres confondus : on injecte une direction déterministe (fonction
          // de l'index) pour décoller proprement sans aléatoire.
          vx = Math.cos(a.idx + b.idx);
          vy = Math.sin(a.idx + b.idx);
          d2 = vx * vx + vy * vy;
        }
        const d = Math.sqrt(d2);
        const minDist = a.r + b.r;
        const penetration = minDist - d;
        if (penetration <= 0) continue;
        // On translate chacun de moitié dans la direction opposée. Pondération
        // par taille : la grosse galaxie bouge moins que la petite (inertie).
        const totalSize = (a.r * a.r) + (b.r * b.r);
        const shareA = (b.r * b.r) / totalSize;
        const shareB = (a.r * a.r) / totalSize;
        const step = Math.min(penetration, penetration * HULL_SAT_STEP);
        const ux = vx / d;
        const uy = vy / d;
        dx.set(a.idx, (dx.get(a.idx) || 0) - ux * step * shareA);
        dy.set(a.idx, (dy.get(a.idx) || 0) - uy * step * shareA);
        dx.set(b.idx, (dx.get(b.idx) || 0) + ux * step * shareB);
        dy.set(b.idx, (dy.get(b.idx) || 0) + uy * step * shareB);
        moved = true;
      }
    }
    if (!moved) break;
  }

  for (const g of galaxies) {
    const ddx = dx.get(g.index) || 0;
    const ddy = dy.get(g.index) || 0;
    if (ddx !== 0 || ddy !== 0) deltas.set(g.index, { dx: ddx, dy: ddy });
  }
  return deltas;
}
