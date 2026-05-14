// hooks/useInstructionStats.ts
//
// Statistiques agrégées du module instruction. Calque du pattern
// `useActeStats` : on prend en entrée la liste des dossiers d'un
// contentieux donné et on renvoie une interface InstructionStats
// memoïsée prête à brancher dans les composants de stats.

import { useMemo } from 'react';
import type {
  DossierInstruction,
  MisEnExamen,
  EvenementInstruction,
} from '@/types/instructionTypes';

/** Délai (en jours) entre 175 rendu et règlement pour un détenu (art. 175 CPP). */
export const DELAI_REGLEMENT_175_DETENU_JOURS = 30;

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
    }>;
  };

  // Répartition par type de fait (qualifications des MEX)
  repartitionFaits: Record<string, number>;

  // Âge moyen pour clôturer un dossier par cabinet, pondéré par nb de MEX
  ageMoyenClotureParCabinet: Record<
    string,
    { ageMoyenJours: number; agePondereParMexJours: number; nbDossiers: number; nbMexTotal: number }
  >;
}

const dayDiff = (from: Date, to: Date): number =>
  Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));

const parseDate = (iso: string | undefined): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
};

const isAuReglement = (d: DossierInstruction): boolean =>
  d.etatReglement === '175_recu' || d.etatReglement === 'reqdef_redigees';

const findEvenement175 = (d: DossierInstruction): EvenementInstruction | undefined =>
  (d.evenements || []).find(e => e.type === '175_rendu');

const isDetenuMex = (m: MisEnExamen): boolean => m.mesureSurete?.type === 'detenu';

