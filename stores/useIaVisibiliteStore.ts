/**
 * useIaVisibiliteStore — l'interrupteur « fonctionnalités IA », côté navigateur.
 *
 * Un seul geste, dans Paramètres → Attaché IA, masque TOUT ce qui relève de
 * l'attaché : entrée de menu, page « Assistant de justice », raccourci de la
 * barre du haut, actes rédigés des fiches dossier, chat de dossier, boutons
 * « Détecter les camps (attaché) » et « Enrichir (attaché) » de la
 * cartographie, propositions de renseignement. Seul l'onglet des paramètres
 * demeure — c'est lui qui porte l'interrupteur, le masquer l'enfermerait.
 *
 * Le drapeau est SERVEUR (par tribunal, /api/attache/visibilite) : il suit le
 * magistrat d'un appareil à l'autre. Le localStorage n'en est qu'un cache de
 * premier rendu — sans lui, l'interface montrerait brièvement tout ce que
 * l'interrupteur est censé cacher, le temps de la réponse.
 */
import { create } from '@/lib/zustand';

const CACHE_KEY = 'siral_ia_masquee';

function readCache(): boolean {
  if (typeof window === 'undefined') return false;
  try { return window.localStorage.getItem(CACHE_KEY) === '1'; } catch { return false; }
}

function writeCache(masque: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (masque) window.localStorage.setItem(CACHE_KEY, '1');
    else window.localStorage.removeItem(CACHE_KEY);
  } catch { /* mode privé : le cache de premier rendu se passera de persistance */ }
}

interface IaVisibiliteState {
  /** Vrai = toutes les fonctionnalités IA sont masquées. */
  masque: boolean;
  /** La réponse du serveur est arrivée (avant : valeur de cache). */
  charge: boolean;
  /** Lit le drapeau du serveur (admin uniquement — sinon on n'y touche pas). */
  charger: () => Promise<void>;
  /** Bascule l'interrupteur ; renvoie faux si le serveur a refusé. */
  definir: (masque: boolean) => Promise<boolean>;
}

export const useIaVisibiliteStore = create<IaVisibiliteState>((set, get) => ({
  masque: readCache(),
  charge: false,

  charger: async () => {
    try {
      const res = await fetch('/api/attache/visibilite');
      // 404 : pas administrateur — aucune fonctionnalité IA ne le concerne,
      // on laisse le drapeau tel quel plutôt que d'inventer une valeur.
      if (!res.ok) { set({ charge: true }); return; }
      const { masque } = await res.json();
      writeCache(masque === true);
      set({ masque: masque === true, charge: true });
    } catch {
      set({ charge: true });
    }
  },

  definir: async (masque: boolean) => {
    const avant = get().masque;
    // Optimiste : la bascule doit être instantanée à l'écran.
    writeCache(masque);
    set({ masque });
    try {
      const res = await fetch('/api/attache/visibilite', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ masque }),
      });
      if (!res.ok) throw new Error('refus');
      return true;
    } catch {
      writeCache(avant);
      set({ masque: avant });
      return false;
    }
  },
}));

/** Raccourci de lecture — le seul usage dans la grande majorité des écrans. */
export const useIaMasquee = () => useIaVisibiliteStore((s) => s.masque);
