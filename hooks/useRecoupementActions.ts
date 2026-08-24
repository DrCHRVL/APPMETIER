// hooks/useRecoupementActions.ts
//
// Les SUITES qu'on peut donner à un signal de recoupement, sans quitter la
// veille : tracer le lien de renseignement qui manque sur la cartographie.
//
// Deux garde-fous, parce qu'un graphe pollué ne se nettoie pas :
//   - on ne crée jamais un lien qui existe déjà (le calcul des propositions
//     l'a déjà retranché, et le store refuse le doublon exact) ;
//   - on écrit sur le disque tout de suite (la cartographie, elle, ne flush
//     qu'à la fermeture du module : ici il n'y a pas de fermeture).

import { useCallback, useEffect } from 'react';
import { useCartographieOverlayStore } from '@/stores/useCartographieOverlayStore';
import { useToastStore } from '@/stores/useToastStore';
import { trouverLien, type LienExistant, type PropositionLien } from '@/utils/recoupements/liens';

export interface RecoupementActionsApi {
  /** Liens de renseignement existants — sert à ne rien proposer en double. */
  liens: LienExistant[];
  /** Trace le lien proposé. Sans effet s'il a déjà été tracé entre-temps. */
  creerLien: (proposition: PropositionLien) => void;
}

export function useRecoupementActions(): RecoupementActionsApi {
  const liens = useCartographieOverlayStore(s => s.liensRenseignement);
  const isLoaded = useCartographieOverlayStore(s => s.isLoaded);
  const load = useCartographieOverlayStore(s => s.load);
  const addLien = useCartographieOverlayStore(s => s.addLien);
  const showToast = useToastStore(s => s.showToast);

  // La surcouche de cartographie porte les liens déjà tracés : sans elle, la
  // veille proposerait de refaire ce qui existe.
  useEffect(() => { if (!isLoaded) void load(); }, [isLoaded, load]);

  const creerLien = useCallback((proposition: PropositionLien) => {
    const etat = useCartographieOverlayStore.getState();
    const deja = trouverLien(etat.liensRenseignement, proposition.source, proposition.target);
    if (deja) {
      showToast('Ces deux éléments sont déjà reliés sur la cartographie', 'info');
      return;
    }
    const id = addLien({
      source: proposition.source,
      target: proposition.target,
      label: proposition.label,
      notes: proposition.notes,
    });
    if (!id) {
      showToast('Lien impossible à créer', 'error');
      return;
    }
    // Écriture immédiate : on ne compte pas sur la fermeture du module carto.
    void useCartographieOverlayStore.getState().flush();
    showToast(`Lien de renseignement créé — « ${proposition.label} »`, 'success');
  }, [addLien, showToast]);

  return { liens, creerLien };
}
