// components/mindmap/clusterColors.ts
// Palette dérivée de la structure du graphe ("contamination par réseau") :
// chaque composante connexe reçoit une teinte stable distincte, et au sein
// d'une composante chaque nœud est désaturé/éclairci en fonction de sa
// distance BFS au "noyau" (le MEC ou le dossier le plus central). Effet
// visuel : un coup d'œil suffit pour repérer un réseau et son cœur, deux
// réseaux distincts ne se confondent jamais même s'ils partagent un
// contentieux. La couleur de bordure des dossiers reste celle du
// contentieux — le double codage permet de lire à la fois le réseau (fond)
// et le type d'affaire (bordure).

import type { GraphEdge, GraphNode } from '@/utils/mindmapGraph';

export interface NodeColor {
  /** Couleur de fond/teinte principale dérivée du réseau. */
  fill: string;
  /** Saturation à 100% pour le noyau, conservée pour les hulls/effets. */
  core: string;
}

// Palette HSL : 12 teintes bien séparées sur le cercle chromatique. On évite
// les jaunes très clairs (mauvais contraste sur fond clair) et on garde des
// saturations moyennes pour rester lisible en pastille comme en blob.
const PALETTE_HUES = [
  210, // bleu
  340, // rose / framboise
  150, // vert sapin
  30,  // orange
  270, // violet
  190, // cyan
  10,  // rouge corail
  120, // vert pomme
  250, // indigo
  60,  // moutarde
  300, // magenta
  170, // teal
];

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`;
}

/**
 * BFS distance depuis un nœud source vers tous les autres dans une composante.
 * Utilise une adjacence pré-calculée (data uniquement — les liens
 * renseignement ne définissent pas l'appartenance à un réseau).
 */
function bfsDistances(
  sourceId: string,
  componentIds: Set<string>,
  adj: Map<string, string[]>,
): Map<string, number> {
  const dist = new Map<string, number>();
  dist.set(sourceId, 0);
  const queue: string[] = [sourceId];
  while (queue.length) {
    const cur = queue.shift()!;
    const d = dist.get(cur)!;
    for (const nb of adj.get(cur) || []) {
      if (!componentIds.has(nb)) continue;
      if (dist.has(nb)) continue;
      dist.set(nb, d + 1);
      queue.push(nb);
    }
  }
  return dist;
}

/**
 * Trouve le "noyau" d'une composante : le MEC avec le plus haut score, ou à
 * défaut (composante sans MEC) le dossier avec le plus de MEC. Le noyau
 * sert d'origine BFS pour la décroissance de saturation.
 */
function pickCore(members: GraphNode[]): GraphNode | undefined {
  let bestMec: GraphNode | undefined;
  let bestMecScore = -Infinity;
  let bestDossier: GraphNode | undefined;
  let bestDossierMec = -Infinity;
  for (const n of members) {
    if (n.type === 'mec') {
      if (n.score > bestMecScore) { bestMec = n; bestMecScore = n.score; }
    } else {
      if (n.nbMec > bestDossierMec) { bestDossier = n; bestDossierMec = n.nbMec; }
    }
  }
  return bestMec || bestDossier;
}

/**
 * Calcule la palette par nœud à partir du graphe. Renvoie une Map id →
 * { fill, core } où :
 *   - fill : couleur HSL avec saturation/lightness modulées par la distance
 *            au noyau (cœur saturé, périphérie pastel).
 *   - core : couleur HSL pleine saturation, utile pour les hulls/halos qui
 *            doivent rester lisibles même rendus à faible opacité.
 *
 * Les nœuds "isolés" (composante de taille 1, typiquement un dossier ex
 * nihilo orphelin) reçoivent une teinte fallback grise pour les démarquer
 * sans les confondre avec un réseau.
 */
export function computeClusterColors(
  nodes: GraphNode[],
  edges: GraphEdge[],
): {
  byNode: Map<string, NodeColor>;
  /** Couleur "core" par id de composante (concat trié des ids), utile pour
   *  teinter le hull entier d'une seule couleur. */
  byComponent: Map<string, string>;
} {
  const byNode = new Map<string, NodeColor>();
  const byComponent = new Map<string, string>();
  if (nodes.length === 0) return { byNode, byComponent };

  // Adjacence pour la détection de réseau : SEULES les arêtes "data"
  // comptent. Un simple lien de renseignement entre deux réseaux ne doit
  // pas les fusionner en une seule composante (et donc une seule couleur),
  // sinon le code "réseau partagé" devient indiscernable d'un vrai
  // partage de MEC. Les renseignement restent visibles côté rendu et
  // tirent les nœuds visuellement proches via la force de lien.
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    if (e.kind === 'renseignement') continue;
    if (!adj.has(e.source) || !adj.has(e.target)) continue;
    adj.get(e.source)!.push(e.target);
    adj.get(e.target)!.push(e.source);
  }

  // Composantes connexes (BFS — Union-Find serait équivalent mais inutile ici).
  const visited = new Set<string>();
  const components: GraphNode[][] = [];
  const byId = new Map(nodes.map(n => [n.id, n]));
  for (const n of nodes) {
    if (visited.has(n.id)) continue;
    const comp: GraphNode[] = [];
    const queue: string[] = [n.id];
    visited.add(n.id);
    while (queue.length) {
      const cur = queue.shift()!;
      const node = byId.get(cur);
      if (node) comp.push(node);
      for (const nb of adj.get(cur) || []) {
        if (!visited.has(nb)) { visited.add(nb); queue.push(nb); }
      }
    }
    components.push(comp);
  }

  for (const comp of components) {
    const compIds = new Set(comp.map(n => n.id));
    const compKey = comp.map(n => n.id).sort().join('|');

    // Composante isolée (1 nœud, typiquement un dossier ex nihilo orphelin) :
    // gris neutre, pas de "réseau" à marquer.
    if (comp.length <= 1) {
      const fillFallback = hsl(220, 8, 70);
      const coreFallback = hsl(220, 8, 50);
      for (const n of comp) byNode.set(n.id, { fill: fillFallback, core: coreFallback });
      byComponent.set(compKey, coreFallback);
      continue;
    }

    // Hue stable : hash de l'identifiant de composante. Deux ensembles de
    // nœuds différents ⇒ teintes différentes (sauf collision de hash, rare).
    const hueIdx = fnv1a(compKey) % PALETTE_HUES.length;
    const hue = PALETTE_HUES[hueIdx];

    const core = pickCore(comp);
    const distances = core
      ? bfsDistances(core.id, compIds, adj)
      : new Map<string, number>(comp.map(n => [n.id, 0]));

    // Distance maximale dans la composante → normalise la décroissance.
    let maxDist = 0;
    for (const d of distances.values()) if (d > maxDist) maxDist = d;
    if (maxDist === 0) maxDist = 1;

    const coreColor = hsl(hue, 70, 45);
    byComponent.set(compKey, coreColor);

    for (const n of comp) {
      const d = distances.get(n.id) ?? maxDist;
      const t = d / maxDist; // 0 = noyau, 1 = périphérie
      // Saturation 60% → 22% ; lightness 78% → 90%. On reste sur des
      // pastels lisibles en arrière-plan (le texte du dossier doit rester
      // lisible) — la couleur "marque" le réseau et son cœur, sans se
      // substituer au texte. Le cœur est plus coloré, la périphérie tend
      // vers un gris très légèrement teinté.
      const s = 60 - 38 * t;
      const l = 78 + 12 * t;
      byNode.set(n.id, { fill: hsl(hue, s, l), core: coreColor });
    }
  }

  return { byNode, byComponent };
}
