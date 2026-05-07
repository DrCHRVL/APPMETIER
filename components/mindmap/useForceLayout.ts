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

const ITERATIONS = 300;
const CENTER_X = 0;
const CENTER_Y = 0;
const LINK_DISTANCE = 180;
// Rigidité du ressort de lien. Plus elle est élevée, plus les voisins
// directs restent collés. Quand un nœud a plusieurs voisins répartis dans
// des sous-zones de la composante, les ressorts tirent en sens contraire :
// si la rigidité est faible, le nœud le moins représenté (= ayant le moins
// de ressorts vers lui) se laisse étirer car son unique ressort ne pèse
// pas lourd face aux N ressorts du côté opposé. Une rigidité haute égalise
// la résistance et garde les sous-groupes structurellement cohérents.
const LINK_STRENGTH = 1.0;
const CHARGE_STRENGTH = -550;
// Répulsion entre composantes connexes : force custom de type "ressort de
// séparation minimale". Pour chaque paire (A, B) de composantes, on calcule
// une distance cible = rayonA + rayonB + gap, où le rayon dépend de la
// taille (√ du nb de nœuds). Si la distance entre centroïdes est inférieure,
// on applique une force linéaire qui pousse jusqu'à atteindre la cible.
// Au-delà, force nulle : on laisse les autres forces (gravité de zone,
// charge, link) piloter sans bruit parasite à longue distance.
//
// Cette formulation a remplacé une répulsion Coulomb-like (1/d²) qui était
// inopérante dès que d dépassait quelques centaines de px : deux composantes
// assignées à la même zone (même puits de gravité) étaient agglutinées
// car la répulsion à d ≈ 1000 px tendait vers zéro pendant que la gravité
// de zone tirait continuellement vers le même point.
const COMPONENT_RADIUS_PER_SQRTNODE = 130;
const COMPONENT_MIN_GAP = 350;
const COMPONENT_SEPARATION_STRENGTH = 5;
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
 *
 * Seules les arêtes `data` (déduites des dossiers) définissent l'appartenance :
 * un lien `renseignement` est un overlay manuel d'annotation, il n'a pas
 * vocation à fusionner deux réseaux en une seule composante structurelle.
 * Sinon un simple lien renseignement entre deux trafics indépendants suffit
 * à les agglutiner visuellement (plus de répulsion inter-clusters), ce qui
 * trahit la topologie réelle.
 */
function buildComponentIndex(
  nodes: GraphNode[],
  edges: GraphEdge[],
): Map<string, number> {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    if (e.kind !== 'data') continue;
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
 * Force d3 custom : ressort de séparation minimale entre composantes connexes.
 *
 * À chaque tick :
 *   1. Calcule le centroïde de chaque composante.
 *   2. Pour chaque paire (A, B), calcule une distance cible
 *      target = rayonA + rayonB + gap, où rayon ≈ k·√(taille).
 *   3. Si la distance courante d est inférieure à target, applique une
 *      force linéaire `STRENGTH · (target - d) · alpha` qui pousse les
 *      centroïdes à s'écarter jusqu'à atteindre target. Au-delà, force nulle.
 *
 * Cette formulation a remplacé une répulsion Coulomb-like (1/d²) qui
 * tendait vers zéro avant d'avoir séparé deux composantes assignées à la
 * même zone : la gravité de zone tirait continuellement vers le même puits
 * pendant que la répulsion devenait inopérante au-delà de ~500 px.
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
    const radius = new Map<number, number>();
    for (const [c, n] of counts) {
      cx.set(c, (sumX.get(c) || 0) / n);
      cy.set(c, (sumY.get(c) || 0) / n);
      radius.set(c, COMPONENT_RADIUS_PER_SQRTNODE * Math.sqrt(n));
    }

    // 2. Force par composante : ressort unilatéral si centroïdes trop proches.
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
        const target = (radius.get(ci) || 0) + (radius.get(cj) || 0) + COMPONENT_MIN_GAP;
        if (d >= target) continue; // assez éloignés : pas de force
        const magnitude = COMPONENT_SEPARATION_STRENGTH * (target - d) * alpha;
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

    const simNodes: SimNode[] = nodes.map(n => ({
      id: n.id,
      radius: getCollisionRadius(n),
    }));

    // Seules les arêtes `data` exercent une force de ressort. Les liens
    // renseignement sont un overlay d'annotation : leur tracé reste affiché
    // (cf. MindmapCanvas.rfEdges) mais ils ne doivent pas tirer deux
    // réseaux indépendants l'un vers l'autre.
    const simLinks: SimulationLinkDatum<SimNode>[] = edges
      .filter(e => e.kind === 'data')
      .map(e => ({ source: e.source, target: e.target }));

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
      .force(
        'link',
        forceLink<SimNode, SimulationLinkDatum<SimNode>>(simLinks)
          .id(d => d.id)
          .distance(LINK_DISTANCE)
          .strength(LINK_STRENGTH),
      )
      .force('charge', forceManyBody<SimNode>().strength(CHARGE_STRENGTH))
      .force('center', forceCenter(CENTER_X, CENTER_Y))
      .force('collide', forceCollide<SimNode>().radius(d => d.radius + COLLIDE_PADDING).strength(1))
      .force('componentRepulsion', componentRepulsion(componentByNode));

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
    for (let i = 0; i < ITERATIONS; i++) sim.tick();

    const positions = new Map<string, PositionedNode>();
    for (const n of simNodes) {
      const sn = n as SimNode & { x?: number; y?: number };
      positions.set(sn.id, { id: sn.id, x: sn.x ?? 0, y: sn.y ?? 0 });
    }
    return positions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, refreshKey, zoneSignature]);
}

export function getNodeRadius(node: GraphNode): number {
  return radiusOf(node);
}
