// hooks/useEntraideAlertes.ts
//
// Veille du module Entraide, montée au niveau de l'application : active la
// synchronisation du registre partagé, compte les échéances dépassées (pastille
// de la barre latérale) et programme les rappels push des dossiers du
// magistrat connecté (ou sans magistrat désigné). Expose aussi les demandes
// pour la recherche globale.

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { entraideSyncService, ENTRAIDE_VIDE } from '@/utils/dataSync/EntraideSyncService';
import { aujourdhui, etatDemande } from '@/utils/entraide/logique';
import { updatePushSchedule } from '@/lib/web/pushReminders';
import type { DemandeEntraide } from '@/types/entraideTypes';

const subscribe = (fn: () => void) => entraideSyncService.subscribe(fn);
const getData = () => entraideSyncService.getData();
const getServerData = () => ENTRAIDE_VIDE;

export function useEntraideAlertes(enabled: boolean, moi: string): { retards: number; demandes: DemandeEntraide[] } {
  useEffect(() => { entraideSyncService.configure(enabled); }, [enabled]);
  const data = useSyncExternalStore(subscribe, getData, getServerData);
  const jour = aujourdhui();

  const { retards, mesEcheances } = useMemo(() => {
    if (!enabled) return { retards: 0, mesEcheances: [] as Array<{ deadline: string }> };
    let n = 0;
    const mes: Array<{ deadline: string }> = [];
    const m = moi.toLowerCase();
    for (const d of data.demandes) {
      const e = etatDemande(d, jour);
      if (e.niveau === 'retard') n++;
      if (e.prochaineDate && (!d.magistrat || d.magistrat.toLowerCase() === m)) mes.push({ deadline: e.prochaineDate });
    }
    return { retards: n, mesEcheances: mes };
  }, [enabled, data.demandes, jour, moi]);

  useEffect(() => {
    if (enabled) updatePushSchedule('entraide', mesEcheances);
  }, [enabled, mesEcheances]);

  return { retards, demandes: data.demandes };
}
