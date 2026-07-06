import React, { useState } from 'react';
import { Button } from '../ui/button';
import { FileText, Loader2 } from 'lucide-react';
import { useAudience } from '@/hooks/useAudience';
import { useTags } from '@/hooks/useTags';
import { computeActeStats } from '@/hooks/useActeStats';
import { useInfractionNatinf } from '@/hooks/useInfractionNatinf';
import { useInstructionStats } from '@/hooks/useInstructionStats';
import { Enquete } from '@/types/interfaces';
import type { DossierInstruction } from '@/types/instructionTypes';
import { getYearlyStats, getMonthlyStats } from '@/utils/audienceStats';
import { exportStatsPdf, PdfExportData, type PdfExportOptions } from '@/utils/generateStatsPdf';
import { ExportPdfOptionsModal } from '../modals/ExportPdfOptionsModal';
import { UserManager } from '@/utils/userManager';
import { categoryForEntry } from '@/lib/natinf/nataff';

interface ExportPdfButtonProps {
  selectedYear?: number;
  enquetes: Enquete[];
  contentieuxId?: string;
  /** Dossiers d'instruction du périmètre courant (pour refléter la section
   *  « Statistiques instruction » de la page dans le PDF). */
  instructions?: DossierInstruction[];
}

export const ExportPdfButton = ({
  selectedYear = new Date().getFullYear(),
  enquetes,
  contentieuxId,
  instructions,
}: ExportPdfButtonProps) => {
  const [isExporting, setIsExporting] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const { audienceState } = useAudience();
  const { getServicesFromTags } = useTags();
  const { infractionsForEnquete } = useInfractionNatinf();
  // Stats instruction (mêmes calculs que la section à l'écran).
  const instructionStatsRaw = useInstructionStats(instructions || []);

  const handleExportPDF = async (exportOptions: PdfExportOptions = {}) => {
    setIsExporting(true);

    try {
      const allResultats = audienceState?.resultats || {};
      // Pour les vues par contentieux, ne retenir que les résultats du contentieux
      // courant (legacy → crimorg). En vue globale, on garde tout.
      // Même périmètre que l'écran : les résultats standards dont l'enquête a
      // disparu (orphelins conservés par le cleanup) sont exclus — seuls les
      // résultats directs (permanence) passent sans enquête associée.
      const enqueteIds = new Set(enquetes.map(e => e.id));
      const resultats: typeof allResultats = (!contentieuxId || contentieuxId === 'global')
        ? allResultats
        : Object.fromEntries(
            Object.entries(allResultats).filter(([, r]) =>
              (r.contentieuxId || 'crimorg') === contentieuxId
              && (r.isDirectResult === true || enqueteIds.has(r.enqueteId))
            )
          );
      const directResults = Object.values(resultats)
        .filter(r => r.isDirectResult && new Date(r.dateAudience).getFullYear() === selectedYear);

      // --- Calcul des données pour le PDF ---

      // Enquêtes filtrées par année (ouvertures = flux : tous statuts actuels)
      const enquetesForYear = enquetes.filter(e =>
        new Date(e.dateCreation).getFullYear() === selectedYear
      );

      // Enquêtes terminées (par date d'audience)
      const enquetesTerminees = enquetes.filter(e => {
        if (e.statut !== 'archive') return false;
        const audienceResult = Object.values(resultats).find(r => r.enqueteId === e.id);
        if (!audienceResult?.dateAudience) return false;
        return new Date(audienceResult.dateAudience).getFullYear() === selectedYear;
      });

      // Procédures terminées « hors classements sans suite et ouvertures
      // d'information » — même périmètre que la carte de la page Statistiques.
      const enquetesTermineesFiltered = enquetesTerminees.filter(e => {
        const ar = Object.values(resultats).find(r => r.enqueteId === e.id);
        return ar && !ar.isClassement && !ar.isOI;
      });
      const directResultsFiltered = directResults.filter(r => !r.isClassement && !r.isOI);
      const totalTermineesFiltered = enquetesTermineesFiltered.length + directResultsFiltered.length;

      // Durée moyenne terminées (avec protection contre dateDebut invalide)
      const durationTerminees = enquetesTerminees.reduce((result, e) => {
        const audienceResult = Object.values(resultats).find(r => r.enqueteId === e.id);
        if (!audienceResult?.dateAudience || !e.dateDebut) return result;
        const start = new Date(e.dateDebut);
        const end = new Date(audienceResult.dateAudience);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return result;
        const duree = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
        if (duree < 0) return result;
        return { total: result.total + duree, count: result.count + 1 };
      }, { total: 0, count: 0 });
      const dureeMoyenneTerminees = durationTerminees.count > 0 ? durationTerminees.total / durationTerminees.count : 0;

      // Durée moyenne en cours : ancienneté du stock actuel (tous millésimes),
      // comme la carte « Nombre d'enquêtes en cours » de la page.
      const now = new Date();
      const enCoursStock = enquetes.filter(e => e.statut === 'en_cours');
      const durationEnCours = enCoursStock.reduce((result, e) => {
        if (!e.dateDebut) return result;
        const start = new Date(e.dateDebut);
        if (isNaN(start.getTime())) return result;
        const duree = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
        if (duree < 0) return result;
        return { total: result.total + duree, count: result.count + 1 };
      }, { total: 0, count: 0 });
      const dureeMoyenneEnCours = durationEnCours.count > 0 ? durationEnCours.total / durationEnCours.count : 0;

      // Mois à afficher
      const currentDate = new Date();
      const lastMonth = selectedYear === currentDate.getFullYear() ? currentDate.getMonth() : 11;
      const months = Array.from({ length: lastMonth + 1 }, (_, i) => i);

      // Procédures terminées par mois (hors classements et OI, comme la carte)
      const proceduremoisData = months.map(month => {
        const monthName = new Date(selectedYear, month).toLocaleString('fr-FR', { month: 'long' });
        const prelimCount = enquetesTermineesFiltered.filter(e => {
          const audienceResult = Object.values(resultats).find(r => r.enqueteId === e.id);
          if (!audienceResult) return false;
          const d = new Date(audienceResult.dateAudience);
          return d.getMonth() === month && d.getFullYear() === selectedYear;
        }).length;
        const directCount = directResultsFiltered.filter(r => {
          const d = new Date(r.dateAudience);
          return d.getMonth() === month && d.getFullYear() === selectedYear;
        }).length;
        return { mois: monthName, count: prelimCount + directCount };
      });

      // Actes d'enquête : MÊME fonction que l'écran (computeActeStats) — même
      // rattachement à l'année réelle des actes et même plafond anti-dates
      // aberrantes. L'ancien recalcul local n'avait pas ce garde-fou : une seule
      // dateFin erronée faisait exploser les totaux du PDF.
      const acteStats = computeActeStats(enquetes, selectedYear);

      // Services — même union que l'écran : enquêtes créées dans l'année ∪
      // enquêtes jugées dans l'année (dédupliquées) + procédures directes.
      const combinedServiceStats: Record<string, number> = {};
      const vuesGlobales = new Set<number>();
      [...enquetesForYear, ...enquetesTerminees].forEach(e => {
        if (vuesGlobales.has(e.id)) return;
        vuesGlobales.add(e.id);
        getServicesFromTags(e.tags).forEach(service => {
          if (service) combinedServiceStats[service] = (combinedServiceStats[service] || 0) + 1;
        });
      });
      directResults.forEach(r => {
        if (r.service) combinedServiceStats[r.service] = (combinedServiceStats[r.service] || 0) + 1;
      });

      const terminatedServiceStats: Record<string, number> = {};
      enquetesTerminees.forEach(e => {
        getServicesFromTags(e.tags).forEach(service => {
          if (service) terminatedServiceStats[service] = (terminatedServiceStats[service] || 0) + 1;
        });
      });
      directResults.forEach(r => {
        if (r.service) terminatedServiceStats[r.service] = (terminatedServiceStats[r.service] || 0) + 1;
      });

      const sortDesc = (obj: Record<string, number>) =>
        Object.entries(obj).sort(([, a], [, b]) => b - a).map(([service, count]) => ({ service, count }));

      // Stats audience annuelles et mensuelles
      const yearlyStats = getYearlyStats(resultats, enquetes, selectedYear);

      const monthlyData = months.map(month => {
        const monthName = new Date(selectedYear, month).toLocaleString('fr-FR', { month: 'long' });
        const mStats = getMonthlyStats(resultats, enquetes, selectedYear, month);
        return {
          mois: monthName,
          condamnations: mStats?.nombreCondamnations || 0,
          moisPrison: mStats?.totalPeinePrison || 0,
          amendes: mStats?.montantTotalAmendes || 0,
          crpc: mStats?.nombreCRPC || 0,
          ci: mStats?.nombreCI || 0,
          copj: mStats?.nombreCOPJ || 0,
          oi: mStats?.nombreOI || 0,
          cdd: mStats?.nombreCDD || 0,
          classement: mStats?.nombreClassements || 0,
        };
      });

      // Infractions agrégées par CATÉGORIE NATINF (taxonomie Mémento parquet :
      // Vol, Stupéfiants, Blanchiment…), en cohérence avec les cartes à l'écran.
      // Chaque enquête est comptée une fois par catégorie qu'elle touche.
      const categorieForInf = (inf: ReturnType<typeof infractionsForEnquete>[number]): string => {
        const resolved = categoryForEntry(
          inf.entry ?? { code: inf.code || '', libelle: inf.label || '', theme: undefined },
        );
        return resolved?.category.label ?? 'Autres / non classé';
      };

      const computeInfractionStats = (filter: (e: Enquete) => boolean) => {
        const counts = new Map<string, number>();
        enquetes.filter(filter).forEach(e => {
          const cats = new Set<string>();
          infractionsForEnquete(e).forEach(inf => cats.add(categorieForInf(inf)));
          cats.forEach(c => counts.set(c, (counts.get(c) || 0) + 1));
        });
        return [...counts.entries()]
          .map(([infraction, count]) => ({ infraction, count }))
          .sort((a, b) => b.count - a.count);
      };

      const infractionsEnCours = computeInfractionStats(e =>
        e.statut === 'en_cours' && new Date(e.dateCreation).getFullYear() <= selectedYear
      );

      const infractionsTerminees = computeInfractionStats(e => {
        if (e.statut !== 'archive') return false;
        const ar = Object.values(resultats).find(r => r.enqueteId === e.id);
        if (!ar?.dateAudience) return false;
        // Aligné sur l'écran (InfractionStats) : « Hors classements sans suite
        // et ouvertures d'information ».
        if (ar.isClassement || ar.isOI) return false;
        return new Date(ar.dateAudience).getFullYear() === selectedYear;
      });

      // Déférements par mois
      const deferementsParMois = months.map(month => {
        const monthName = new Date(selectedYear, month).toLocaleString('fr-FR', { month: 'long' });
        const count = Object.values(resultats).reduce((acc, r) => {
          if (r.nombreDeferes && r.dateDefere) {
            const d = new Date(r.dateDefere);
            if (d.getFullYear() === selectedYear && d.getMonth() === month) return acc + r.nombreDeferes;
          } else {
            return acc + r.condamnations.filter(c => {
              if (!c.defere) return false;
              const dateRef = c.dateDefere || r.dateAudience;
              const d = new Date(dateRef);
              return d.getFullYear() === selectedYear && d.getMonth() === month;
            }).length;
          }
          return acc;
        }, 0);
        return { mois: monthName, count };
      });
      // NB : on garde les mois à zéro — les retirer déformait l'axe du temps
      // de la courbe (mars collé à juin) alors que l'écran les affiche.

      // Âge moyen des dossiers avant ouverture d'information / classement
      // (même calcul que les cartes de la page Statistiques)
      const computeAgeMoyen = (predicate: (r: typeof directResults[number]) => boolean) => {
        const filtered = Object.values(resultats).filter(r =>
          predicate(r) && r.dateAudience && new Date(r.dateAudience).getFullYear() === selectedYear
        );
        let total = 0, count = 0;
        filtered.forEach(r => {
          const e = enquetes.find(en => en.id === r.enqueteId);
          if (!e?.dateDebut) return;
          const age = Math.floor((new Date(r.dateAudience).getTime() - new Date(e.dateDebut).getTime()) / (1000 * 60 * 60 * 24));
          if (age >= 0) { total += age; count++; }
        });
        return count > 0 ? Math.round(total / count) : 0;
      };
      const ouvertureInfoAgeMoyen = computeAgeMoyen(r => !!r.isOI);
      const classementAgeMoyen = computeAgeMoyen(r => !!r.isClassement);

      // Enquêtes en cours (stock actuel, tous millésimes) et ouvertures de
      // l'année (flux : toutes les enquêtes créées dans l'année, quel que soit
      // leur statut actuel — une enquête déjà jugée reste une ouverture).
      const enquetesEnCoursTotal = enCoursStock.length;
      const enquetesOuvertesAnnee = enquetesForYear;
      const ouverturesParMois = months.map(month => ({
        mois: new Date(selectedYear, month).toLocaleString('fr-FR', { month: 'long' }),
        count: enquetesOuvertesAnnee.filter(e => new Date(e.dateCreation).getMonth() === month).length,
      }));

      // Comparatif N-1 (miroir de GeneralStats.comparison) : totaux terminés
      // hors OI/classements + condamnations/prison/amendes + déférements.
      const prevYear = selectedYear - 1;
      const countTermineesFilteredForYear = (year: number) => {
        const prelim = enquetes.filter(e => {
          if (e.statut !== 'archive') return false;
          const ar = Object.values(resultats).find(r => r.enqueteId === e.id);
          if (!ar?.dateAudience || ar.isClassement || ar.isOI) return false;
          return new Date(ar.dateAudience).getFullYear() === year;
        }).length;
        const direct = Object.values(resultats)
          .filter(r => r.isDirectResult && !r.isClassement && !r.isOI && new Date(r.dateAudience).getFullYear() === year).length;
        return prelim + direct;
      };
      const countDeferementsForYear = (year: number) =>
        Object.values(resultats).reduce((acc, r) => {
          if (r.nombreDeferes && r.dateDefere) {
            if (new Date(r.dateDefere).getFullYear() === year) return acc + r.nombreDeferes;
          } else {
            return acc + r.condamnations.filter(c => {
              if (!c.defere) return false;
              const d = new Date(c.dateDefere || r.dateAudience);
              return d.getFullYear() === year;
            }).length;
          }
          return acc;
        }, 0);
      const prevYearlyStats = getYearlyStats(resultats, enquetes, prevYear);
      const prevTotalTerminees = countTermineesFilteredForYear(prevYear);
      const hasPrevData = prevTotalTerminees > 0 || (prevYearlyStats?.nombreCondamnations || 0) > 0;
      const comparatif = hasPrevData ? {
        prevYear,
        prevTotalTerminees,
        currentTotalTerminees: totalTermineesFiltered,
        prevCondamnations: prevYearlyStats?.nombreCondamnations || 0,
        currentCondamnations: yearlyStats?.nombreCondamnations || 0,
        prevPrison: prevYearlyStats?.totalPeinePrison || 0,
        currentPrison: yearlyStats?.totalPeinePrison || 0,
        prevAmendes: prevYearlyStats?.montantTotalAmendes || 0,
        currentAmendes: yearlyStats?.montantTotalAmendes || 0,
        prevDeferements: countDeferementsForYear(prevYear),
        currentDeferements: countDeferementsForYear(selectedYear),
      } : undefined;

      // Suivi parquet extérieur (miroir de GeneralStats.suiviStats).
      const isJIRS = (e: Enquete) => e.tags.some(t => t.category === 'suivi' && t.value === 'JIRS');
      const isPG = (e: Enquete) => e.tags.some(t => t.category === 'suivi' && t.value === 'PG');
      const relevantSuivi = enquetes.filter(e => {
        if (new Date(e.dateCreation).getFullYear() > selectedYear) return false;
        if (e.statut === 'en_cours' || e.statut === 'instruction') return true;
        if (e.statut === 'archive') {
          const ar = Object.values(resultats).find(r => r.enqueteId === e.id);
          if (ar?.dateAudience) return new Date(ar.dateAudience).getFullYear() === selectedYear;
          return new Date(e.dateMiseAJour).getFullYear() === selectedYear;
        }
        return false;
      });
      const suiviJirs = relevantSuivi.filter(isJIRS);
      const suiviPg = relevantSuivi.filter(isPG);
      const suivi = {
        total: new Set([...suiviJirs, ...suiviPg].map(e => e.id)).size,
        jirs: suiviJirs.length,
        pg: suiviPg.length,
        both: relevantSuivi.filter(e => isJIRS(e) && isPG(e)).length,
      };

      // Titre du rapport : libellé du contentieux courant (vue globale = tous)
      const contentieuxLabel = (!contentieuxId || contentieuxId === 'global')
        ? 'Tous contentieux'
        : (UserManager.getInstance().getAllContentieux().find(c => c.id === contentieuxId)?.label
          || contentieuxId);

      // Rédacteur : utilisateur courant (à défaut, valeur de repli)
      const redacteur = UserManager.getInstance().getCurrentUser()?.displayName || 'Audran CHEVALIER';

      // Section instruction — reflète InstructionStats (n'apparaît que s'il y a
      // au moins un dossier). Top 8 des qualifications comme à l'écran.
      const instructionStats = (instructions && instructionStatsRaw.nbDossiers > 0)
        ? {
            nbDossiers: instructionStatsRaw.nbDossiers,
            nbDossiersActifs: instructionStatsRaw.nbDossiersActifs,
            nbDossiersArchives: instructionStatsRaw.nbDossiersArchives,
            nbDossiersAuReglement: instructionStatsRaw.nbDossiersAuReglement,
            nbMisEnExamen: instructionStatsRaw.nbMisEnExamen,
            nbDetenus: instructionStatsRaw.nbDetenus,
            nbARSE: instructionStatsRaw.nbARSE,
            nbCJ: instructionStatsRaw.nbCJ,
            nbLibres: instructionStatsRaw.nbLibres,
            ageMoyenDossiersActifsJours: instructionStatsRaw.ageMoyenDossiersActifs,
            ageMaxDossierActifJours: instructionStatsRaw.ageMaxDossierActif,
            dossiersAReglerTotal: instructionStatsRaw.dossiersARegler.total,
            dossiersAReglerAvecDetenu: instructionStatsRaw.dossiersARegler.avecDetenu,
          }
        : undefined;

      // Assemblage des données
      const pdfData: PdfExportData = {
        selectedYear,
        contentieuxLabel,
        redacteur,
        enquetesTerminees: totalTermineesFiltered,
        enquetesEnCours: enquetesOuvertesAnnee.length,
        dureeMoyenneTerminees,
        dureeMoyenneEnCours,
        proceduremoisData,
        acteStats,
        serviceStats: sortDesc(combinedServiceStats),
        serviceStatsTerminees: sortDesc(terminatedServiceStats),
        audienceStats: yearlyStats,
        monthlyData,
        infractionsEnCours,
        infractionsTerminees,
        deferementsParMois,
        ouvertureInfoAgeMoyen,
        classementAgeMoyen,
        enquetesEnCoursTotal,
        enquetesOuvertesAnnee: enquetesOuvertesAnnee.length,
        ouverturesParMois,
        comparatif,
        suivi: suivi.total > 0 ? suivi : undefined,
        instructionStats,
      };

      await exportStatsPdf(pdfData, exportOptions);
      setShowOptions(false);
    } catch (error) {
      console.error('Erreur lors de l\'export PDF:', error);
      alert('Une erreur est survenue lors de l\'export PDF. Veuillez réessayer.');
    } finally {
      setIsExporting(false);
    }
  };

  const defaultRedacteur = UserManager.getInstance().getCurrentUser()?.displayName || '';

  return (
    <>
      <Button
        onClick={() => setShowOptions(true)}
        className="flex items-center gap-2 no-print"
        variant="outline"
        disabled={isExporting}
      >
        {isExporting ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            Génération du PDF…
          </>
        ) : (
          <>
            <FileText size={16} />
            Exporter en PDF
          </>
        )}
      </Button>

      <ExportPdfOptionsModal
        isOpen={showOptions}
        onClose={() => setShowOptions(false)}
        onConfirm={handleExportPDF}
        isExporting={isExporting}
        defaultRedacteur={defaultRedacteur}
      />
    </>
  );
};
