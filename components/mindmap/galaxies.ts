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

import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
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
 *  (≈ un système complet de respiration). Au-dessous, hull-SAT garantit le
 *  décollage en tenant compte de l'extension visuelle réelle des nœuds. */
const INTER_GALAXY_PADDING = 140;
/** Marge réduite entre deux galaxies reliées par un lien renseignement :
 *  on veut qu'elles soient *proches* (lecture du lien immédiate) sans pour
 *  autant fusionner ni se superposer. Hull-SAT garantit le non-recouvrement. */
const INTER_GALAXY_PADDING_RENS = 60;
/** Bonus de répulsion proportionnel à la "masse" de la galaxie : plus une
 *  galaxie est grosse (rayon estimé au-delà du système nominal), plus elle
 *  pousse ses voisines loin. Effet : un gros amas ne se laisse pas coller
 *  par un petit dossier indépendant — il y a un halo de respiration. */
const GALAXY_MASS_PADDING_RATIO = 0.35;
/** Pas du relâchement hull-SAT (px) : on translate au max de cette
 *  amplitude par itération pour éviter les sur-corrections. */
const HULL_SAT_STEP = 0.5;
/** Nombre maximal d'itérations hull-SAT. Convergence typique en <20. */
const HULL_SAT_MAX_ITER = 60;
/** Itérations / alpha pour la simulation inter-galactique. */
const GALAXY_SIM_ITERATIONS = 200;

/** Halo de répulsion supplémentaire d'une galaxie au-delà de son rayon
 *  estimé. Croit linéairement avec la "taille au-dessus du système
 *  nominal", capé pour rester raisonnable sur les très gros graphes. */
