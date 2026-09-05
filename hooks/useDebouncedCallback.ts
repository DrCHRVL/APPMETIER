import { useRef, useEffect, useMemo } from 'react';
import debounce from 'lodash/debounce';

/**
 * Hook qui crée un callback déboncé stable.
 * Le callback interne est toujours à jour (via ref) sans recréer le debounce.
 *
 * Usage :
 *   const debouncedSave = useDebouncedCallback((value: string) => {
 *     onUpdate({ description: value });
 *   }, 400);
 */
export function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): T & { cancel: () => void; flush: () => void } {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  // Recréé uniquement quand `delay` change : un délai constant (cas courant)
  // conserve la même instance d'un rendu à l'autre, mais un délai dynamique
  // n'est plus figé sur sa valeur initiale. L'ancienne instance est flushée
  // par le nettoyage d'effet ci-dessous lorsqu'elle est remplacée.
  const debouncedFn = useMemo(
    () => debounce((...args: any[]) => callbackRef.current(...args), delay),
    [delay]
  );

  useEffect(() => {
    return () => {
      // Flush plutôt que cancel : on évite de perdre la dernière frappe
      // quand l'utilisateur ferme la modale avant la fin du délai.
      debouncedFn.flush();
    };
  }, [debouncedFn]);

  return debouncedFn as any;
}
