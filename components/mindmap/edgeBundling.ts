// components/mindmap/edgeBundling.ts
//
// FORCE-DIRECTED EDGE BUNDLING (Holten & van Wijk, EuroVis 2009).
//
// Problème traité : au cœur d'une grosse galaxie, les liens d'une personne
// partagée (une « comète », présente dans plusieurs dossiers) traversent la
// carte dans toutes les directions. Individuellement chaque trait est juste ;
// ensemble ils forment un treillis illisible.
//
// Principe : chaque lien est découpé en points de subdivision, puis on fait
// tourner une petite simulation où
//   • un ressort retient les points d'un même lien alignés (rigidité kP,
//     inversement proportionnelle à la longueur du lien) ;
//   • une attraction électrostatique tire les points de MÊME RANG de deux
//     liens *compatibles* l'un vers l'autre.
// Les faisceaux qui vont dans la même direction fusionnent donc en un tronc
// commun qui se sépare aux extrémités, comme un câblage. Les liens sans
// voisin compatible ne bougent pas d'un pixel.
//
// La compatibilité est le garde-fou : quatre critères multipliés (angle,
// échelle, position, visibilité mutuelle). Sous le seuil, deux liens
// s'ignorent — c'est ce qui empêche de coller ensemble deux traits qui
// n'ont rien à voir juste parce qu'ils passent au même endroit.
//
// Le module est pur (aucune dépendance React/d3) : entrée = segments,
// sortie = points intermédiaires par lien.

export interface BundlePoint {
  x: number;
  y: number;
}

