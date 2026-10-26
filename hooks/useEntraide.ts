// hooks/useEntraide.ts
//
// Accès React au registre partagé du module Entraide internationale
// (utils/dataSync/EntraideSyncService.ts) et à ses écritures. Chaque écriture
// bumpe `dateMiseAJour` (contrat de fusion) et part au serveur après un court
// délai.

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { entraideSyncService, ENTRAIDE_VIDE } from '@/utils/dataSync/EntraideSyncService';
import { apprendreMotsCles, aujourdhui } from '@/utils/entraide/logique';
import { useUserStore } from '@/stores/useUserStore';
import type {
  AutoriteEtrangere,
  DemandeEntraide,
  EntraideData,
  EntraideEvenement,
  ServiceEnqueteur,
  SignataireEntraide,
} from '@/types/entraideTypes';

export function nouvelId(prefixe = ''): string {
  return `${prefixe}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

const subscribe = (fn: () => void) => entraideSyncService.subscribe(fn);
const getData = () => entraideSyncService.getData();
const getStatut = () => entraideSyncService.getStatut();
const getServerData = () => ENTRAIDE_VIDE;
const STATUT_SERVEUR = { charge: false, enLigne: false, derniereSynchro: null, erreur: null };
const getServerStatut = () => STATUT_SERVEUR;

export type NouvelleDemande = Omit<DemandeEntraide, 'id' | 'evenements' | 'creeLe' | 'dateMiseAJour' | 'creePar'> & {
  evenements?: EntraideEvenement[];
};

export function useEntraide() {
  const data: EntraideData = useSyncExternalStore(subscribe, getData, getServerData);
  const statut = useSyncExternalStore(subscribe, getStatut, getServerStatut);
  const moi = useUserStore((s) => s.user?.windowsUsername || '');

  const majDemande = useCallback((id: string, fn: (d: DemandeEntraide) => DemandeEntraide) =>
    entraideSyncService.modifier((x) => ({
      ...x,
      demandes: x.demandes.map((d) => (d.id === id ? { ...fn(d), dateMiseAJour: new Date().toISOString() } : d)),
    })), []);

  const creerDemande = useCallback(async (n: NouvelleDemande): Promise<string> => {
    const id = nouvelId('d');
    const maintenant = new Date().toISOString();
    const depart: EntraideEvenement = {
      id: nouvelId('e'),
      type: n.sens === 'recue' ? 'reception' : 'enregistrement',
      date: n.dateEnregistrement || aujourdhui(),
      par: moi,
      creeLe: maintenant,
    };
    const d: DemandeEntraide = {
      ...n,
      id,
      evenements: n.evenements?.length ? n.evenements : [depart],
      creePar: moi,
      creeLe: maintenant,
      dateMiseAJour: maintenant,
    };
    await entraideSyncService.modifier((x) => ({ ...x, demandes: [...x.demandes, d] }));
    return id;
  }, [moi]);

  const modifierDemande = useCallback((id: string, patch: Partial<DemandeEntraide>) =>
    majDemande(id, (d) => ({ ...d, ...patch })), [majDemande]);

  const ajouterEvenement = useCallback((id: string, ev: Omit<EntraideEvenement, 'id' | 'creeLe' | 'par'> & { par?: string }) =>
    majDemande(id, (d) => ({
      ...d,
      evenements: [...d.evenements, { ...ev, id: nouvelId('e'), par: ev.par || moi, creeLe: new Date().toISOString() }],
    })), [majDemande, moi]);

  const modifierEvenement = useCallback((id: string, evId: string, patch: Partial<EntraideEvenement>) =>
    majDemande(id, (d) => ({ ...d, evenements: d.evenements.map((e) => (e.id === evId ? { ...e, ...patch } : e)) })), [majDemande]);

  const supprimerEvenement = useCallback((id: string, evId: string) =>
    majDemande(id, (d) => ({ ...d, evenements: d.evenements.filter((e) => e.id !== evId) })), [majDemande]);

  const supprimerDemande = useCallback((id: string) =>
    entraideSyncService.modifier((x) => ({
      ...x,
      demandes: x.demandes.filter((d) => d.id !== id),
      tombstones: [...x.tombstones, { id, deletedAt: new Date().toISOString() }],
    })), []);

  const enregistrerAutorite = useCallback(async (a: Omit<AutoriteEtrangere, 'id' | 'dateMiseAJour'> & { id?: string }): Promise<AutoriteEtrangere> => {
    const fiche: AutoriteEtrangere = { ...a, id: a.id || nouvelId('a'), motsCles: a.motsCles || [], dateMiseAJour: new Date().toISOString() };
    await entraideSyncService.modifier((x) => ({
      ...x,
      autorites: [...x.autorites.filter((y) => y.id !== fiche.id), fiche],
    }));
    return fiche;
  }, []);

  /** Mémorise ce qu'on a tapé pour retrouver cette autorité la prochaine fois. */
  const apprendreAutorite = useCallback((id: string, requete: string) =>
    entraideSyncService.modifier((x) => ({
      ...x,
      autorites: x.autorites.map((a) => {
        if (a.id !== id) return a;
        const motsCles = apprendreMotsCles(a, requete);
        return motsCles === a.motsCles ? a : { ...a, motsCles, dateMiseAJour: new Date().toISOString() };
      }),
    })), []);

  const supprimerAutorite = useCallback((id: string) =>
    entraideSyncService.modifier((x) => ({
      ...x,
      autorites: x.autorites.filter((a) => a.id !== id),
      tombstones: [...x.tombstones, { id, deletedAt: new Date().toISOString() }],
    })), []);

  const enregistrerService = useCallback((s: Omit<ServiceEnqueteur, 'dateMiseAJour'>) =>
    entraideSyncService.modifier((x) => ({
      ...x,
      services: [...x.services.filter((y) => y.id !== s.id), { ...s, dateMiseAJour: new Date().toISOString() }],
    })), []);

  const enregistrerSignataire = useCallback((s: Omit<SignataireEntraide, 'dateMiseAJour'>) =>
    entraideSyncService.modifier((x) => ({
      ...x,
      signataires: [...x.signataires.filter((y) => y.username !== s.username), { ...s, dateMiseAJour: new Date().toISOString() }],
    })), []);

  const index = useMemo(() => ({
    autorite: new Map(data.autorites.map((a) => [a.id, a])),
    service: new Map(data.services.map((s) => [s.id, s])),
    signataire: new Map(data.signataires.map((s) => [s.username.toLowerCase(), s])),
  }), [data.autorites, data.services, data.signataires]);

  return {
    data,
    statut,
    moi,
    index,
    creerDemande,
    modifierDemande,
    ajouterEvenement,
    modifierEvenement,
    supprimerEvenement,
    supprimerDemande,
    enregistrerAutorite,
    apprendreAutorite,
    supprimerAutorite,
    enregistrerService,
    enregistrerSignataire,
    synchroniser: () => entraideSyncService.sync(),
  };
}

export type EntraideApi = ReturnType<typeof useEntraide>;
