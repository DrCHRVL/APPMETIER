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
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import type { GraphEdge, GraphNode } from '@/utils/mindmapGraph';
import { meanZoneCenter, type ZoneId } from './zones';

export interface PositionedNode {
  id: string;
  x: number;
  y: number;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  radius: number;
}

// Itérations en démarrage à froid (aucun nœud connu en cache) : il faut
// laisser à la simulation le temps de trouver un équilibre depuis zéro.
const ITERATIONS_COLD = 300;
// Itérations en démarrage à chaud (positions précédentes restaurées) : on
// raffine seulement, donc beaucoup moins de ticks suffisent et la carte
// reste quasi-immobile pour l'utilisateur.
const ITERATIONS_WARM = 90;
// Alpha initial en warm start (vs alpha=1 par défaut en cold). Plus bas =
// la simulation perd vite son énergie, les nœuds existants ne dérivent que
// de quelques pixels au lieu de se réorganiser globalement.
const WARM_ALPHA = 0.35;
// Seuil au-delà duquel on considère le graphe comme "essentiellement connu"
// (donc warm start). En dessous, on retombe en cold start.
const WARM_KNOWN_RATIO = 0.6;
const CENTER_X = 0;
const CENTER_Y = 0;
const LINK_DISTANCE = 180;
const CHARGE_STRENGTH = -550;
// Répulsion entre composantes connexes : force custom qui pousse les
// centroïdes de clusters disjoints les uns loin des autres. Sans elle,
// `forceCenter` les attire tous vers (0,0) et leurs aires d'influence
// peuvent se chevaucher visuellement même sans aucun lien entre les nœuds.
// Ajustée empiriquement : assez forte pour séparer 2 clusters de 5 nœuds,
// pas trop pour éviter les explosions sur des graphes de 100+ nœuds.
const COMPONENT_REPULSION_STRENGTH = 30_000;
// Marge (px) ajoutée au rayon englobant d'une composante étrangère : tout
// nœud d'une autre composante qui pénètre cette zone est repoussé vers
// l'extérieur. Empêche un petit cluster de venir s'étaler visuellement
// dans la silhouette d'un voisin sans lien — sans ça, l'œil lit une
// fausse proximité (cf. BOULEFRAD posé dans l'aire CAPELLE).
const COMPONENT_AREA_MARGIN = 80;
// Force d'attraction d'un nœud vers le centre de sa zone géographique
// assignée. Plus forte qu'avant car les zones sont désormais très
// éloignées (R=2200) — sans pull suffisant, les composantes resteraient
// agglutinées au centre malgré l'assignation.
const ZONE_GRAVITY_STRENGTH = 0.08;
// Rayon de dispersion (jitter déterministe) autour du centre de zone : sans
// ça, toutes les composantes assignées à la même zone étaient tirées au
// même point exact et finissaient empilées les unes sur les autres. On
// répartit les nœuds dans un disque autour du centre, en utilisant un hash
// stable de l'id pour que la position reste identique entre deux rendus.
const ZONE_JITTER_RADIUS = 600;
// Clé localStorage pour persister les positions calculées entre deux sessions.
// Le cache mémoire vit en plus du localStorage pour répondre instantanément
// aux re-render dans la même session sans toucher l'IO.
const POSITIONS_STORAGE_KEY = 'mindmap.layout.positions.v1';
// Borne dure des coordonnées finales. Les zones cardinales s'étalent à
// ±2200 + jitter 600, soit ~±2800 max. Une cluster sain s'étend rarement
// au-delà de ±5000. Au-delà de ±15000 on est en présence d'une explosion
// de la simulation (componentRepulsion peut dégénérer si deux centroïdes
// se confondent et que la force diverge avant d'amortir). Sans ce clamp,
// fitView de react-flow s'écraserait à minZoom=0.1 et tous les nœuds
// deviendraient invisibles (canvas en apparence vide).
const POSITION_CLAMP = 15_000;