function massHalo(r: number): number {
  return Math.min(220, Math.max(0, r - SYSTEM_RADIUS) * GALAXY_MASS_PADDING_RATIO);
}

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

  // 1. Adjacence pour la détection des galaxies. SEULES les arêtes "data"
  //    (MEC ↔ dossier via mec.dossierIds) définissent l'appartenance à une
  //    galaxie. Les liens "renseignement" sont volontairement IGNORÉS ici :
  //    un simple lien de renseignement entre deux réseaux ne doit pas les
  //    fusionner en une seule galaxie (même couleur, même hull). Ils restent
  //    rendus visuellement (force d'attraction au layer micro) mais les deux
  //    réseaux gardent leur identité distincte.
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
    if (e.kind === 'renseignement') continue;
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
  rensGalaxyPairs?: Array<{ aIdx: number; bIdx: number }>,
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
      // Rayon de collision = rayon estimé + padding fixe + halo de masse.
      // Le halo donne aux grosses galaxies un "espace personnel" plus grand
      // que les petites : un dossier indépendant ne vient plus se coller
      // au bord d'un gros amas, il reste à distance respectueuse.
      forceCollide<GalaxySimNode>()
        .radius(d => d.r + INTER_GALAXY_PADDING + massHalo(d.r))
        .strength(1)
        .iterations(2),
    );

  // Attraction inter-galactique sur les liens renseignement : on tisse un
  // forceLink macro entre les *centres* de galaxies reliées par ≥1 lien
  // renseignement. Distance cible = juste de quoi se toucher hull-à-hull
  // (collision les empêchera de fusionner), strength bien inférieure à
  // celle des liens data intra-galactique (0.6) pour rester un effet de
  // "gravité douce" et non un lien dur.
  //
  //   Important : on NE FUSIONNE PAS les galaxies (detectGalaxies les a
  //   gardées distinctes), on NE COLORE PAS différemment (les hulls
  //   d'influence ignorent aussi les liens rens), on rapproche juste les
  //   *centres*. Le résultat visuel : deux réseaux qui se "frôlent" sans
  //   se mélanger, et le trait renseignement court devient court et
  //   lisible au lieu de traverser toute la carte.
  if (rensGalaxyPairs && rensGalaxyPairs.length > 0) {
    const simNodeByIdx = new Map<number, GalaxySimNode>();
    for (const sn of simNodes) simNodeByIdx.set(sn.index, sn);
    // Dédupliquer les paires (plusieurs liens rens entre deux galaxies ne
    // doivent pas multiplier la force d'attraction).
    const seen = new Set<string>();
    const macroLinks: SimulationLinkDatum<GalaxySimNode>[] = [];
    for (const p of rensGalaxyPairs) {
      if (p.aIdx === p.bIdx) continue;
      const a = simNodeByIdx.get(p.aIdx);
      const b = simNodeByIdx.get(p.bIdx);
      if (!a || !b) continue;
      const key = p.aIdx < p.bIdx ? `${p.aIdx}|${p.bIdx}` : `${p.bIdx}|${p.aIdx}`;
      if (seen.has(key)) continue;
      seen.add(key);
      macroLinks.push({ source: a, target: b });
    }
    if (macroLinks.length > 0) {
      sim.force(
        'rensLink',
        forceLink<GalaxySimNode, SimulationLinkDatum<GalaxySimNode>>(macroLinks)
          .distance(l => {
            const a = l.source as GalaxySimNode;
            const b = l.target as GalaxySimNode;
            // Distance cible = somme des rayons + un padding réduit. La
            // collision (rayon + INTER_GALAXY_PADDING) empêche d'aller plus
            // près : les galaxies se posent au minimum admissible.
            return a.r + b.r + INTER_GALAXY_PADDING_RENS + (massHalo(a.r) + massHalo(b.r)) / 2;
          })
          .strength(0.18),
      );
    }
  }

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
  nodeRadiusById?: Map<string, number>,
  rensGalaxyPairs?: Array<{ aIdx: number; bIdx: number }>,
): Map<number, { dx: number; dy: number }> {
  const deltas = new Map<number, { dx: number; dy: number }>();
  if (galaxies.length < 2) return deltas;

  // Index des paires de galaxies reliées par un lien renseignement : pour
  // celles-ci, hull-SAT autorise une proximité plus serrée (padding réduit)
  // — on veut qu'elles se touchent presque sans pour autant se chevaucher.
  const rensPairSet = new Set<string>();
  if (rensGalaxyPairs) {
    for (const p of rensGalaxyPairs) {
      if (p.aIdx === p.bIdx) continue;
      const k = p.aIdx < p.bIdx ? `${p.aIdx}|${p.bIdx}` : `${p.bIdx}|${p.aIdx}`;
      rensPairSet.add(k);
    }
  }
  const isRensPair = (a: number, b: number) => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    return rensPairSet.has(k);
  };

  // Cercles englobants effectifs (post-layout). Le rayon estimé peut
  // sur-estimer la réalité (galaxie compacte) → on prend le vrai max.
  // IMPORTANT : on inclut la *taille visuelle* de chaque nœud (collisionRadius)
  // au bout de la distance au centroïde, sinon un gros dossier sur le bord
  // de la galaxie déborde du disque englobant et finit par chevaucher la
  // galaxie voisine — c'est la cause principale des galaxies "qui se
  // superposent alors qu'elles n'ont aucun lien".
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
      const visualR = nodeRadiusById?.get(id) ?? 0;
      const d = Math.hypot(p.x - cx, p.y - cy) + visualR;
      if (d > r) r = d;
    }
    // Disque effectif = enveloppe (incluant la taille des nœuds) + plein
    // padding + halo de masse. Hull-SAT applique désormais le MÊME budget
    // d'espace que la simulation macro — pas de marche d'escalier où le
    // post-pass relâche un contact que la simu avait soigneusement écarté.
    return { idx: g.index, x: cx, y: cy, r: r + INTER_GALAXY_PADDING / 2 + massHalo(r) / 2 };
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
        // Paires reliées par un lien renseignement : on autorise un
        // rapprochement plus serré (réduit le padding mais garde la
        // somme des rayons → toujours pas de chevauchement, juste un
        // espace inter-galactique plus court).
        const rensShrink = isRensPair(a.idx, b.idx)
          ? (INTER_GALAXY_PADDING - INTER_GALAXY_PADDING_RENS)
          : 0;
        const minDist = a.r + b.r - rensShrink;
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

