/**
 * useOcrJobsStore — gestionnaire des tâches OCR du convertisseur PDF → texte.
 *
 * « Océriser » transforme un lot converti en TÂCHE : elle vit ici, hors de la
 * page, pour toute la session SIRAL — changer de module ne l'interrompt pas.
 * Les tâches passent une par une (file) ; dans une tâche, deux PDF avancent de
 * front pour que le service n'attende jamais un envoi. Chaque tâche garde ses
 * résultats : son ZIP se télécharge à tout moment avec ce qui est déjà lu.
 * Fermer ou recharger l'onglet, en revanche, perdrait les tâches : on prévient.
 */
import { create } from '@/lib/zustand';
import { useToastStore } from '@/stores/useToastStore';
import {
  chargeOcr, construireLivrables, ocriser, pagesImages, paquetLivrables, SECONDES_PAR_PAGE,
  type ChargeOcr, type ModeGlobal, type ResultatPdf, type SourcePdf,
} from '@/lib/web/convertisseurPdf';

export type StatutFichier = 'attente' | 'encours' | 'fait' | 'partiel' | 'echec';
export interface FichierOcr { chemin: string; pages: number; faites: number; statut: StatutFichier; erreur?: string }

export type StatutTache = 'attente' | 'encours' | 'terminee' | 'arretee';
export interface TacheOcr {
  id: string;
  nom: string;
  creee: number;
  debut?: number;
  fin?: number;
  statut: StatutTache;
  fichiers: FichierOcr[];
  total: number;
  faites: number;
  /** Lot complet (PDF océrisés ou non) : de quoi refaire le ZIP à tout moment. */
  resultats: ResultatPdf[];
  config: { mode: ModeGlobal; niveau: number; individuels: boolean };
}

interface OcrJobsState {
  taches: TacheOcr[];
  service: ChargeOcr | null;
  /** Vitesse mesurée sur cette session (s/page), sinon l'estimation par défaut. */
  secondesParPage: number;
  lancer: (p: { nom: string; resultats: ResultatPdf[]; sources: SourcePdf[]; config: TacheOcr['config'] }) => void;
  arreter: (id: string) => void;
  retirer: (id: string) => void;
  telecharger: (id: string) => Promise<void>;
  sonder: () => Promise<void>;
}

/** Hors état réactif : fichiers sources et drapeaux d'arrêt. */
const sources = new Map<string, Map<string, SourcePdf>>();
const arrets = new Set<string>();
/** Débit réel : pages lues / temps écoulé pendant qu'une tâche tourne (tous PDF de front confondus). */
const mesure = { pages: 0, ms: 0, dernier: 0 };
const PDF_DE_FRONT = 2;