/**
 * Hash 32-bit stable (FNV-1a) — déterministe, pas de dépendance crypto.
 * Utilisé pour générer un offset reproductible par composante/zone afin
 * que deux rendus successifs du même graphe placent les clusters au même
 * endroit.
 */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

function stableJitter(seed: string, radius: number): { x: number; y: number } {
  const h = fnv1a(seed);
  // Deux coordonnées indépendantes en [0, 1) via deux moitiés du hash.
  const u = (h & 0xffff) / 0x10000;
  const v = ((h >>> 16) & 0xffff) / 0x10000;
  // Distribution uniforme dans le disque (sqrt sinon biais vers le centre).
  const r = Math.sqrt(u) * radius;
  const theta = v * 2 * Math.PI;
  return { x: r * Math.cos(theta), y: r * Math.sin(theta) };
}

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
 * Calcule l'index de composante connexe pour chaque nœud (Union-Find suffirait,
 * BFS suffit ici). Utilisé par la force `componentRepulsion` pour identifier
 * quels nœuds appartiennent au même "îlot gravitationnel".
 */
function buildComponentIndex(
  nodes: GraphNode[],
  edges: GraphEdge[],
): Map<string, number> {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    if (!adj.has(e.source) || !adj.has(e.target)) continue;
    adj.get(e.source)!.push(e.target);
    adj.get(e.target)!.push(e.source);
  }
  const componentByNode = new Map<string, number>();
  let nextComponent = 0;
  for (const n of nodes) {
    if (componentByNode.has(n.id)) continue;
    const comp = nextComponent++;
    const queue: string[] = [n.id];
    componentByNode.set(n.id, comp);
    while (queue.length) {
      const cur = queue.shift()!;
      for (const nb of adj.get(cur) || []) {
        if (componentByNode.has(nb)) continue;
        componentByNode.set(nb, comp);
        queue.push(nb);
      }
    }
  }
  return componentByNode;
}

/**
 * Force d3 custom : répulsion entre composantes connexes.
 *
 * À chaque tick :
 *   1. Calcule le centroïde de chaque composante.
 *   2. Pour chaque paire de centroïdes, calcule un vecteur d'éloignement
 *      proportionnel à √(taille_A × taille_B) / distance² (Coulomb-like).
 *   3. Applique le vecteur résultant à tous les nœuds de chaque composante,
 *      modulé par alpha (refroidit avec la simulation).
 *
 * C'est cette force qui garantit que deux clusters sans lien n'auront pas
 * leurs aires d'influence qui se chevauchent visuellement, même quand
 * `forceCenter` les attire tous vers (0,0).
 */