export function useInstructionStats(dossiers: DossierInstruction[]): InstructionStats {
  return useMemo(() => {
    const now = new Date();

    const actifs = dossiers.filter(d => !d.archived);
    const archives = dossiers.filter(d => !!d.archived);
    const auReglement = actifs.filter(isAuReglement);

    // ── MEX & mesures de sûreté ───────────────────────────────────
    const allMex: MisEnExamen[] = actifs.flatMap(d => d.misEnExamen || []);
    const nbDetenus = allMex.filter(m => m.mesureSurete?.type === 'detenu').length;
    const nbCJ = allMex.filter(m => m.mesureSurete?.type === 'cj').length;
    const nbARSE = allMex.filter(m => m.mesureSurete?.type === 'arse').length;
    const nbLibres = allMex.filter(m => m.mesureSurete?.type === 'libre').length;

    // ── Âge des dossiers (depuis dateOuverture) ───────────────────
    const agesActifs: number[] = [];
    actifs.forEach(d => {
      const dt = parseDate(d.dateOuverture);
      if (dt) agesActifs.push(dayDiff(dt, now));
    });
    const ageMoyenDossiersActifs = agesActifs.length
      ? agesActifs.reduce((a, b) => a + b, 0) / agesActifs.length
      : 0;
    const ageMaxDossierActif = agesActifs.length ? Math.max(...agesActifs) : 0;

    const agesReglement: number[] = [];
    auReglement.forEach(d => {
      const dt = parseDate(d.dateOuverture);
      if (dt) agesReglement.push(dayDiff(dt, now));
    });
    const ageMoyenAuReglement = agesReglement.length
      ? agesReglement.reduce((a, b) => a + b, 0) / agesReglement.length
      : 0;

    // ── DML ───────────────────────────────────────────────────────
    let nbDmlTotal = 0;
    let nbDmlEnAttente = 0;
    actifs.forEach(d => {
      (d.misEnExamen || []).forEach(m => {
        (m.dmls || []).forEach(dml => {
          nbDmlTotal += 1;
          if (dml.statut === 'en_attente') nbDmlEnAttente += 1;
        });
      });
    });
    const dmlMoyenParDossier = actifs.length ? nbDmlTotal / actifs.length : 0;

    // ── Cotes / tomes ─────────────────────────────────────────────
    const cotes = actifs.map(d => d.cotesTomes || 0);
    const cotesTotal = cotes.reduce((a, b) => a + b, 0);
    const cotesMoyennes = cotes.length ? cotesTotal / cotes.length : 0;

    // ── Dossiers à régler (175 rendu) ─────────────────────────────
    const urgents: InstructionStats['dossiersARegler']['urgents'] = [];
    let dossiersAReglerTotal = 0;
    let dossiersAReglerAvecDetenu = 0;
    actifs.forEach(d => {
      const evt = findEvenement175(d);
      const hasFlag = d.etatReglement === '175_recu' || !!evt;
      if (!hasFlag) return;
      dossiersAReglerTotal += 1;
      const aDetenu = (d.misEnExamen || []).some(isDetenuMex);
      if (!aDetenu) return;
      dossiersAReglerAvecDetenu += 1;
      const date175 = parseDate(evt?.date) || parseDate(d.dateMiseAJour);
      if (!date175) return;
      const dateEcheance = new Date(date175);
      dateEcheance.setDate(dateEcheance.getDate() + DELAI_REGLEMENT_175_DETENU_JOURS);
      urgents.push({
        dossierId: d.id,
        numeroInstruction: d.numeroInstruction,
        date175: date175.toISOString(),
        dateEcheance: dateEcheance.toISOString(),
        joursRestants: dayDiff(now, dateEcheance),
      });
    });
    urgents.sort((a, b) => a.joursRestants - b.joursRestants);

    // ── Répartition par type de fait (qualifications) ─────────────
    const repartitionFaits: Record<string, number> = {};
    actifs.forEach(d => {
      const seen = new Set<string>();
      (d.misEnExamen || []).forEach(m => {
        (m.infractions || []).forEach(i => {
          const q = (i.qualification || '').trim();
          if (!q || seen.has(q)) return;
          seen.add(q);
        });
      });
      seen.forEach(q => {
        repartitionFaits[q] = (repartitionFaits[q] || 0) + 1;
      });
    });

    // ── Âge moyen clôture par cabinet (pondéré par nb de MEX) ─────
    const byCabinet: Record<
      string,
      { ages: number[]; mexCounts: number[] }
    > = {};
    archives.forEach(d => {
      const dtOuv = parseDate(d.dateOuverture);
      const dtClos = parseDate(d.dateArchivage) || parseDate(d.dateMiseAJour);
      if (!dtOuv || !dtClos) return;
      const age = dayDiff(dtOuv, dtClos);
      if (age < 0) return;
      const key = d.cabinetId || 'inconnu';
      const nbMex = Math.max(1, (d.misEnExamen || []).length);
      if (!byCabinet[key]) byCabinet[key] = { ages: [], mexCounts: [] };
      byCabinet[key].ages.push(age);
      byCabinet[key].mexCounts.push(nbMex);
    });
    const ageMoyenClotureParCabinet: InstructionStats['ageMoyenClotureParCabinet'] = {};
    Object.entries(byCabinet).forEach(([cab, { ages, mexCounts }]) => {
      const ageMoyenJours = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : 0;
      const totalPondere = ages.reduce((sum, a, i) => sum + a * mexCounts[i], 0);
      const totalMex = mexCounts.reduce((a, b) => a + b, 0);
      const agePondereParMexJours = totalMex ? totalPondere / totalMex : 0;
      ageMoyenClotureParCabinet[cab] = {
        ageMoyenJours,
        agePondereParMexJours,
        nbDossiers: ages.length,
        nbMexTotal: totalMex,
      };
    });

    return {
      nbDossiers: dossiers.length,
      nbDossiersActifs: actifs.length,
      nbDossiersArchives: archives.length,
      nbDossiersAuReglement: auReglement.length,
      nbDossiers175Recu: actifs.filter(d => d.etatReglement === '175_recu').length,
      nbDossiersReqDef: actifs.filter(d => d.etatReglement === 'reqdef_redigees').length,
      nbDossiersOrdonnance: dossiers.filter(d => d.etatReglement === 'ordonnance_rendue').length,

      nbMisEnExamen: allMex.length,
      nbDetenus,
      nbCJ,
      nbARSE,
      nbLibres,

      ageMoyenDossiersActifs,
      ageMaxDossierActif,
      ageMoyenAuReglement,

      nbDmlTotal,
      nbDmlEnAttente,
      dmlMoyenParDossier,

      cotesMoyennes,
      cotesTotal,

      dossiersARegler: {
        total: dossiersAReglerTotal,
        avecDetenu: dossiersAReglerAvecDetenu,
        urgents,
      },

      repartitionFaits,
      ageMoyenClotureParCabinet,
    };
  }, [dossiers]);
}
