import { useEffect, useState } from 'react';

/**
 * Retourne `true` quand le viewport est de taille « mobile » (≤ 640px par
 * défaut, soit le breakpoint `sm` de Tailwind). SSR-safe : renvoie `false`
 * au premier rendu serveur puis se synchronise côté client après montage.
 */
export function useIsMobile(maxWidth = 640): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [maxWidth]);

  return isMobile;
}