// ──────────────────────────────────────────────────────────────────────
// LAYOUT ORBITAL INTRA-SYSTÈME
// ──────────────────────────────────────────────────────────────────────

/** Largeur angulaire (rad) masquée autour de la direction d'un voisin
 *  proche. ±27° → on évite que les planètes pointent vers le voisin. */
const NEIGHBOR_MASK_HALF_WIDTH = (27 * Math.PI) / 180;
/** Au-delà de ce ratio (distance voisin / rayon orbite), le voisin n'est
 *  plus considéré comme "proche" et ne masque plus de secteur. */
const NEIGHBOR_MASK_RANGE_RATIO = 4;
/** Espacement angulaire minimal entre deux planètes adjacentes (rad).
 *  Avec ≈6° on a au max 60 planètes par anneau ; au-delà on bascule sur
 *  un 2ème anneau. */
const MIN_PLANET_ARC_GAP = (6 * Math.PI) / 180;
/** Diamètre nominal de secours (collision radius * 2 + padding) si aucune
 *  fonction de mesure n'est fournie. Calibré sur un MEC de score moyen.
 *  En pratique le caller fournit collisionRadiusOf et on utilise la
 *  taille réelle, qui peut atteindre ~180 px pour un gros MEC. */
const FALLBACK_PLANET_DIAMETER = 140;
/** Padding additionnel entre planètes sur l'anneau (px). */
const PLANET_RING_PADDING = 18;
/** Rayon maximal cible d'un anneau avant qu'on ne crée un anneau
 *  supplémentaire. Au-delà, les planètes "dérivent" visuellement loin de
 *  leur étoile — on préfère empiler plusieurs anneaux concentriques. */
const MAX_RING_RADIUS = 420;
/** Demi-largeur (rad) du secteur préféré autour de la direction d'un lien
 *  renseignement. Quand une planète a un lien rens, on essaye de la placer
 *  dans cette plage ±15° vers le partenaire pour raccourcir le trait et
 *  éviter qu'il traverse la galaxie. */
const RENSEIGNEMENT_PREFERRED_HALF_WIDTH = (15 * Math.PI) / 180;

/**
 * Place chaque planète (MEC exclusif d'un dossier) sur un anneau autour
 * de son étoile. Les positions des étoiles et des comètes ne sont pas
 * touchées — seules les planètes sont repositionnées.
 *
 * Pour chaque étoile :
 *   1. On identifie les directions de ses voisines proches (autres
 *      dossiers de la même galaxie à portée).
 *   2. On masque un secteur angulaire autour de chacune (les bras de
 *      planètes ne se déploient pas vers le voisin).
 *   3. On distribue les planètes uniformément dans les secteurs libres.
 *      Si trop nombreuses pour un seul anneau, on en crée un 2ème.
 *   4. Si une planète a un angle en cache compatible avec un secteur
 *      libre, on le préserve (stabilité inter-rendus).
 */
export interface OrbitalLayoutOptions {
  /** Rayon de collision réel par nœud (≈ taille visuelle + padding). Si
   *  fourni, l'anneau est dimensionné à partir de la planète la plus grosse
   *  du système au lieu d'un diamètre nominal — évite les chevauchements
   *  visibles entre deux gros MEC voisins sur le même anneau. */
  collisionRadiusOf?: (node: GraphNode) => number;
  /** Pour chaque MEC, ids des autres nœuds auxquels il est lié par un
   *  lien renseignement (toutes galaxies confondues). Si fourni, on
   *  privilégie un angle orbital tourné VERS le partenaire pour que le
   *  trait soit court et ne traverse pas le reste du système. */
  renseignementTargetsByMecId?: Map<string, string[]>;
}

