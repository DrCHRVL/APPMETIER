import React, { useState } from 'react';
import { Button } from '../ui/button';
import { FileText, Loader2 } from 'lucide-react';
import { useAudience } from '@/hooks/useAudience';
import { useTags } from '@/hooks/useTags';
import { Enquete } from '@/types/interfaces';
import { getYearlyStats, getMonthlyStats } from '@/utils/audienceStats';
import { exportStatsPdf, PdfExportData } from '@/utils/generateStatsPdf';

interface ExportPdfButtonProps {
  selectedYear?: number;
  enquetes: Enquete[];
}

export const ExportPdfButton = ({
  selectedYear = new Date().getFullYear(),
  enquetes,
}: ExportPdfButtonProps) => {
  const [isExporting, setIsExporting] = useState(false);
  const { audienceState } = useAudience();
  const { getServicesFromTags } = useTags();

  const handleExportPDF = async () => {
    setIsExporting(true);

    try {
      const resultats = audienceState?.resultats || {};
      const directResults = Object.values(resultats)
        .filter(r => r.isDirectResult && new Date(r.dateAudience).getFullYear() === selectedYear);

      // --- Calcul des données pour le PDF ---

      // Enquêtes filtrées par année
      const enquetesForYear = enquetes.filter(e =>
        new Date(e.dateCreation).getFullYear() === selectedYear
      );
      const activeEnquetes = enquetesForYear.filter(e => e.statut === 'en_cours');

      // Enquêtes terminées (par date d'audience)
      const enquetesTerminees = enquetes.filter(e => {
        if (e.statut !== 'archive') return false;
        const audienceResult = Object.values(resultats).find(r => r.enqueteId === e.id);
        if (!audienceResult?.dateAudience) return false;
        return new Date(audienceResult.dateAudience).getFullYear() === selectedYear;
      });

      // Durée moyenne terminées
      const dureeMoyenneTerminees = enquetesTerminees.reduce((acc, e) => {
        const audienceResult = Object.values(resultats).find(r => r.enqueteId === e.id);
        if (!audienceResult?.dateAudience) return acc;
        const start = new Date(e.dateDebut);
        const end = new Date(audienceResult.dateAudience);
        return acc + Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      }, 0) / (enquetesTerminees.length || 1);

      // Durée moyenne en cours
      const now = new Date();
      const dureeMoyenneEnCours = activeEnquetes.reduce((acc, e) => {
        const start = new Date(e.dateDebut);
        return acc + Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      }, 0) / (activeEnquetes.length || 1);

      // Mois à afficher
      const currentDate = new Date();
      const lastMonth = selectedYear === currentDate.getFullYear() ? currentDate.getMonth() : 11;
      const months = Array.from({ length: lastMonth + 1 }, (_, i) => i);

      // Procédures terminées par mois
      const proceduremoisData = months.map(month => {
        const monthName = new Date(selectedYear, month).toLocaleString('fr-FR', { month: 'long' });
        const prelimCount = enquetesTerminees.filter(e => {
          const audienceResult = Object.values(resultats).find(r => r.enqueteId === e.id);
          if (!audienceResult) return false;
          const d = new Date(audienceResult.dateAudience);
          return d.getMonth() === month && d.getFullYear() === selectedYear;
        }).length;
        const directCount = directResults.filter(r => {
          const d = new Date(r.dateAudience);
          return d.getMonth() === month && d.getFullYear() === selectedYear;
        }).length;
        return { mois: monthName, count: prelimCount + directCount };
      });

      // Actes d'enquête
      const acteStats = enquetesForYear.reduce((acc, e) => {
        const ecoutes = e.ecoutes?.length || 0;
        const geolocalisations = e.geolocalisations?.length || 0;
        const autresActes = e.actes?.length || 0;

        const prolongationsEcoutes = e.ecoutes?.reduce((sum, ecoute) => {
          let count = 0;
          if (ecoute.dateDebut && ecoute.dateFin) {
            const duree = Math.floor((new Date(ecoute.dateFin).getTime() - new Date(ecoute.dateDebut).getTime()) / (1000 * 60 * 60 * 24));
            if (duree > 30) count = Math.min(1, Math.floor((duree - 30) / 30));
          }
          if (ecoute.prolongationsHistory?.length) count = Math.max(ecoute.prolongationsHistory.length > 1 ? 1 : ecoute.prolongationsHistory.length, count);
          if (count === 0 && (ecoute.prolongationData || ecoute.prolongationDate)) count = 1;
          return sum + count;
        }, 0) || 0;

        const prolongationsGeo = e.geolocalisations?.reduce((sum, geoloc) => {
          let count = 0;
          if (geoloc.dateDebut && geoloc.dateFin) {
            const duree = Math.floor((new Date(geoloc.dateFin).getTime() - new Date(geoloc.dateDebut).getTime()) / (1000 * 60 * 60 * 24));
            if (duree > 15) count = Math.floor((duree - 15) / 30);
          }
          if (geoloc.prolongationsHistory?.length) count = Math.max(geoloc.prolongationsHistory.length, count);
          if (count === 0 && (geoloc.prolongationData || geoloc.prolongationDate)) count = 1;
          return sum + count;
        }, 0) || 0;

        const prolongationsAutres = e.actes?.reduce((sum, acte) => {
          if (acte.prolongationsHistory?.length) return sum + acte.prolongationsHistory.length;
          if (acte.prolongationData || acte.prolongationDate) return sum + 1;
          return sum;
        }, 0) || 0;

        return {
          ecoutes: acc.ecoutes + ecoutes,
          geolocalisations: acc.geolocalisations + geolocalisations,
          autresActes: acc.autresActes + autresActes,
          prolongationsEcoutes: acc.prolongationsEcoutes + prolongationsEcoutes,
          prolongationsGeo: acc.prolongationsGeo + prolongationsGeo,
          prolongationsAutres: acc.prolongationsAutres + prolongationsAutres,
        };
      }, { ecoutes: 0, geolocalisations: 0, autresActes: 0, prolongationsEcoutes: 0, prolongationsGeo: 0, prolongationsAutres: 0 });

      // Services
      const combinedServiceStats: Record<string, number> = {};
      enquetesForYear.forEach(e => {
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

      // Infractions
      const infractionSet = new Set<string>();
      enquetes.forEach(e => {
        e.tags.filter(t => t.category === 'infractions').forEach(t => { if (t.value) infractionSet.add(t.value); });
      });
      const infractions = Array.from(infractionSet).sort();

      const computeInfractionStats = (filter: (e: Enquete) => boolean) =>
        infractions.reduce((acc, inf) => {
          const count = enquetes.filter(e => filter(e) && e.tags.some(t => t.category === 'infractions' && t.value === inf)).length;
          if (count > 0) acc.push({ infraction: inf, count });
          return acc;
        }, [] as { infraction: string; count: number }[]);

      const infractionsEnCours = computeInfractionStats(e =>
        e.statut === 'en_cours' && new Date(e.dateCreation).getFullYear() <= selectedYear
      );

      const infractionsTerminees = computeInfractionStats(e => {
        if (e.statut !== 'archive') return false;
        const ar = Object.values(resultats).find(r => r.enqueteId === e.id);
        return ar?.dateAudience ? new Date(ar.dateAudience).getFullYear() === selectedYear : false;
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
              const dateRef = (c as any).dateDefere || r.dateAudience;
              const d = new Date(dateRef);
              return d.getFullYear() === selectedYear && d.getMonth() === month;
            }).length;
          }
          return acc;
        }, 0);
        return { mois: monthName, count };
      }).filter(d => d.count > 0);

      // Assemblage des données
      const pdfData: PdfExportData = {
        selectedYear,
        enquetesTerminees: enquetesTerminees.length + directResults.length,
        enquetesEnCours: activeEnquetes.length,
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
      };

      await exportStatsPdf(pdfData);
    } catch (error) {
      console.error('Erreur lors de l\'export PDF:', error);
      alert('Une erreur est survenue lors de l\'export PDF. Veuillez réessayer.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Button
      onClick={handleExportPDF}
      className="flex items-center gap-2 no-print"
      variant="outline"
      disabled={isExporting}
    >
      {isExporting ? (
        <>
          <Loader2 size={16} className="animate-spin" />
          Generation du PDF...
        </>
      ) : (
        <>
          <FileText size={16} />
          Exporter en PDF
        </>
      )}
    </Button>
  );
};
