// components/mindmap/zones.ts
// Zones géographiques pour la cartographie : 9 cardinaux + centre.
// Chaque tag (= service d'enquête, ou autre) peut être assigné à une zone ;
// les nœuds (dossiers et MEC) héritent ainsi d'un puits de gravité directionnel
// qui structure la carte selon une logique territoriale, sans avoir à
// matérialiser les services comme des nœuds.

export type ZoneId = 'centre' | 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export const ZONE_IDS: ZoneId[] = ['centre', 'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export const ZONE_LABELS: Record<ZoneId, string> = {
  centre: 'Centre',
  N: 'Nord',
  NE: 'Nord-Est',
  E: 'Est',
  SE: 'Sud-Est',
  S: 'Sud',
  SW: 'Sud-Ouest',
  W: 'Ouest',
  NW: 'Nord-Ouest',
};

// Rayon virtuel en pixels monde des zones cardinales depuis le centre.
// Choisi pour que les puits de gravité soient au-delà de la zone naturelle
// d'agrégation d'un cluster (LINK_DISTANCE = 180) sans pour autant éclater
// le graphe. À tuner si besoin.
const R = 600;
const D = R * 0.7071;

export const ZONE_CENTERS: Record<ZoneId, { x: number; y: number }> = {
  centre: { x: 0, y: 0 },
  // Y croît vers le bas en coords écran, donc N = -Y.
  N: { x: 0, y: -R },
  NE: { x: D, y: -D },
  E: { x: R, y: 0 },
  SE: { x: D, y: D },
  S: { x: 0, y: R },
  SW: { x: -D, y: D },
  W: { x: -R, y: 0 },
  NW: { x: -D, y: -D },
};

/**
 * Centre de gravité moyen pour un nœud présent dans plusieurs zones :
 * moyenne vectorielle des centres. Un nœud à la fois "Est" et "Sud" est
 * tiré vers le sud-est, ce qui est intuitivement attendu.
 */
export function meanZoneCenter(zones: ZoneId[]): { x: number; y: number } | undefined {
  if (zones.length === 0) return undefined;
  let x = 0, y = 0;
  for (const z of zones) {
    x += ZONE_CENTERS[z].x;
    y += ZONE_CENTERS[z].y;
  }
  return { x: x / zones.length, y: y / zones.length };
}

/** Position grille 3×3 (col, row) pour le sélecteur UI. */
export const ZONE_GRID_POSITION: Record<ZoneId, { col: 0 | 1 | 2; row: 0 | 1 | 2 }> = {
  NW: { col: 0, row: 0 }, N: { col: 1, row: 0 }, NE: { col: 2, row: 0 },
  W:  { col: 0, row: 1 }, centre: { col: 1, row: 1 }, E: { col: 2, row: 1 },
  SW: { col: 0, row: 2 }, S: { col: 1, row: 2 }, SE: { col: 2, row: 2 },
};
