// hooks/useVeillePause.ts
//
// Lecture réactive de la suspension de la veille de recoupements (cf.
// lib/monitor/veillePause). Le rendu serveur ne connaît pas le stockage local :
// il part toujours de « la veille tourne », l'hydratation rétablit le choix.

import { useSyncExternalStore } from 'react';
import { surChangementVeille, veilleSuspendue } from '@/lib/monitor/veillePause';

export function useVeillePause(): boolean {
  return useSyncExternalStore(surChangementVeille, veilleSuspendue, () => false);
}