export function applyOrbitalLayout(
  galaxies: Galaxy[],
  nodes: GraphNode[],
  positions: Map<string, { x: number; y: number }>,
  cachedAngleByMecId?: Map<string, number>,
  options: OrbitalLayoutOptions = {},
): Map<string, number> {
  // Nouvelle map angle par MEC (sortie + nouveau cache).
  const newAngles = new Map<string, number>();

  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const dossierToPlanets = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.type !== 'mec') continue;
    if (n.dossierIds.length !== 1) continue;
    const did = n.dossierIds[0];
    if (!dossierToPlanets.has(did)) dossierToPlanets.set(did, []);
    dossierToPlanets.get(did)!.push(n.id);
  }

  const planetDiameter = (id: string): number => {
    const n = nodeById.get(id);
    if (!n || !options.collisionRadiusOf) return FALLBACK_PLANET_DIAMETER;
    return options.collisionRadiusOf(n) * 2 + PLANET_RING_PADDING;
  };

  for (const galaxy of galaxies) {
    const galaxyDossiers = Array.from(galaxy.dossierIds);

    for (const starId of galaxyDossiers) {
      const planets = dossierToPlanets.get(starId);
      if (!planets || planets.length === 0) continue;
      const starPos = positions.get(starId);
      if (!starPos) continue;

      // Diamètre effectif d'une planète sur l'anneau (max sur le système :
      // le plus gros MEC dicte la maille). Padding inclus pour ne pas que
      // deux planètes voisines se touchent visuellement.
      let maxPlanetDiameter = 0;
      for (const pid of planets) {
        const d = planetDiameter(pid);
        if (d > maxPlanetDiameter) maxPlanetDiameter = d;
      }
      if (maxPlanetDiameter === 0) maxPlanetDiameter = FALLBACK_PLANET_DIAMETER;

      // Taille visuelle réelle de l'étoile (dossier) : la box d'un dossier
      // peut atteindre ~360 px de large (collisionRadius ≈ 180). Avec
      // l'ancien minRingRadius=140 fixe, les planètes étaient placées
      // *à l'intérieur* du rectangle du dossier — leur nom passait sous
      // le numéro du dossier ("noms de dossier par dessus les noms de
      // mis en cause"). On dimensionne désormais le rayon minimal au
      // contact étoile↔planète, plus une marge de respiration.
      const starNode = nodeById.get(starId);
      const starRadius = starNode && options.collisionRadiusOf
        ? options.collisionRadiusOf(starNode)
        : 80;

      // Direction préférée par planète (vers son partenaire renseignement
      // le plus proche, le cas échéant). On l'utilisera comme biais lors
      // du choix d'angle.
      const preferredAngleByPlanet = new Map<string, number>();
      const rensTargets = options.renseignementTargetsByMecId;
      if (rensTargets) {
        for (const pid of planets) {
          const targets = rensTargets.get(pid);
          if (!targets || targets.length === 0) continue;
          // Barycentre des positions des partenaires connus → un seul
          // angle préféré (et si plusieurs partenaires, c'est le compromis
          // qui minimise les liens longs).
          let sx = 0, sy = 0, count = 0;
          for (const tid of targets) {
            const tp = positions.get(tid);
            if (!tp) continue;
            sx += tp.x; sy += tp.y; count++;
          }
          if (count === 0) continue;
          const cx = sx / count, cy = sy / count;
          const dx = cx - starPos.x;
          const dy = cy - starPos.y;
          if (dx === 0 && dy === 0) continue;
          preferredAngleByPlanet.set(pid, normalizeAngle(Math.atan2(dy, dx)));
        }
      }

      const computeMasks = (r: number): Array<[number, number]> => {
        const masks: Array<[number, number]> = [];
        // Voisins = autres étoiles (dossiers) de la galaxie.
        for (const otherId of galaxyDossiers) {
          if (otherId === starId) continue;
          const op = positions.get(otherId);
          if (!op) continue;
          const dx = op.x - starPos.x;
          const dy = op.y - starPos.y;
          const dist = Math.hypot(dx, dy);
          if (dist > r * NEIGHBOR_MASK_RANGE_RATIO) continue;
          const theta = Math.atan2(dy, dx);
          // Largeur de masque qui s'étend quand le voisin est proche :
          // ±MASK_HALF_WIDTH ajusté par (1 - dist/range) pour rapprocher
          // les planètes du côté libre quand le voisin est très près.
          const proximity = Math.max(0, 1 - dist / (r * NEIGHBOR_MASK_RANGE_RATIO));
          const halfWidth = NEIGHBOR_MASK_HALF_WIDTH * (1 + proximity);
          masks.push([theta - halfWidth, theta + halfWidth]);
        }
        // Comètes (MEC partagés) de la galaxie : elles vivent au barycentre
        // de leurs dossiers, donc parfois sur l'anneau cible d'une planète.
        // Sans masquage on a vu deux MEC s'empiler visuellement ("noms de
        // mis en cause qui se superposent"). On masque un petit secteur
        // angulaire centré sur la comète quand elle se trouve dans la zone
        // de l'anneau.
        for (const cometId of galaxy.cometMecIds) {
          const cp = positions.get(cometId);
          if (!cp) continue;
          const dx = cp.x - starPos.x;
          const dy = cp.y - starPos.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 1 || dist > r * NEIGHBOR_MASK_RANGE_RATIO) continue;
          const theta = Math.atan2(dy, dx);
          // Masque proportionnel à la taille visuelle (estimée) de la
          // comète : on bloque un cône qui équivaut à un diamètre de
          // planète sur l'anneau le plus représentatif. Toujours capé
          // pour ne pas dévorer un demi-cercle.
          const halfWidth = Math.min(
            NEIGHBOR_MASK_HALF_WIDTH,
            Math.atan2(maxPlanetDiameter / 2, dist),
          );
          masks.push([theta - halfWidth, theta + halfWidth]);
        }
        return masks;
      };

      // Masque calculé une seule fois sur un rayon d'estimation (les
      // voisins ne bougent pas pendant cette passe). On prend le rayon
      // minimal sensé pour ne pas perdre des voisins par "trop loin".
      const maskedSectors = computeMasks(MAX_RING_RADIUS);
      const unmaskedFraction = Math.max(0.08, computeUnmaskedFraction(maskedSectors));

      // ─── Construction multi-anneaux ────────────────────────────────
      // Au lieu de gonfler un seul anneau jusqu'à ce que toutes les
      // planètes tiennent (formule N×d/2π → ∞ quand N grandit ou que
      // les voisins masquent), on EMPILE des anneaux concentriques.
      // Chaque anneau est cappé à MAX_RING_RADIUS (sauf en dernier
      // recours, si le compte de planètes excède la capacité d'une
      // poignée d'anneaux) — une planète ne dérive donc plus à 1000 px
      // de son étoile, elle reste dans un disque ≤ ~500 px.
      const ringGap = maxPlanetDiameter * 1.1;
      // Rayon minimal = étoile (rayon de collision réel) + demi-diamètre
      // d'une planète + marge. Garantit qu'aucune planète n'empiète sur
      // la boîte du dossier, même quand la boîte est très large.
      const minRingRadius = Math.max(
        140,
        starRadius + maxPlanetDiameter / 2 + 20,
        maxPlanetDiameter,
      );
      const ringCapacity = (r: number): number => Math.max(
        1,
        Math.floor((2 * Math.PI * r * unmaskedFraction) / maxPlanetDiameter),
      );

      const ringRadii: number[] = [];
      const ringCapacities: number[] = [];
      let remaining = planets.length;
      let nextRadius = minRingRadius;
      // Plafond logiciel : 8 anneaux suffisent pour des systèmes
      // pathologiques (≈ 200+ planètes). Au-delà, on dépasse MAX
      // plutôt que d'empiler à l'infini.
      while (remaining > 0 && ringRadii.length < 8) {
        const r = Math.min(nextRadius, MAX_RING_RADIUS);
        const cap = ringCapacity(r);
        ringRadii.push(r);
        ringCapacities.push(Math.min(cap, remaining));
        remaining -= cap;
        nextRadius += ringGap;
        // Une fois MAX atteint, les anneaux suivants doivent pousser
        // plus loin pour ne pas se confondre — sinon deux anneaux à
        // MAX_RING_RADIUS se superposeraient.
        if (r >= MAX_RING_RADIUS) nextRadius = MAX_RING_RADIUS + ringRadii.length * ringGap;
      }
      // Si remaining > 0, on a vraiment trop de planètes : on étend
      // un dernier anneau en débordement plutôt que de jeter des nœuds.
      if (remaining > 0) {
        ringCapacities[ringCapacities.length - 1] += remaining;
      }

      // Distribution des planètes : on remplit anneau par anneau dans
      // l'ordre fourni (les angles préférés/cachés seront triés ensuite
      // dans la boucle de placement).
      const ringAssignments: Array<{ radius: number; planets: string[] }> = [];
      let cursor = 0;
      for (let i = 0; i < ringRadii.length; i++) {
        const slice = planets.slice(cursor, cursor + ringCapacities[i]);
        if (slice.length === 0) continue;
        ringAssignments.push({ radius: ringRadii[i], planets: slice });
        cursor += slice.length;
      }

      for (const ring of ringAssignments) {
        // Préserve les angles en cache compatibles avec les secteurs libres.
        const preserved: Array<{ id: string; angle: number }> = [];
        const remaining: string[] = [];
        for (const pid of ring.planets) {
          const cached = cachedAngleByMecId?.get(pid);
          // Si la planète a un partenaire renseignement, on ne préserve
          // le cache que s'il est déjà proche de la direction préférée :
          // sinon on rebascule pour la rapprocher du partenaire.
          const preferred = preferredAngleByPlanet.get(pid);
          const cachedIsAcceptable = cached !== undefined
            && !isAngleMasked(cached, maskedSectors)
            && (preferred === undefined
                || angleDistance(cached, preferred) <= RENSEIGNEMENT_PREFERRED_HALF_WIDTH * 2);
          if (cachedIsAcceptable) {
            preserved.push({ id: pid, angle: normalizeAngle(cached!) });
          } else {
            remaining.push(pid);
          }
        }
        // Tri des préservées par angle pour pouvoir intercaler les nouvelles
        // dans les écarts entre angles existants.
        preserved.sort((a, b) => a.angle - b.angle);

        // Ordre de placement des "remaining" : d'abord celles qui ont une
        // direction préférée (lien renseignement), pour qu'elles obtiennent
        // un secteur libre orienté vers leur partenaire avant que les
        // autres ne le prennent.
        remaining.sort((a, b) => {
          const ap = preferredAngleByPlanet.has(a) ? 0 : 1;
          const bp = preferredAngleByPlanet.has(b) ? 0 : 1;
          return ap - bp;
        });

        const placed = preserved.slice();
        for (const pid of remaining) {
          const preferred = preferredAngleByPlanet.get(pid);
          const ang = pickNextAngle(placed.map(p => p.angle), maskedSectors, preferred);
          placed.push({ id: pid, angle: ang });
          placed.sort((a, b) => a.angle - b.angle);
        }

        for (const { id, angle } of placed) {
          positions.set(id, {
            x: starPos.x + Math.cos(angle) * ring.radius,
            y: starPos.y + Math.sin(angle) * ring.radius,
          });
          newAngles.set(id, angle);
        }
      }
    }
  }
  return newAngles;
}