function componentRepulsion(componentByNode: Map<string, number>) {
  let nodes: SimNode[] = [];
  type SimNodeWithPos = SimNode & { x?: number; y?: number; vx?: number; vy?: number };

  function force(alpha: number) {
    if (nodes.length === 0) return;

    // 1. Centroïdes
    const sumX = new Map<number, number>();
    const sumY = new Map<number, number>();
    const counts = new Map<number, number>();
    for (const n of nodes as SimNodeWithPos[]) {
      const c = componentByNode.get(n.id);
      if (c === undefined) continue;
      sumX.set(c, (sumX.get(c) || 0) + (n.x || 0));
      sumY.set(c, (sumY.get(c) || 0) + (n.y || 0));
      counts.set(c, (counts.get(c) || 0) + 1);
    }
    if (counts.size < 2) return; // une seule composante : rien à repousser

    const cx = new Map<number, number>();
    const cy = new Map<number, number>();
    for (const [c, n] of counts) {
      cx.set(c, (sumX.get(c) || 0) / n);
      cy.set(c, (sumY.get(c) || 0) / n);
    }

    // 2. Force par composante (somme des répulsions vis-à-vis des autres).
    const fx = new Map<number, number>();
    const fy = new Map<number, number>();
    const components = Array.from(counts.keys());
    for (let i = 0; i < components.length; i++) {
      for (let j = i + 1; j < components.length; j++) {
        const ci = components[i];
        const cj = components[j];
        let dx = (cx.get(ci) || 0) - (cx.get(cj) || 0);
        let dy = (cy.get(ci) || 0) - (cy.get(cj) || 0);
        let d2 = dx * dx + dy * dy;
        // Si les centroïdes sont presque confondus (cluster fraîchement
        // initialisé à 0,0), on injecte une petite perturbation pour
        // débloquer la simulation au lieu de diviser par 0.
        if (d2 < 1) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d2 = dx * dx + dy * dy + 0.01;
        }
        const d = Math.sqrt(d2);
        const sizeFactor = Math.sqrt((counts.get(ci) || 1) * (counts.get(cj) || 1));
        const magnitude = COMPONENT_REPULSION_STRENGTH * sizeFactor * alpha / d2;
        const ufx = (dx / d) * magnitude;
        const ufy = (dy / d) * magnitude;
        fx.set(ci, (fx.get(ci) || 0) + ufx);
        fy.set(ci, (fy.get(ci) || 0) + ufy);
        fx.set(cj, (fx.get(cj) || 0) - ufx);
        fy.set(cj, (fy.get(cj) || 0) - ufy);
      }
    }

    // 3. Applique à chaque nœud (force partagée par toute la composante).
    for (const n of nodes as SimNodeWithPos[]) {
      const c = componentByNode.get(n.id);
      if (c === undefined) continue;
      const ax = fx.get(c) || 0;
      const ay = fy.get(c) || 0;
      // On divise par la taille de la composante : sinon une grosse
      // composante recevrait N×plus de poussée, ce qui la rendrait plus
      // mobile qu'une petite — on veut l'inverse intuitivement (les
      // gros clusters sont plus inertiels, ils bougent peu).
      const k = counts.get(c) || 1;
      n.vx = (n.vx || 0) + ax / k;
      n.vy = (n.vy || 0) + ay / k;
    }
  }

  force.initialize = (n: SimNode[]) => { nodes = n; };
  return force;
}

/**
 * Force d3 custom : répulsion d'aire de composante.
 *
 * À chaque tick, pour chaque nœud N (composante A) et chaque autre composante
 * B, si N pénètre le disque englobant (centroïde + rayon + marge) de B, on
 * applique à N une poussée radiale vers l'extérieur de B. Profondeur de
 * pénétration → magnitude (le nœud près du bord est doucement remis en
 * place, un nœud profondément piégé est éjecté plus fort).
 *
 * Différence avec `componentRepulsion` : celle-ci pousse les centroïdes
 * dans leur ensemble (déplace tout le cluster) ; celle-ci ne corrige que
 * les nœuds qui chevauchent visuellement la silhouette d'un voisin, ce qui
 * traite spécifiquement les "intrusions" sans perturber les clusters
 * correctement séparés.
 */
