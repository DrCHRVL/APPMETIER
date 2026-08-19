// hooks/useInstructionStats.ts
//
// Statistiques agrégées du module instruction. Calque du pattern
// `useActeStats` : la LOGIQUE vit dans le module PARTAGÉ
// lib/stats/instructionCore.mjs — source unique, également consommée par le
// connecteur Claude web (outil `stats_ecran`) pour servir à l'agent les
// chiffres EXACTS de l'onglet « Statistiques instruction ». Ce hook n'apporte
// que le typage et la mémoïsation React.

import { useMemo } from 'react';
import type { DossierInstruction } from '@/types/instructionTypes';
import {
  computeInstructionStats,
  DELAI_REGLEMENT_175_DETENU_JOURS as DELAI_175,
} from '@/lib/stats/instructionCore.mjs';

/** Délai (en jours) entre 175 rendu et règlement pour un détenu (art. 175 CPP). */
export const DELAI_REGLEMENT_175_DETENU_JOURS: number = DELAI_175;

export interface InstructionStats {
  // Volume / état du stock
  nbDossiers: number;
  nbDossiersActifs: number;
  nbDossiersArchives: number;
  nbDossiersAuReglement: number;
  nbDossiers175Recu: number;
  nbDossiersReqDef: number;
  nbDossiersOrdonnance: number;

  // Mis en examen
  nbMisEnExamen: number;
  nbDetenus: number;
  nbCJ: number;
  nbARSE: number;
  nbLibres: number;

  // Âge des dossiers (en jours)
  ageMoyenDossiersActifs: number;
  ageMaxDossierActif: number;
  ageMoyenAuReglement: number;

  // DML
  nbDmlTotal: number;
  nbDmlEnAttente: number;
  dmlMoyenParDossier: number;

  // Cotes
  cotesMoyennes: number;
  cotesTotal: number;

  // Dossiers à régler (175 rendu, échéance 1 mois si détenu)
  dossiersARegler: {
    total: number;
    avecDetenu: number;
    urgents: Array<{
      dossierId: number;
      numeroInstruction: string;
      date175: string;
      dateEcheance: string;
      joursRestants: number;
      /** true si la date du 175 n'est pas connue précisément (repli sur la
       *  dernière modification du dossier) : l'échéance est approximative. */
      approx: boolean;
    }>;
  };

  // Âge moyen pour clôturer un dossier par cabinet, pondéré par nb de MEX
  ageMoyenClotureParCabinet: Record<
    string,
    { ageMoyenJours: number; agePondereParMexJours: number; nbDossiers: number; nbMexTotal: number }
  >;
}

export function useInstructionStats(dossiers: DossierInstruction[]): InstructionStats {
  return useMemo(() => computeInstructionStats(dossiers) as InstructionStats, [dossiers]);
}
