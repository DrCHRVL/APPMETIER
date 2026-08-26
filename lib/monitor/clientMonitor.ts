// lib/monitor/clientMonitor.ts
//
// MONITEUR D'ACTIVITÉ — côté navigateur.
//
// Le « gestionnaire des tâches » de SIRAL : chaque travail de fond notable
// (veille de recoupements, lecture des pièces, synchronisation, copies de
// sauvegarde) se déclare ici — début, progression, fin. Le panneau
// MoniteurActivite lit cet état ; personne d'autre. Zéro coût quand le panneau
// est fermé : on ne fait que tenir à jour quelques objets en mémoire.
//
// S'y ajoutent deux mesures passives de santé du navigateur :
//  - les LONG TASKS (PerformanceObserver) : tout blocage du thread principal
//    de plus de 50 ms — c'est exactement le « lag » ressenti ;
//  - la mémoire JS (performance.memory, Chrome/Edge seulement).

export interface ActiviteNavigateur {
  id: string;
  /** Libellé lisible : « Veille de recoupements — détection ». */
  label: string;
  /** Famille pour le regroupement à l'écran. */
  famille: 'veille' | 'pieces' | 'sync' | 'sauvegarde' | 'autre';
  demarreA: number;
  termineA?: number;
  dureeMs?: number;
  /** Progression facultative (ex. pièces lues). */
  fait?: number;
  total?: number;
  detail?: string;
  erreur?: boolean;
}

export interface LongTaskInfo {
  /** Blocages du thread principal (>50 ms) sur la dernière minute glissante. */
  derniereMinute: number;
  /** Durée cumulée de ces blocages (ms) sur la dernière minute. */
  msBloquesDerniereMinute: number;
  /** Le plus long blocage observé depuis l'ouverture (ms). */
  pireMs: number;
}

const MAX_HISTORIQUE = 30;

const enCours = new Map<string, ActiviteNavigateur>();
const historique: ActiviteNavigateur[] = [];
const abonnes = new Set<() => void>();
let compteur = 0;

// ── Long tasks ──
const longTasks: Array<{ at: number; dureeMs: number }> = [];
let pireLongTaskMs = 0;
let observerInstalle = false;

function installerObserver(): void {
  if (observerInstalle || typeof window === 'undefined') return;
  observerInstalle = true;
  try {
    const obs = new PerformanceObserver(list => {
      const now = performance.now();
      for (const entry of list.getEntries()) {
        longTasks.push({ at: now, dureeMs: entry.duration });
        if (entry.duration > pireLongTaskMs) pireLongTaskMs = entry.duration;
      }
      // fenêtre glissante d'une minute
      const limite = now - 60_000;
      while (longTasks.length > 0 && longTasks[0].at < limite) longTasks.shift();
    });
    obs.observe({ entryTypes: ['longtask'] });
  } catch { /* navigateur sans longtask : le moniteur s'en passe */ }
}

function notifier(): void {
  for (const cb of abonnes) {
    try { cb(); } catch { /* un abonné cassé ne bloque pas les autres */ }
  }
}

/**
 * Déclare un travail qui commence. Rend les crochets pour le faire vivre :
 * `progression(fait, total)` et `fin(detail?)` / `echec(detail?)`.
 */
export function activiteDebut(
  label: string,
  famille: ActiviteNavigateur['famille'],
  detail?: string,
): { progression: (fait: number, total?: number) => void; fin: (detail?: string) => void; echec: (detail?: string) => void } {
  installerObserver();
  const id = `a${++compteur}`;
  const activite: ActiviteNavigateur = { id, label, famille, demarreA: Date.now(), detail };
  enCours.set(id, activite);
  notifier();

  const clore = (erreur: boolean, detailFin?: string) => {
    if (!enCours.has(id)) return;
    enCours.delete(id);
    activite.termineA = Date.now();
    activite.dureeMs = activite.termineA - activite.demarreA;
    if (detailFin) activite.detail = detailFin;
    activite.erreur = erreur;
    historique.unshift(activite);
    if (historique.length > MAX_HISTORIQUE) historique.length = MAX_HISTORIQUE;
    notifier();
  };

  return {
    progression: (fait: number, total?: number) => {
      activite.fait = fait;
      if (total !== undefined) activite.total = total;
      notifier();
    },
    fin: (detailFin?: string) => clore(false, detailFin),
    echec: (detailFin?: string) => clore(true, detailFin),
  };
}

/** Consigne un événement ponctuel déjà terminé (durée connue après coup). */
export function activiteNote(
  label: string,
  famille: ActiviteNavigateur['famille'],
  dureeMs: number,
  detail?: string,
): void {
  installerObserver();
  const now = Date.now();
  historique.unshift({
    id: `a${++compteur}`, label, famille,
    demarreA: now - dureeMs, termineA: now, dureeMs, detail,
  });
  if (historique.length > MAX_HISTORIQUE) historique.length = MAX_HISTORIQUE;
  notifier();
}

export function activitesEnCours(): ActiviteNavigateur[] {
  return Array.from(enCours.values());
}

export function activitesHistorique(): ActiviteNavigateur[] {
  return historique.slice();
}

export function longTasksInfo(): LongTaskInfo {
  const now = typeof performance !== 'undefined' ? performance.now() : 0;
  const limite = now - 60_000;
  let n = 0;
  let ms = 0;
  for (const t of longTasks) {
    if (t.at >= limite) { n++; ms += t.dureeMs; }
  }
  return { derniereMinute: n, msBloquesDerniereMinute: Math.round(ms), pireMs: Math.round(pireLongTaskMs) };
}

/** Mémoire JS du moteur (Chrome/Edge) — null ailleurs. */
export function memoireJs(): { usedMB: number; limitMB: number } | null {
  const perf = typeof performance !== 'undefined'
    ? (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } })
    : undefined;
  if (!perf?.memory) return null;
  return {
    usedMB: Math.round(perf.memory.usedJSHeapSize / (1024 * 1024)),
    limitMB: Math.round(perf.memory.jsHeapSizeLimit / (1024 * 1024)),
  };
}

/** S'abonner aux changements (le panneau du moniteur). Rend le désabonnement. */
export function surChangement(cb: () => void): () => void {
  installerObserver();
  abonnes.add(cb);
  return () => { abonnes.delete(cb); };
}
