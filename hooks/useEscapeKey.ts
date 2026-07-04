'use client';

import { useEffect } from 'react';

/**
 * Ferme une surcouche (modale « maison » bâtie sur un overlay `fixed inset-0`)
 * à l'appui sur Échap, pour aligner leur comportement sur les modales Radix
 * (`ui/dialog`) qui, elles, ferment déjà sur Échap.
 *
 * - `enabled` : n'écoute que lorsque la modale est ouverte.
 * - Un seul écouteur global au niveau document, retiré au démontage.
 */
export function useEscapeKey(onEscape: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onEscape, enabled]);
}
