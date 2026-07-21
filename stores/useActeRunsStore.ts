/**
 * useActeRunsStore — suivi DURABLE des retouches / réécritures IA d'un acte.
 *
 * Problème résolu : quand le magistrat demande à l'IA de retoucher un acte
 * (« Actes rédigés » → « Demander à l'IA »), le run tourne côté service
 * attaché et s'y termine, MÊME s'il quitte l'enquête ou recharge la page (le
 * flux HTTP n'est qu'un canal d'affichage). Mais l'indicateur « modification
 * en cours » vivait dans l'état React de la section : il disparaissait à la
 * navigation, alors que le travail continuait. Résultat : plus aucune trace,
 * l'acte semblait figé — alors qu'il changeait bien en arrière-plan.
 *
 * Ce store porte l'état « en cours » HORS du composant, persisté dans
 * localStorage : il survit à la fermeture de l'enquête et au rechargement.
 * Un watcher global (ActeRunsWatcher) sonde ensuite les actes, détecte la fin
 * (l'`updatedAt` de l'acte a changé) et émet un toast — « Enquête X : acte
 * retouché » — même si le magistrat est parti voir un autre dossier.
 *
 * Aucun contenu chiffré ne transite ici : on ne stocke que des métadonnées
 * (numéro de dossier, id d'acte, titre, horodatages).
 */
import { create } from '@/lib/zustand';

export type ActeRunKind = 'retouche' | 'redo-mail' | 'redo-instruction';

export interface ActeRun {
  /** Numéro du dossier (enquête ou instruction) portant l'acte. */
  numero: string;
  /** Id de la production (acte) retouchée. */
  prodId: string;
  /** Titre de l'acte au moment du lancement — pour le libellé du toast. */
  titre: string;
  /** Nature du run : retouche ciblée ou réécriture de zéro. */
  kind: ActeRunKind;
  /** Date.now() au lancement — sert au filet anti-run-fantôme. */
  startedAt: number;
  /** `updatedAt` de l'acte AVANT le run : la fin se détecte quand il change. */
  prevUpdatedAt?: string;
}

const STORAGE_KEY = 'siral_attache_acte_runs';
/** Un run non conclu au-delà de ce délai est considéré perdu (service maxDuration ~30 min). */
export const RUN_MAX_AGE_MS = 32 * 60 * 1000;

export function runKey(numero: string, prodId: string): string {
  return `${numero}::${prodId}`;
}

/** Libellé unique du toast de fin — partagé entre la section et le watcher. */
export function acteDoneToastMessage(numero: string, titre: string, kind: ActeRunKind): string {
  const verbe = kind === 'retouche' ? 'retouché' : 'réécrit';
  return `Enquête ${numero} — « ${titre} » ${verbe} par l'IA. Relisez l'acte.`;
}

function readStored(): Record<string, ActeRun> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, ActeRun>;
    if (!parsed || typeof parsed !== 'object') return {};
    // Purge des runs manifestement périmés (app tuée avant la clôture).
    const now = Date.now();
    const out: Record<string, ActeRun> = {};
    for (const [k, r] of Object.entries(parsed)) {
      if (r && typeof r.startedAt === 'number' && now - r.startedAt < RUN_MAX_AGE_MS) out[k] = r;
    }
    return out;
  } catch {
    return {};
  }
}

function persist(runs: Record<string, ActeRun>): void {
  if (typeof window === 'undefined') return;
  try {
    if (Object.keys(runs).length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(runs));
  } catch {
    /* quota / mode privé : l'indicateur restera simplement local à la session */
  }
}

interface ActeRunsState {
  runs: Record<string, ActeRun>;
  hydrated: boolean;
  /** Relit localStorage (appelé une fois au montage du watcher, côté client). */
  hydrate: () => void;
  /** Enregistre un run en cours (remplace un éventuel run précédent du même acte). */
  startRun: (run: ActeRun) => void;
  /** Clôt le run d'un acte (fin détectée, échec, ou nettoyage). */
  finishRun: (numero: string, prodId: string) => void;
}

export const useActeRunsStore = create<ActeRunsState>((set, get) => ({
  runs: {},
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    set({ runs: readStored(), hydrated: true });
  },

  startRun: (run: ActeRun) => {
    const runs = { ...get().runs, [runKey(run.numero, run.prodId)]: run };
    persist(runs);
    set({ runs });
  },

  finishRun: (numero: string, prodId: string) => {
    const key = runKey(numero, prodId);
    if (!get().runs[key]) return;
    const runs = { ...get().runs };
    delete runs[key];
    persist(runs);
    set({ runs });
  },
}));