export const useOcrJobsStore = create<OcrJobsState>((set, get) => {
  const maj = (id: string, f: (t: TacheOcr) => TacheOcr) =>
    set({ taches: get().taches.map(t => (t.id === id ? f(t) : t)) });

  async function executer(id: string) {
    const src = sources.get(id)!;
    maj(id, t => ({ ...t, statut: 'encours', debut: Date.now() }));
    mesure.dernier = Date.now();
    const file = get().taches.find(t => t.id === id)!.fichiers.map(f => f.chemin);
    let echecs = 0;
    const ouvrier = async () => {
      for (let chemin = file.shift(); chemin && !arrets.has(id); chemin = file.shift()) {
        const c = chemin;
        const r = get().taches.find(t => t.id === id)!.resultats.find(x => x.chemin === c)!;
        maj(id, t => ({ ...t, fichiers: t.fichiers.map(f => (f.chemin === c ? { ...f, statut: 'encours' } : f)) }));
        try {
          const lu = await ocriser(src.get(c)!, r, n => {
            const maintenant = Date.now();
            mesure.pages += n; mesure.ms += maintenant - mesure.dernier; mesure.dernier = maintenant;
            if (mesure.pages >= 10) set({ secondesParPage: mesure.ms / 1000 / mesure.pages });
            maj(id, t => ({
              ...t, faites: t.faites + n,
              fichiers: t.fichiers.map(f => (f.chemin === c ? { ...f, faites: f.faites + n } : f)),
            }));
          }, () => arrets.has(id));
          maj(id, t => ({
            ...t,
            resultats: t.resultats.map(x => (x.chemin === c ? lu : x)),
            fichiers: t.fichiers.map(f => (f.chemin === c ? { ...f, statut: lu.ocr === 'complet' ? 'fait' : 'partiel' } : f)),
          }));
        } catch (e) {
          echecs++;
          const erreur = e instanceof Error ? e.message : String(e);
          maj(id, t => ({ ...t, fichiers: t.fichiers.map(f => (f.chemin === c ? { ...f, statut: 'echec', erreur } : f)) }));
        }
      }
    };
    await Promise.all(Array.from({ length: PDF_DE_FRONT }, ouvrier));
    const arretee = arrets.has(id);
    arrets.delete(id);
    sources.delete(id); // les originaux ne servent plus : la mémoire est rendue
    maj(id, t => ({
      ...t, statut: arretee ? 'arretee' : 'terminee', fin: Date.now(),
      // un PDF interrompu en cours de lecture est incomplet ; ceux jamais commencés restent « en attente » (non lancés)
      fichiers: t.fichiers.map(f => (f.statut === 'encours' ? { ...f, statut: 'partiel' } : f)),
    }));
    const t = get().taches.find(x => x.id === id);
    if (t && !arretee) {
      useToastStore.getState().showToast(
        `OCR terminé : ${t.nom}${echecs ? ` · ${echecs} PDF en échec` : ''} — à télécharger dans « PDF → texte »`,
        echecs ? 'warning' : 'success',
      );
    }
  }

  let pompeEnCours = false;
  async function pompe() {
    if (pompeEnCours) return;
    pompeEnCours = true;
    garde(true);
    try {
      for (let t = prochaine(); t; t = prochaine()) await executer(t.id);
    } finally {
      pompeEnCours = false;
      garde(false);
    }
  }
  const prochaine = () => get().taches.find(t => t.statut === 'attente');

  // Sonde de charge toutes les 5 s tant qu'une tâche tourne.
  let minuteur: ReturnType<typeof setInterval> | null = null;
  const prevenir = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
  function garde(actif: boolean) {
    if (typeof window === 'undefined') return;
    if (actif && !minuteur) {
      window.addEventListener('beforeunload', prevenir);
      minuteur = setInterval(() => { get().sonder(); }, 5000);
    } else if (!actif && minuteur) {
      window.removeEventListener('beforeunload', prevenir);
      clearInterval(minuteur); minuteur = null;
      get().sonder();
    }
  }

  return {
    taches: [],
    service: null,
    secondesParPage: SECONDES_PAR_PAGE,

    lancer: ({ nom, resultats, sources: srcs, config }) => {
      const fichiers: FichierOcr[] = resultats
        .filter(r => !r.erreur && !r.ocr)
        .map(r => ({ chemin: r.chemin, pages: pagesImages(r.texte).length, faites: 0, statut: 'attente' as const }))
        .filter(f => f.pages > 0);
      if (!fichiers.length) return;
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const utiles = new Set(fichiers.map(f => f.chemin));
      sources.set(id, new Map(srcs.filter(s => utiles.has(s.chemin)).map(s => [s.chemin, s])));
      const tache: TacheOcr = {
        id, nom, creee: Date.now(), statut: 'attente', fichiers,
        total: fichiers.reduce((n, f) => n + f.pages, 0), faites: 0, resultats, config,
      };
      set({ taches: [...get().taches, tache] });
      pompe();
    },

    arreter: (id) => {
      const t = get().taches.find(x => x.id === id);
      if (!t) return;
      if (t.statut === 'encours') { arrets.add(id); return; } // s'arrête après le lot en cours
      if (t.statut === 'attente') {
        sources.delete(id);
        maj(id, x => ({ ...x, statut: 'arretee', fin: Date.now() }));
      }
    },

    retirer: (id) => {
      const t = get().taches.find(x => x.id === id);
      if (!t || t.statut === 'encours') return;
      sources.delete(id);
      set({ taches: get().taches.filter(x => x.id !== id) });
    },

    telecharger: async (id) => {
      const t = get().taches.find(x => x.id === id);
      if (!t) return;
      const l = construireLivrables(t.resultats, t.config.mode, t.config.niveau, t.config.individuels);
      const { blob, nom } = await paquetLivrables(l, t.resultats.map(r => r.chemin));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = nom; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    },

    sonder: async () => { set({ service: await chargeOcr() }); },
  };
});

/** Pages restant à lire avant la fin de cette tâche, file d'attente comprise. */
export function pagesAvantFin(taches: TacheOcr[], id: string): number {
  let n = 0;
  for (const t of taches) {
    if (t.statut === 'attente' || t.statut === 'encours') n += t.total - t.faites;
    if (t.id === id) return n;
  }
  return n;
}
