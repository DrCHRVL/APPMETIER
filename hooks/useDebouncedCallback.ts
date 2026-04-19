import { useRef, useEffect } from 'react';
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

  const debouncedFn = useRef(
    debounce((...args: any[]) => callbackRef.current(...args), delay)
  ).current;

  useEffect(() => {
    return () => {
      // Flush plutôt que cancel : on évite de perdre la dernière frappe
      // quand l'utilisateur ferme la modale avant la fin du délai.
      debouncedFn.flush();
    };
  }, [debouncedFn]);

  return debouncedFn as any;
}
