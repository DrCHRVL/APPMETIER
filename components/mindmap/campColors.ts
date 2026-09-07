// components/mindmap/campColors.ts
// Palette des camps (réseaux d'appartenance). Partagée par les deux endroits
// où une couleur de camp se choisit : la fiche d'une personne (assignation)
// et la légende de la carte (édition du camp entier). Teintes franches et
// bien séparées : la couleur d'un camp doit se lire d'un coup d'œil dans
// l'aura peinte sous les bulles, même quand deux camps se touchent.
export const CAMP_COLOR_PRESETS = [
  '#dc2626', // rouge
  '#ea580c', // orange
  '#ca8a04', // ambre
  '#16a34a', // vert
  '#0891b2', // cyan
  '#2563eb', // bleu
  '#7c3aed', // violet
  '#db2777', // rose
  '#475569', // ardoise
];

// ──────────────────────────────────────────────
// CAMP DOMINANT D'UN DOSSIER
// ──────────────────────────────────────────────
// Règle partagée par les deux consommateurs de la couleur de camp :
//   • la carte (MindmapCanvas) peint la boîte du dossier aux couleurs du
//     camp qui le domine — le dossier est « contaminé » par le clan ;
//   • le layout (useForceLayout) s'en sert pour repousser les planètes qui
//     n'appartiennent PAS à ce camp, afin qu'elles ne baignent pas dans une
//     couleur qui n'est pas la leur.
// Une seule règle, un seul seuil : les deux ne peuvent pas diverger.

/** Part minimale des personnes d'un dossier appartenant à un même camp pour
 *  que ce camp soit dit « dominant » (et teinte le dossier). */
export const CAMP_DOMINANCE_SHARE = 0.6;
/** En deçà de ce nombre de personnes, un dossier ne bascule pas : une seule
 *  assignation ne doit pas repeindre un dossier entier. */
export const CAMP_DOMINANCE_MIN_MEC = 3;

interface CampCountable {
  type: 'mec' | 'dossier';
  dossierIds?: string[];
  campLabel?: string;
}

/**
 * Camp dominant de chaque dossier (label), quand un camp réunit au moins
 * CAMP_DOMINANCE_SHARE des personnes du dossier. Les dossiers sans camp
 * majoritaire sont absents de la map.
 */
export function dominantCampByDossier(nodes: CampCountable[]): Map<string, string> {
  const total = new Map<string, number>();
  const byCamp = new Map<string, Map<string, number>>();
  for (const n of nodes) {
    if (n.type !== 'mec' || !n.dossierIds) continue;
    for (const did of n.dossierIds) {
      total.set(did, (total.get(did) ?? 0) + 1);
      if (!n.campLabel) continue;
      let counts = byCamp.get(did);
      if (!counts) { counts = new Map(); byCamp.set(did, counts); }
      counts.set(n.campLabel, (counts.get(n.campLabel) ?? 0) + 1);
    }
  }
  const out = new Map<string, string>();
  for (const [did, counts] of byCamp) {
    const n = total.get(did) ?? 0;
    if (n < CAMP_DOMINANCE_MIN_MEC) continue;
    let best = '';
    let bestCount = 0;
    for (const [label, c] of counts) {
      // Départage lexicographique : stabilité entre deux rendus.
      if (c > bestCount || (c === bestCount && label < best)) { best = label; bestCount = c; }
    }
    if (best && bestCount / n >= CAMP_DOMINANCE_SHARE) out.set(did, best);
  }
  return out;
}