/** Distance angulaire absolue entre deux angles (rad), wrap-around. */
function angleDistance(a: number, b: number): number {
  const na = normalizeAngle(a);
  const nb = normalizeAngle(b);
  const d = Math.abs(na - nb);
  return Math.min(d, 2 * Math.PI - d);
}

/** Normalise un angle dans [0, 2π[. */
function normalizeAngle(a: number): number {
  const TWO_PI = 2 * Math.PI;
  let x = a % TWO_PI;
  if (x < 0) x += TWO_PI;
  return x;
}

/** Vrai si l'angle (rad) tombe dans l'un des secteurs masqués. */
function isAngleMasked(angle: number, masks: Array<[number, number]>): boolean {
  const a = normalizeAngle(angle);
  const TWO_PI = 2 * Math.PI;
  for (const [lo, hi] of masks) {
    // Le secteur peut chevaucher 2π → on teste sur la version normalisée.
    const nlo = normalizeAngle(lo);
    const nhi = normalizeAngle(hi);
    if (nlo <= nhi) {
      if (a >= nlo && a <= nhi) return true;
    } else {
      // Secteur qui enjambe l'origine (ex. 350° → 10°)
      if (a >= nlo || a <= nhi) return true;
    }
    // Cas non-normalisé original : intervalle simple si large
    if (hi - lo < TWO_PI && angle >= lo && angle <= hi) return true;
  }
  return false;
}