export interface BundleInput {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface BundledPath {
  /** Points intermédiaires (extrémités exclues), de la source vers la cible. */
  points: BundlePoint[];
  /** Extrémités au moment du calcul. Permet de recaler la courbe par
   *  similitude si l'utilisateur déplace un nœud à la main sans que le
   *  layout (et donc le bundling) soit recalculé. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface BundleOptions {
  /** Rigidité globale des liens. Plus K est grand, moins ils se laissent
   *  courber. 0.1 = valeur du papier. */
  K?: number;
  /** Pas de déplacement initial (px). Divisé par 2 à chaque cycle. */
  stepSize?: number;
  /** Nombre de cycles. À chaque cycle le nombre de points de subdivision
   *  double (1, 2, 4, 8…) : on bundle d'abord grossièrement, puis on affine. */
  cycles?: number;
  /** Itérations du premier cycle (décroissantes ensuite). */
  iterations?: number;
  /** Facteur de décroissance des itérations d'un cycle au suivant. */
  iterationRate?: number;
  /** Seuil de compatibilité (produit des 4 critères) au-delà duquel deux
   *  liens s'attirent. 0.6 = valeur du papier ; monter = bundling plus
   *  sélectif (moins de troncs, plus fidèle aux tracés d'origine). */
  compatibilityThreshold?: number;
}

const EPS = 1e-6;

interface Vec {
  x: number;
  y: number;
}

function sub(a: Vec, b: Vec): Vec {
  return { x: a.x - b.x, y: a.y - b.y };
}

function mid(a: Vec, b: Vec): Vec {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function norm(v: Vec): number {
  return Math.hypot(v.x, v.y);
}

/** Projection orthogonale de p sur la droite (a, b). */
function projectOnLine(p: Vec, a: Vec, b: Vec): Vec {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  if (l2 < EPS) return { x: a.x, y: a.y };
  const t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2;
  return { x: a.x + t * abx, y: a.y + t * aby };
}

// ──────────────────────────────────────────────────────────────────────
// COMPATIBILITÉ (les 4 critères du papier)
// ──────────────────────────────────────────────────────────────────────

/** Angle : deux liens parallèles sont compatibles, deux liens
 *  perpendiculaires ne le sont pas. Valeur absolue → le sens ne compte pas
 *  (on rattrape le sens au moment d'apparier les points de subdivision). */
function angleCompatibility(p: Vec, q: Vec, lp: number, lq: number): number {
  return Math.abs((p.x * q.x + p.y * q.y) / (lp * lq));
}

/** Échelle : un lien court ne se fait pas absorber par un lien long. */
function scaleCompatibility(lp: number, lq: number): number {
  const avg = (lp + lq) / 2;
  if (avg < EPS) return 0;
  return 2 / (avg / Math.min(lp, lq) + Math.max(lp, lq) / avg);
}

/** Position : deux liens parallèles mais éloignés ne se rejoignent pas. */
function positionCompatibility(mp: Vec, mq: Vec, lp: number, lq: number): number {
  const avg = (lp + lq) / 2;
  if (avg < EPS) return 0;
  return avg / (avg + norm(sub(mp, mq)));
}

/** Visibilité d'un lien depuis l'autre : nulle si l'un est « derrière »
 *  l'autre (leurs projections ne se recouvrent pas). Symétrisée par un min. */
function visibility(p0: Vec, p1: Vec, q0: Vec, q1: Vec): number {
  const i0 = projectOnLine(q0, p0, p1);
  const i1 = projectOnLine(q1, p0, p1);
  const im = mid(i0, i1);
  const pm = mid(p0, p1);
  const span = norm(sub(i0, i1));
  if (span < EPS) return 0;
  return Math.max(0, 1 - (2 * norm(sub(pm, im))) / span);
}

function visibilityCompatibility(p0: Vec, p1: Vec, q0: Vec, q1: Vec): number {
  return Math.min(visibility(p0, p1, q0, q1), visibility(q0, q1, p0, p1));
}

// ──────────────────────────────────────────────────────────────────────
// RÉÉCHANTILLONNAGE
// ──────────────────────────────────────────────────────────────────────

/** Redécoupe une polyligne en `segments` segments de longueur égale,
 *  extrémités comprises. Sert au doublement du nombre de points entre deux
 *  cycles : la forme obtenue au cycle précédent est conservée. */
function resample(path: Vec[], segments: number): Vec[] {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += norm(sub(path[i], path[i - 1]));
  const out: Vec[] = [{ x: path[0].x, y: path[0].y }];
  if (total < EPS) {
    for (let i = 1; i < segments; i++) out.push({ x: path[0].x, y: path[0].y });
    out.push({ x: path[path.length - 1].x, y: path[path.length - 1].y });
    return out;
  }
  const step = total / segments;
  let target = step;
  let travelled = 0;
  let i = 1;
  let cur = path[0];
  while (out.length < segments && i < path.length) {
    const segLen = norm(sub(path[i], cur));
    if (travelled + segLen >= target - EPS && segLen > EPS) {
      const t = (target - travelled) / segLen;
      const point = { x: cur.x + t * (path[i].x - cur.x), y: cur.y + t * (path[i].y - cur.y) };
      out.push(point);
      travelled = target;
      cur = point;
      target += step;
    } else {
      travelled += segLen;
      cur = path[i];
      i++;
    }
  }
  while (out.length < segments) out.push({ x: path[path.length - 1].x, y: path[path.length - 1].y });
  out.push({ x: path[path.length - 1].x, y: path[path.length - 1].y });
  return out;
}

// ──────────────────────────────────────────────────────────────────────
// BUNDLING
// ──────────────────────────────────────────────────────────────────────

/**
 * Regroupe les liens compatibles en faisceaux. Retourne, pour chaque lien
 * fourni, les points intermédiaires de sa courbe (liste vide si le lien n'a
 * bougé pour personne — l'appelant peut alors garder son tracé d'origine).
 *
 * Coût : O(E²) pour la compatibilité, puis O(E × P × voisins) par itération.
 * Appelé au (re)calcul du layout, pas au rendu.
 */
export function bundleEdges(input: BundleInput[], options: BundleOptions = {}): Map<string, BundledPath> {
  const K = options.K ?? 0.1;
  const cycles = options.cycles ?? 6;
  const iterationRate = options.iterationRate ?? 2 / 3;
  const threshold = options.compatibilityThreshold ?? 0.6;
  let step = options.stepSize ?? 0.12;
  let iterations = options.iterations ?? 60;

  const out = new Map<string, BundledPath>();

  const edges = input.filter(e => Math.hypot(e.x2 - e.x1, e.y2 - e.y1) > EPS);
  const n = edges.length;
  if (n < 2) return out;

  const starts: Vec[] = edges.map(e => ({ x: e.x1, y: e.y1 }));
  const ends: Vec[] = edges.map(e => ({ x: e.x2, y: e.y2 }));
  const vectors: Vec[] = edges.map((e, i) => sub(ends[i], starts[i]));
  const lengths: number[] = vectors.map(norm);
  const mids: Vec[] = edges.map((_, i) => mid(starts[i], ends[i]));

  // Voisinage compatible. `reversed` : les deux liens pointent en sens
  // opposés → on apparie le point k de l'un avec le point (P−k) de l'autre,
  // sinon le tronc se tordrait en croisant les deux tracés.
  const neighbors: Array<Array<{ j: number; reversed: boolean }>> = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const ca = angleCompatibility(vectors[i], vectors[j], lengths[i], lengths[j]);
      if (ca < threshold) continue; // filtre le plus discriminant : on coupe tôt
      const cs = scaleCompatibility(lengths[i], lengths[j]);
      if (ca * cs < threshold) continue;
      const cp = positionCompatibility(mids[i], mids[j], lengths[i], lengths[j]);
      if (ca * cs * cp < threshold) continue;
      const cv = visibilityCompatibility(starts[i], ends[i], starts[j], ends[j]);
      if (ca * cs * cp * cv < threshold) continue;
      const reversed = vectors[i].x * vectors[j].x + vectors[i].y * vectors[j].y < 0;
      neighbors[i].push({ j, reversed });
      neighbors[j].push({ j: i, reversed });
    }
  }