function componentAreaRepulsion(componentByNode: Map<string, number>) {
  let nodes: SimNode[] = [];
  type SimNodeWithPos = SimNode & { x?: number; y?: number; vx?: number; vy?: number };

  function force(alpha: number) {
    if (nodes.length === 0) return;

    const sumX = new Map<number, number>();
    const sumY = new Map<number, number>();
    const counts = new Map<number, number>();
    for (const n of nodes as SimNodeWithPos[]) {
      const c = componentByNode.get(n.id);
      if (c === undefined) continue;
      sumX.set(c, (sumX.get(c) || 0) + (n.x || 0));
      sumY.set(c, (sumY.get(c) || 0) + (n.y || 0));
      counts.set(c, (counts.get(c) || 0) + 1);
    }
    if (counts.size < 2) return;

    const cx = new Map<number, number>();
    const cy = new Map<number, number>();
    for (const [c, k] of counts) {
      cx.set(c, (sumX.get(c) || 0) / k);
      cy.set(c, (sumY.get(c) || 0) / k);
    }

    // Rayon englobant d'une composante : plus grande distance d'un nœud à
    // son centroïde (+ son propre rayon de collision pour englober sa
    // silhouette). C'est la "taille" perçue de la composante à l'écran.
    const compRadius = new Map<number, number>();
    for (const n of nodes as SimNodeWithPos[]) {
      const c = componentByNode.get(n.id);
      if (c === undefined) continue;
      const ccx = cx.get(c) || 0;
      const ccy = cy.get(c) || 0;
      const dx = (n.x || 0) - ccx;
      const dy = (n.y || 0) - ccy;
      const d = Math.sqrt(dx * dx + dy * dy) + (n.radius || 0);
      const cur = compRadius.get(c) || 0;
      if (d > cur) compRadius.set(c, d);
    }

    // Pour chaque nœud, pour chaque composante étrangère, vérifier
    // l'intrusion. O(N × K) avec K = nb composantes — acceptable.
    const components = Array.from(counts.keys());
    for (const n of nodes as SimNodeWithPos[]) {
      const cN = componentByNode.get(n.id);
      if (cN === undefined) continue;
      for (const c of components) {
        if (c === cN) continue;
        const tx = cx.get(c) || 0;
        const ty = cy.get(c) || 0;
        const dx = (n.x || 0) - tx;
        const dy = (n.y || 0) - ty;
        const d2 = dx * dx + dy * dy;
        const limit = (compRadius.get(c) || 0) + COMPONENT_AREA_MARGIN;
        if (d2 >= limit * limit) continue;
        const d = Math.sqrt(d2) || 0.001;
        const penetration = limit - d;
        // Magnitude proportionnelle à la profondeur d'intrusion. alpha
        // intervient pour que l'effet diminue avec la simulation comme
        // les autres forces (sinon on aurait des oscillations infinies).
        const k = penetration * alpha * 0.3;
        n.vx = (n.vx || 0) + (dx / d) * k;
        n.vy = (n.vy || 0) + (dy / d) * k;
      }
    }
  }

  force.initialize = (n: SimNode[]) => { nodes = n; };
  return force;
}

// ──────────────────────────────────────────────
// CACHE DE POSITIONS (persistance entre rendus + sessions)
// ──────────────────────────────────────────────
//
// Module-level : survit au démontage du composant React mais reste local à
// l'onglet. Hydraté depuis localStorage au premier accès.
const positionCache = new Map<string, { x: number; y: number }>();
let positionCacheHydrated = false;

function hydratePositionCache(): void {
  if (positionCacheHydrated) return;
  positionCacheHydrated = true;
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(POSITIONS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, { x: number; y: number }>;
    if (!parsed || typeof parsed !== 'object') return;
    for (const [id, pos] of Object.entries(parsed)) {
      if (!pos) continue;
      if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) continue;
      // On rejette aussi les positions clairement aberrantes : un cache
      // antérieur (ou une session précédente où la simulation a explosé)
      // peut avoir stocké des coords énormes. Les laisser ferait que tout
      // démarrage à chaud reproduise immédiatement la même explosion.
      if (Math.abs(pos.x) > POSITION_CLAMP || Math.abs(pos.y) > POSITION_CLAMP) continue;
      positionCache.set(id, { x: pos.x, y: pos.y });
    }
  } catch {
    // Quota plein, JSON corrompu : on repart sans cache, pas dramatique.
  }
}