/** Calcule la fraction du cercle [0, 2π] non couverte par les secteurs. */
function computeUnmaskedFraction(masks: Array<[number, number]>): number {
  if (masks.length === 0) return 1;
  // On échantillonne le cercle pour une mesure robuste face aux
  // chevauchements de secteurs (résolution 1° → 360 points).
  const samples = 360;
  let free = 0;
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * 2 * Math.PI;
    if (!isAngleMasked(a, masks)) free++;
  }
  return free / samples;
}

/** Choisit le prochain angle pour une planète. Combine deux objectifs :
 *   - maximiser la distance au voisin le plus proche (étalement)
 *   - rester proche d'une direction préférée si fournie (lien
 *     renseignement vers un partenaire externe au système). Quand la
 *     préférence est exprimée, on cherche d'abord un angle libre dans la
 *     fenêtre ±RENSEIGNEMENT_PREFERRED_HALF_WIDTH ; à défaut on tombe
 *     sur le pur étalement.
 *  Toujours en évitant les secteurs masqués (direction d'un voisin
 *  proche). */
function pickNextAngle(
  existing: number[],
  masks: Array<[number, number]>,
  preferredAngle?: number,
): number {
  const samples = 360;
  // 1. Si une direction préférée est donnée : on cherche dans la fenêtre
  //    préférée l'angle qui maximise l'écart aux voisins. Si la fenêtre
  //    est entièrement masquée ou collée à un voisin (<MIN_PLANET_ARC_GAP),
  //    on retombe sur le pur étalement.
  if (preferredAngle !== undefined) {
    let bestPref = -1;
    let bestPrefAngle = preferredAngle;
    for (let i = 0; i < samples; i++) {
      const a = (i / samples) * 2 * Math.PI;
      if (isAngleMasked(a, masks)) continue;
      if (angleDistance(a, preferredAngle) > RENSEIGNEMENT_PREFERRED_HALF_WIDTH) continue;
      let minDist = Math.PI;
      for (const e of existing) {
        const d = angleDistance(a, e);
        if (d < minDist) minDist = d;
      }
      if (minDist < MIN_PLANET_ARC_GAP) continue;
      if (minDist > bestPref) { bestPref = minDist; bestPrefAngle = a; }
    }
    if (bestPref > 0) return bestPrefAngle;
  }

  // 2. Étalement classique : angle qui maximise la distance au plus proche.
  let bestAngle = 0;
  let bestScore = -1;
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * 2 * Math.PI;
    if (isAngleMasked(a, masks)) continue;
    let minDist = Math.PI;
    for (const e of existing) {
      const d = angleDistance(a, e);
      if (d < minDist) minDist = d;
    }
    if (existing.length === 0) return a;
    if (minDist > bestScore) {
      bestScore = minDist;
      bestAngle = a;
    }
  }
  return bestAngle;
}