  // Chemins courants : extrémités + points de subdivision.
  let paths: Vec[][] = edges.map((_, i) => [
    { x: starts[i].x, y: starts[i].y },
    { x: mids[i].x, y: mids[i].y },
    { x: ends[i].x, y: ends[i].y },
  ]);

  for (let cycle = 0; cycle < cycles; cycle++) {
    const rounds = Math.max(1, Math.round(iterations));
    for (let round = 0; round < rounds; round++) {
      for (let i = 0; i < n; i++) {
        const path = paths[i];
        const last = path.length - 1;
        if (last < 2) continue;
        const kP = K / (lengths[i] * last);
        for (let k = 1; k < last; k++) {
          const p = path[k];
          // Ressort : rappel vers les deux points voisins du même lien.
          let fx = kP * (path[k - 1].x - p.x + path[k + 1].x - p.x);
          let fy = kP * (path[k - 1].y - p.y + path[k + 1].y - p.y);
          // Électrostatique : vecteur unitaire vers le point de même rang
          // de chaque lien compatible.
          for (const nb of neighbors[i]) {
            const other = paths[nb.j];
            const q = other[nb.reversed ? other.length - 1 - k : k];
            if (!q) continue;
            const dx = q.x - p.x;
            const dy = q.y - p.y;
            const d = Math.hypot(dx, dy);
            if (d < EPS) continue;
            fx += dx / d;
            fy += dy / d;
          }
          p.x += step * fx;
          p.y += step * fy;
        }
      }
    }
    step /= 2;
    iterations *= iterationRate;
    if (cycle < cycles - 1) {
      const segments = (paths[0].length - 1) * 2;
      paths = paths.map(path => resample(path, segments));
    }
  }

  for (let i = 0; i < n; i++) {
    out.set(edges[i].id, {
      points: paths[i].slice(1, -1).map(p => ({ x: p.x, y: p.y })),
      x1: starts[i].x,
      y1: starts[i].y,
      x2: ends[i].x,
      y2: ends[i].y,
    });
  }
  return out;
}
