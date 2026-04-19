/**
 * Shim zustand API-compatible — fonctionne sans le package npm.
 * Quand zustand est installé (npm install zustand), remplacer les imports
 * `from '@/lib/zustand'` par `from 'zustand'`.
 *
 * Supporte : create(), selectors granulaires, getState(), setState(), subscribe().
 * Utilise useSyncExternalStore (React 18+) pour la concurrence.
 */

import { useSyncExternalStore, useRef, useCallback } from 'react';

type SetState<T> = {
  (partial: Partial<T> | ((state: T) => Partial<T>)): void;
  (fn: (state: T) => Partial<T>): void;
};
type GetState<T> = () => T;

export type StateCreator<T> = (
  set: SetState<T>,
  get: GetState<T>,
  api: StoreApi<T>
) => T;

export interface StoreApi<T> {
  getState: GetState<T>;
  setState: SetState<T>;
  subscribe: (listener: () => void) => () => void;
}

function createStore<T extends object>(initializer: StateCreator<T>): StoreApi<T> {
  let state: T;
  const listeners = new Set<() => void>();

  const getState: GetState<T> = () => state;

  const setState: SetState<T> = (partial: any) => {
    const nextPartial = typeof partial === 'function' ? partial(state) : partial;
    const nextState = { ...state, ...nextPartial };
    if (!Object.is(state, nextState)) {
      state = nextState;
      listeners.forEach((l) => l());
    }
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const api: StoreApi<T> = { getState, setState, subscribe };
  state = initializer(setState, getState, api);

  return api;
}

/**
 * Crée un hook zustand avec support de selectors granulaires.
 *
 * Usage :
 *   const useStore = create((set, get) => ({ count: 0, inc: () => set({ count: get().count + 1 }) }))
 *   const count = useStore(s => s.count)       // re-rend seulement quand count change
 *   const state = useStore()                    // re-rend à chaque changement
 *   useStore.getState()                         // lecture hors React
 *   useStore.setState({ count: 5 })             // écriture hors React
 */
export function create<T extends object>(initializer: StateCreator<T>) {
  const api = createStore(initializer);

  // Hook principal avec support selector
  function useStore(): T;
  function useStore<U>(selector: (state: T) => U): U;
  function useStore<U>(selector?: (state: T) => U): T | U {
    const selectorRef = useRef(selector);
    selectorRef.current = selector;

    const lastSnapshotRef = useRef<T>(api.getState());
    const lastSelectionRef = useRef<any>(
      selector ? selector(api.getState()) : api.getState()
    );

    const getSelection = useCallback(() => {
      const state = api.getState();
      const sel = selectorRef.current;

      if (!sel) return state;

      // Si le state n'a pas changé, retourner la sélection en cache
      if (Object.is(lastSnapshotRef.current, state)) {
        return lastSelectionRef.current;
      }

      const nextSelection = sel(state);

      // Si la sélection n'a pas changé, retourner la sélection en cache
      if (Object.is(lastSelectionRef.current, nextSelection)) {
        lastSnapshotRef.current = state;
        return lastSelectionRef.current;
      }

      lastSnapshotRef.current = state;
      lastSelectionRef.current = nextSelection;
      return nextSelection;
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return useSyncExternalStore(api.subscribe, getSelection, getSelection);
  }

  // API statique
  useStore.getState = api.getState;
  useStore.setState = api.setState;
  useStore.subscribe = api.subscribe;

  return useStore as typeof useStore & StoreApi<T>;
}
