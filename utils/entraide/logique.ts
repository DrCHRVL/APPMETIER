// utils/entraide/logique.ts
//
// Façade typée de la logique partagée du module Entraide
// (lib/entraide/core.mjs et lib/entraide/referentiels.mjs, consommés tels
// quels par le connecteur Claude web).

import * as core from '@/lib/entraide/core.mjs';
import * as refs from '@/lib/entraide/referentiels.mjs';
import type {
  AutoriteEtrangere,
  DemandeEntraide,
  EntraideAction,
  EntraideDocId,
  EntraideDrapeau,
  EntraideEtat,
  EntraideEvenementType,
  EntraideIssue,
  EntraideLangue,
  EntraideType,
  ServiceEnqueteur,
} from '@/types/entraideTypes';

export const DELAIS = core.DELAIS;
export const delaisDe = core.delaisDe as (d: DemandeEntraide) => typeof core.DELAIS & { enqueteursMois: number; emiseMois: number; relanceMois: number; procheJours: number };
export const DRAPEAU_LABELS = core.DRAPEAU_LABELS as Record<EntraideDrapeau, string>;
export const ISSUE_LABELS = core.ISSUE_LABELS as Record<EntraideIssue, string>;
export const TYPE_LABELS = core.TYPE_LABELS as Record<EntraideType, string>;
export const TYPE_COURTS = core.TYPE_COURTS as Record<EntraideType, string>;
export const SENS_LABELS = core.SENS_LABELS as Record<'recue' | 'emise', string>;
export const DOC_LABELS = core.DOC_LABELS as Record<EntraideDocId, string>;
export const ENVOI_PAR_DOC = core.ENVOI_PAR_DOC as Record<EntraideDocId, EntraideEvenementType>;
export const ETAPE_LABELS = core.ETAPE_LABELS as Record<string, string>;
export const EVENEMENT_LABELS = core.EVENEMENT_LABELS as Record<EntraideEvenementType, string>;

export const aujourdhui = core.aujourdhui as (maintenant?: Date) => string;
export const ajouterMois = core.ajouterMois as (iso: string, n: number) => string | null;
export const ajouterJours = core.ajouterJours as (iso: string, n: number) => string | null;
export const joursEntre = core.joursEntre as (de: string, a: string) => number | null;
export const dateDepart = core.dateDepart as (d: DemandeEntraide) => string | null;
export const dateFr = core.dateFr as (iso?: string | null) => string;
export const estDate = core.estDate as (iso?: string | null) => boolean;
export const etatDemande = core.etatDemande as (d: DemandeEntraide, jour?: string) => EntraideEtat;
export const cleUrgence = core.cleUrgence as (etat: EntraideEtat) => number;
export const prochainesActions = core.prochainesActions as (d: DemandeEntraide, etat: EntraideEtat) => EntraideAction[];
export const normaliser = core.normaliser as (s?: string | null) => string;
export const texteRecherche = core.texteRecherche as (d: DemandeEntraide, extra?: string) => string;
export const chercherAutorites = core.chercherAutorites as (
  autorites: AutoriteEtrangere[], requete: string, pays?: string,
) => AutoriteEtrangere[];
export const apprendreMotsCles = core.apprendreMotsCles as (a: AutoriteEtrangere, requete: string) => string[];

export interface PaysEntraide { nom: string; adj: string; langue: EntraideLangue; ue: boolean; en: string }
export interface MesureEntraide {
  id: string; famille: string; libelle: string; synonymes: string[]; texte: string; juge?: boolean;
}
export interface ServiceDepart { id: string; libelle: string; cases: string[] }

export const PAYS = refs.PAYS as PaysEntraide[];
export const paysDe = refs.paysDe as (nom?: string | null) => PaysEntraide | null;
export const autoritesJudiciairesDe = refs.autoritesJudiciairesDe as (pays?: string | null) => string;
export const CASES_TRAME = refs.CASES_TRAME as string[];
export const SERVICES_DEPART = refs.SERVICES_DEPART as ServiceDepart[];
export const migrerServices = refs.migrerServices as (
  services: ServiceEnqueteur[], demandes: DemandeEntraide[],
) => { services: Array<ServiceEnqueteur & { modifie?: boolean }>; supprimes: string[] } | null;
export const FAMILLES_MESURES = refs.FAMILLES_MESURES as Record<string, string>;
export const MESURES = refs.MESURES as MesureEntraide[];
export const chercherMesures = refs.chercherMesures as (requete: string, frequences?: Record<string, number>) => MesureEntraide[];
export const lignesMesures = refs.lignesMesures as (mesures?: string[], personnes?: string) => string[];