function persistPositionCache(): void {
  if (typeof window === 'undefined') return;
  try {
    const obj: Record<string, { x: number; y: number }> = {};
    for (const [id, pos] of positionCache) obj[id] = pos;
    window.localStorage.setItem(POSITIONS_STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // Idem : si l'écriture échoue, on continue sans persistance disque
    // — la session courante garde son cache mémoire.
  }
}

/**
 * Position de démarrage pour un nœud nouvellement apparu (pas dans le cache).
 * Stratégie : se placer auprès d'un voisin déjà connu pour éviter d'arriver
 * à l'origine et de devoir traverser tout le graphe pour trouver son cluster.
 * Si aucun voisin n'est connu, on retombe sur un jitter stable autour de
 * l'origine (comportement par défaut de d3-force).
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
  // Léger offset stable pour ne pas atterrir exactement sur le voisin.
  const j = stableJitter(`seed_${id}`, 40);
  return { x: sumX / count + j.x, y: sumY / count + j.y };
}

/**
 * Retourne une Map id → {x, y} stable tant que la liste des nœuds/arêtes ne change pas.
 * La structure des positions est figée après le calcul ; les drags utilisateur
 * sont gérés par react-flow indépendamment.
 *
 * `refreshKey` permet de forcer un recalcul même quand `nodes`/`edges` ont une
 * identité stable (utile en mode offline pour redistribuer le layout après un
 * ajout extérieur).
 *
 * `nodeZones` (optionnel) attire chaque nœud vers le centre de gravité de
 * la moyenne de ses zones assignées. Force volontairement douce pour incliner
 * la carte sans casser sa cohérence interne (clusters restent groupés).
 */
export function useForceLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  refreshKey: number = 0,
  nodeZones?: Map<string, ZoneId[]>,
): Map<string, PositionedNode> {
  // On dérive un identifiant stable pour la map de zones — sinon une nouvelle
  // référence d'objet à chaque rendu re-déclencherait le useMemo et donc le
  // recalcul complet du layout, ce qui ferait sauter la position figée.
  const zoneSignature = useMemo(() => {
    if (!nodeZones || nodeZones.size === 0) return '';
    const entries: string[] = [];
    for (const [id, zones] of nodeZones) {
      entries.push(`${id}:${zones.slice().sort().join(',')}`);
    }
    return entries.sort().join('|');
  }, [nodeZones]);

  return useMemo(() => {
    if (nodes.length === 0) return new Map();

    hydratePositionCache();

    // Adjacence : utile pour seeder les nouveaux nœuds près d'un voisin connu
    // au lieu de l'origine (sinon ils traversent tout le graphe au cours
    // des ticks et déplacent des clusters au passage).
    const adj = new Map<string, string[]>();
    for (const n of nodes) adj.set(n.id, []);
    for (const e of edges) {
      if (!adj.has(e.source) || !adj.has(e.target)) continue;
      adj.get(e.source)!.push(e.target);
      adj.get(e.target)!.push(e.source);
    }

    // Comptage warm/cold avant création des SimNode : si la majorité des
    // nœuds sont déjà en cache, on lance une simulation à basse énergie.
    let knownCount = 0;
    for (const n of nodes) if (positionCache.has(n.id)) knownCount++;
    const knownRatio = knownCount / nodes.length;
    const isWarmStart = knownRatio >= WARM_KNOWN_RATIO;
    const iterations = isWarmStart ? ITERATIONS_WARM : ITERATIONS_COLD;
    const initialAlpha = isWarmStart ? WARM_ALPHA : 1;

    const simNodes: SimNode[] = nodes.map(n => {
      const cached = positionCache.get(n.id);
      const seed = cached || seedNewNode(n.id, adj);
      const sn: SimNode & { x?: number; y?: number } = {
        id: n.id,
        radius: getCollisionRadius(n),
      };
      if (seed) {
        sn.x = seed.x;
        sn.y = seed.y;
      }
      return sn;
    });

    const simLinks: SimulationLinkDatum<SimNode>[] = edges.map(e => ({
      source: e.source,
      target: e.target,
    }));

    const componentByNode = buildComponentIndex(nodes, edges);

    // Pré-calcul des cibles de gravité par nœud (centre moyen des zones,
    // décalé par un jitter stable pour éviter que toutes les composantes
    // d'une même zone soient tirées au même point exact).
    // Cible mutualisée par composante : tous les nœuds d'un même cluster
    // visent le même point de la zone (sinon le link/collide se battrait
    // contre le jitter et casserait la cohésion du cluster).
    const targetByNodeId = new Map<string, { x: number; y: number }>();
    if (nodeZones) {
      const componentTarget = new Map<number, { x: number; y: number }>();
      for (const [id, zones] of nodeZones) {
        const base = meanZoneCenter(zones);
        if (!base) continue;
        const comp = componentByNode.get(id);
        let target = comp !== undefined ? componentTarget.get(comp) : undefined;
        if (!target) {
          // Anchor de jitter : id de la composante (ou de la zone moyenne
          // pour les nœuds isolés) → angle/rayon déterministes.
          const seed = comp !== undefined ? `comp_${comp}_${zones.join(',')}` : id;
          const j = stableJitter(seed, ZONE_JITTER_RADIUS);
          target = { x: base.x + j.x, y: base.y + j.y };
          if (comp !== undefined) componentTarget.set(comp, target);
        }
        targetByNodeId.set(id, target);
      }
    }
    const hasZones = targetByNodeId.size > 0;

    const sim = forceSimulation(simNodes)
      .alpha(initialAlpha)
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
      .force('componentRepulsion', componentRepulsion(componentByNode))
      .force('componentArea', componentAreaRepulsion(componentByNode));

    if (hasZones) {
      sim
        .force(
          'zoneX',
          forceX<SimNode>(d => targetByNodeId.get(d.id)?.x ?? 0)
            .strength(d => (targetByNodeId.has(d.id) ? ZONE_GRAVITY_STRENGTH : 0)),
        )
        .force(
          'zoneY',
          forceY<SimNode>(d => targetByNodeId.get(d.id)?.y ?? 0)
            .strength(d => (targetByNodeId.has(d.id) ? ZONE_GRAVITY_STRENGTH : 0)),
        );
    }

    sim.stop();
    for (let i = 0; i < iterations; i++) sim.tick();

    const positions = new Map<string, PositionedNode>();
    for (const n of simNodes) {
      const sn = n as SimNode & { x?: number; y?: number };
      // Garde-fou : NaN / Infinity / explosion → on ramène au centre.
      // Sans ça, react-flow tente de rendre des nœuds à des coords absurdes,
      // fitView s'écrase à minZoom et le canvas paraît entièrement vide.
      const rawX = sn.x;
      const rawY = sn.y;
      let x = Number.isFinite(rawX) ? (rawX as number) : 0;
      let y = Number.isFinite(rawY) ? (rawY as number) : 0;
      if (x > POSITION_CLAMP) x = POSITION_CLAMP;
      else if (x < -POSITION_CLAMP) x = -POSITION_CLAMP;
      if (y > POSITION_CLAMP) y = POSITION_CLAMP;
      else if (y < -POSITION_CLAMP) y = -POSITION_CLAMP;
      positions.set(sn.id, { id: sn.id, x, y });
      positionCache.set(sn.id, { x, y });
    }
    // On ne purge PAS les positions des nœuds absents du rendu courant : le
    // filtrage par contentieux peut masquer temporairement des nœuds, et on
    // veut retrouver leur position d'origine quand le filtre est retiré.
    // Un nœud vraiment supprimé (id jamais réutilisé) reste inerte dans le
    // cache, sans coût visible.
    persistPositionCache();
    return positions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, refreshKey, zoneSignature]);
}

export function getNodeRadius(node: GraphNode): number {
  return radiusOf(node);
}

/**
 * Vide le cache de positions (mémoire + localStorage). Au prochain layout,
 * un démarrage à froid (alpha=1, 300 ticks) repositionne tout depuis zéro.
 * Utile pour offrir un bouton "Réorganiser" si l'utilisateur trouve la
 * disposition courante figée dans une mauvaise configuration.
 */
export function clearLayoutCache(): void {
  positionCache.clear();
  if (typeof window !== 'undefined') {
    try { window.localStorage.removeItem(POSITIONS_STORAGE_KEY); } catch { /* ignore */ }
  }
}
