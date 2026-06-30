// stores/useCartographieContributionsStore.ts
//
// État mémoire des contributions cartographie de l'équipe, rapatriées du
// serveur commun (`cartographie-contributions.json`) par
// CartographieContributionsSyncService.
//
// Contenu : la projection minimale (cf. CartoContributionSource) des dossiers
// de TOUS les autres utilisateurs, déjà convertie en `EnqueteWithContext` prête
// à être fusionnée avec les sources locales par le module Cartographie. On
// exclut volontairement la contribution de l'utilisateur courant : ses propres
// dossiers sont déjà présents dans les sources locales, les ré-injecter ferait
// double emploi (et créerait des doublons de nœuds).

import { create } from 'zustand';
import type { EnqueteWithContext } from '@/utils/mindmapGraph';

interface CartographieContributionsState {
  /** Sources distantes (collègues), projetées et prêtes à fusionner. */
  remoteSources: EnqueteWithContext[];
  /** Vrai après le premier pull serveur réussi (même vide). */
  loaded: boolean;
  /** Remplace l'agrégat distant (appelé par le service après chaque merge). */
  setRemoteSources: (sources: EnqueteWithContext[]) => void;
}

export const useCartographieContributionsStore = create<CartographieContributionsState>((set) => ({
  remoteSources: [],
  loaded: false,
  setRemoteSources: (remoteSources) => set({ remoteSources, loaded: true }),
}));
