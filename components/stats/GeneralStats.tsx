import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Enquete } from '@/types/interfaces';
import { ContentieuxId, ContentieuxDefinition } from '@/types/userTypes';
import { useAudience } from '@/hooks/useAudience';
import { useMemo } from 'react';
import { Pie } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, PointElement, LineElement, BarElement } from 'chart.js';
import { Line } from 'react-chartjs-2';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { useTags } from '@/hooks/useTags';
import { useActeStats } from '@/hooks/useActeStats';
import { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { getYearlyStats } from '@/utils/audienceStats';
import { Flag } from 'lucide-react';

ChartJS.register(
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ChartDataLabels
);

const CHART_COLORS = [
  '#34495e', '#3498db', '#2ecc71', '#16a085', '#e74c3c', '#c0392b',
  '#f1c40f', '#f39c12', '#9b59b6', '#8e44ad', '#1abc9c', '#7f8c8d',
  '#d35400', '#27ae60', '#2980b9', '#95a5a6'
];

// Couleur stable par service (basée sur le hash du nom, pas sur l'index)
const getServiceColor = (service: string, index: number) => {
  let hash = 0;
  for (let i = 0; i < service.length; i++) {
    hash = service.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colorIndex = Math.abs(hash) % CHART_COLORS.length;
  return CHART_COLORS[colorIndex];
};

interface GeneralStatsProps {
  enquetes: Enquete[];
  selectedYear: number;
  contentieuxId?: string;
  enquetesByContentieux?: Map<ContentieuxId, Enquete[]>;
  contentieuxDefs?: ContentieuxDefinition[];
}

export const GeneralStats = ({ enquetes, selectedYear, contentieuxId, enquetesByContentieux, contentieuxDefs }: GeneralStatsProps) => {
  const { audienceState } = useAudience();
  const { getServicesFromTags } = useTags();
  const currentDate = new Date();

  // IDs des enquêtes du contentieux actif (pour filtrer les résultats d'audience)
  const enqueteIds = useMemo(() => new Set(enquetes.map(e => e.id)), [enquetes]);

  // Résultats d'audience scopés au contentieux actif (ou tous si global)
  const scopedResultats = useMemo(() => {
    const all = audienceState?.resultats || {};
    if (contentieuxId === 'global') return all;
    return Object.fromEntries(
      Object.entries(all).filter(([key, r]) => {
        if (r.isDirectResult) return contentieuxId === 'crimorg';
        return enqueteIds.has(Number(key));
      })
    );
  }, [audienceState?.resultats, enqueteIds, contentieuxId]);

  const directResults = Object.values(scopedResultats)
    .filter(r => r.isDirectResult && new Date(r.dateAudience).getFullYear() === selectedYear);

  const enquetesForYear = enquetes.filter(e =>
    new Date(e.dateCreation).getFullYear() === selectedYear
  );
  const activeEnquetes = enquetesForYear.filter(e => e.statut === 'en_cours');

  const enquetesTerminees = enquetes.filter(e => {
    if (e.statut !== 'archive') return false;
    const audienceResult = Object.values(scopedResultats)
      .find(r => r.enqueteId === e.id);
    if (!audienceResult?.dateAudience) return false;
    return new Date(audienceResult.dateAudience).getFullYear() === selectedYear;
  });

  // Procédures terminées hors classements sans suite et OI
  const enquetesTermineesFiltered = enquetesTerminees.filter(e => {
    const audienceResult = Object.values(scopedResultats)
      .find(r => r.enqueteId === e.id);
    return audienceResult && !audienceResult.isClassement && !audienceResult.isOI;
  });
  const directResultsFiltered = directResults.filter(r => !r.isClassement && !r.isOI);

  // Comptage classements et OI pour l'affichage
  const classementsCount = enquetesTerminees.filter(e => {
    const audienceResult = Object.values(scopedResultats)
      .find(r => r.enqueteId === e.id);
    return audienceResult?.isClassement;
  }).length + directResults.filter(r => r.isClassement).length;

  const oiCount = enquetesTerminees.filter(e => {
    const audienceResult = Object.values(scopedResultats)
      .find(r => r.enqueteId === e.id);
    return audienceResult?.isOI;
  }).length + directResults.filter(r => r.isOI).length;

  // Stats suivi JIRS / PG — enquêtes actives pendant l'année sélectionnée
  const suiviStats = useMemo(() => {
    // Enquêtes pertinentes pour l'année : créées avant ou pendant l'année,
    // et soit encore en cours, soit archivées pendant cette année
    const relevant = enquetes.filter(e => {
      const created = new Date(e.dateCreation).getFullYear();
      if (created > selectedYear) return false;
      if (e.statut === 'en_cours' || e.statut === 'instruction') return true;
      if (e.statut === 'archive') {
        const ar = Object.values(scopedResultats).find(r => r.enqueteId === e.id);
        if (ar?.dateAudience) return new Date(ar.dateAudience).getFullYear() === selectedYear;
        return new Date(e.dateMiseAJour).getFullYear() === selectedYear;
      }
      return false;
    });

    const jirs = relevant.filter(e => e.tags.some(t => t.category === 'suivi' && t.value === 'JIRS'));
    const pg = relevant.filter(e => e.tags.some(t => t.category === 'suivi' && t.value === 'PG'));
    const both = relevant.filter(e =>
      e.tags.some(t => t.category === 'suivi' && t.value === 'JIRS') &&
      e.tags.some(t => t.category === 'suivi' && t.value === 'PG')
    );
    return { jirs, pg, both, total: new Set([...jirs, ...pg].map(e => e.id)).size };
  }, [enquetes, selectedYear, scopedResultats]);

  const getMonthsToShow = () => {
    const lastMonth = selectedYear === currentDate.getFullYear() ?
      currentDate.getMonth() : 11;
    return Array.from({ length: lastMonth + 1 }, (_, i) => i);
  };

  // Durées moyennes (avec protection contre dateDebut invalide)
  const durationTerminees = enquetesTerminees.reduce((result, e) => {
    const audienceResult = Object.values(scopedResultats).find(r => r.enqueteId === e.id);
    if (!audienceResult?.dateAudience || !e.dateDebut) return result;
    const start = new Date(e.dateDebut);
    const end = new Date(audienceResult.dateAudience);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return result;
    const duree = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    if (duree < 0) return result;
    return { total: result.total + duree, count: result.count + 1 };
  }, { total: 0, count: 0 });
  const averageDurationTerminees = durationTerminees.count > 0 ? durationTerminees.total / durationTerminees.count : 0;

  const durationEnCours = activeEnquetes.reduce((result, e) => {
    if (!e.dateDebut) return result;
    const start = new Date(e.dateDebut);
    if (isNaN(start.getTime())) return result;
    const now = new Date();
    const duree = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    if (duree < 0) return result;
    return { total: result.total + duree, count: result.count + 1 };
  }, { total: 0, count: 0 });
  const averageDurationEnCours = durationEnCours.count > 0 ? durationEnCours.total / durationEnCours.count : 0;

  // Actes via hook
  const acteStats = useActeStats(enquetesForYear);

  // Comparatif N-1
  const prevYear = selectedYear - 1;
  const comparison = useMemo(() => {
    // Procédures terminées N-1 (hors OI et classements, raccord avec la carte)
    const prevEnquetesTerminees = enquetes.filter(e => {
      if (e.statut !== 'archive') return false;
      const ar = Object.values(scopedResultats).find(r => r.enqueteId === e.id);
      if (!ar?.dateAudience) return false;
      if (ar.isClassement || ar.isOI) return false;
      return new Date(ar.dateAudience).getFullYear() === prevYear;
    });
    const prevDirectResults = Object.values(scopedResultats)
      .filter(r => r.isDirectResult && !r.isClassement && !r.isOI && new Date(r.dateAudience).getFullYear() === prevYear);

    const prevTotalTerminees = prevEnquetesTerminees.length + prevDirectResults.length;
    const currentTotalTerminees = enquetesTermineesFiltered.length + directResultsFiltered.length;

    const prevYearlyStats = getYearlyStats(scopedResultats, enquetes, prevYear);
    const currentYearlyStats = getYearlyStats(scopedResultats, enquetes, selectedYear);

    // Déférements : même logique que la carte (scopedResultats directement)
    const countDeferementsForYear = (year: number) => {
      return Object.values(scopedResultats).reduce((acc, r) => {
        if (r.nombreDeferes && r.dateDefere) {
          const date = new Date(r.dateDefere);
          if (date.getFullYear() === year) return acc + r.nombreDeferes;
        } else {
          return acc + r.condamnations.filter(c => {
            if (!c.defere) return false;
            const dateRef = c.dateDefere || r.dateAudience;
            const date = new Date(dateRef);
            return date.getFullYear() === year;
          }).length;
        }
        return acc;
      }, 0);
    };
    const prevDeferements = countDeferementsForYear(prevYear);
    const currentDeferements = countDeferementsForYear(selectedYear);

    return {
      prevTotalTerminees,
      currentTotalTerminees,
      diffTerminees: currentTotalTerminees - prevTotalTerminees,
      prevCondamnations: prevYearlyStats?.nombreCondamnations || 0,
      currentCondamnations: currentYearlyStats?.nombreCondamnations || 0,
      diffCondamnations: (currentYearlyStats?.nombreCondamnations || 0) - (prevYearlyStats?.nombreCondamnations || 0),
      prevPrison: prevYearlyStats?.totalPeinePrison || 0,
      currentPrison: currentYearlyStats?.totalPeinePrison || 0,
      diffPrison: (currentYearlyStats?.totalPeinePrison || 0) - (prevYearlyStats?.totalPeinePrison || 0),
      prevAmendes: prevYearlyStats?.montantTotalAmendes || 0,
      currentAmendes: currentYearlyStats?.montantTotalAmendes || 0,
      diffAmendes: (currentYearlyStats?.montantTotalAmendes || 0) - (prevYearlyStats?.montantTotalAmendes || 0),
      prevDeferements,
      currentDeferements,
      diffDeferements: currentDeferements - prevDeferements,
      hasPrevData: prevTotalTerminees > 0 || (prevYearlyStats?.nombreCondamnations || 0) > 0,
    };
  }, [scopedResultats, enquetes, selectedYear, prevYear]);

  // Services
  const combinedServiceStats: Record<string, number> = {};
  enquetesForYear.forEach(e => {
    getServicesFromTags(e.tags).forEach(service => {
      if (service) combinedServiceStats[service] = (combinedServiceStats[service] || 0) + 1;
    });
  });
  Object.values(scopedResultats)
    .filter(r => r.isDirectResult && new Date(r.dateAudience).getFullYear() === selectedYear)
    .forEach(r => {
      if (r.service) combinedServiceStats[r.service] = (combinedServiceStats[r.service] || 0) + 1;
    });

  const sortedCombinedServiceStats = Object.entries(combinedServiceStats)
    .sort(([, a], [, b]) => b - a)
    .reduce((acc, [service, count]) => { acc[service] = count; return acc; }, {} as Record<string, number>);

  const terminatedServiceStats: Record<string, number> = {};
  enquetesTerminees.forEach(e => {
    getServicesFromTags(e.tags).forEach(service => {
      if (service) terminatedServiceStats[service] = (terminatedServiceStats[service] || 0) + 1;
    });
  });
  Object.values(scopedResultats)
    .filter(r => r.isDirectResult && new Date(r.dateAudience).getFullYear() === selectedYear)
    .forEach(r => {
      if (r.service) terminatedServiceStats[r.service] = (terminatedServiceStats[r.service] || 0) + 1;
    });

  const sortedTerminatedServiceStats = Object.entries(terminatedServiceStats)
    .sort(([, a], [, b]) => b - a)
    .reduce((acc, [service, count]) => { acc[service] = count; return acc; }, {} as Record<string, number>);

  const serviceEntries = Object.entries(sortedCombinedServiceStats);
  const serviceColors: Record<string, string> = {};
  serviceEntries.forEach(([service, _], index) => {
    serviceColors[service] = getServiceColor(service, index);
  });

  // Estimation temps actes
  const tempsPourUnActe = 35;
  const tempsEstimeMinutes = acteStats.totalAvecProlongations * tempsPourUnActe;
  const moisActuel = new Date().getMonth();
  const moisComplexes = [0, 1, 5, 6, 8, 9, 10, 11];
  const facteurComplexite = moisComplexes.includes(moisActuel) ? 1.18 : 1.05;
  const tempsEstimeMinutesAjuste = Math.ceil(tempsEstimeMinutes * facteurComplexite);
  const tempsEstimeHeures = Math.floor(tempsEstimeMinutesAjuste / 60);
  const tempsEstimeMinutesRestantes = tempsEstimeMinutesAjuste % 60;

  const debutAnnee = new Date(selectedYear, 0, 1);
  const finAnnee = selectedYear === new Date().getFullYear() ? new Date() : new Date(selectedYear, 11, 31);
  const millisecondesParSemaine = 7 * 24 * 60 * 60 * 1000;
  const nombreSemainesReel = Math.max(1, Math.ceil((finAnnee.getTime() - debutAnnee.getTime()) / millisecondesParSemaine));
  const nombreSemainesAjuste = Math.max(1, Math.floor(nombreSemainesReel * 0.95));
  const nombreMoisReel = selectedYear === new Date().getFullYear() ? new Date().getMonth() + 1 : 12;
  const nombreMoisAjuste = Math.max(1, Math.floor(nombreMoisReel * 0.93));

  const arrondiFavorable = (nombre: number) => Math.ceil(nombre * 10) / 10;
  const moyenneActesParSemaine = arrondiFavorable(acteStats.totalAvecProlongations / nombreSemainesAjuste);
  const moyenneActesParMois = arrondiFavorable(acteStats.totalAvecProlongations / nombreMoisAjuste);
  const moyenneTempsParSemaine = arrondiFavorable((tempsEstimeMinutesAjuste / nombreSemainesAjuste) / 60);
  const moyenneTempsParMois = arrondiFavorable((tempsEstimeMinutesAjuste / nombreMoisAjuste) / 60);

  // Total déférements pour l'année sélectionnée
  const totalDeferementsYear = Object.values(scopedResultats)
    .reduce((acc, r) => {
      if (r.nombreDeferes && r.dateDefere) {
        const date = new Date(r.dateDefere);
        if (date.getFullYear() === selectedYear) {
          return acc + r.nombreDeferes;
        }
      } else {
        return acc + r.condamnations.filter(c => {
          if (!c.defere) return false;
          const dateRef = c.dateDefere || r.dateAudience;
          const date = new Date(dateRef);
          return date.getFullYear() === selectedYear;
        }).length;
      }
      return acc;
    }, 0);

  // Enquêtes en cours
  const allEnquetesEnCours = enquetes.filter(e => e.statut === 'en_cours');
  const enquetesOuvertesAnnee = enquetes.filter(e =>
    e.statut === 'en_cours' && new Date(e.dateCreation).getFullYear() === selectedYear
  );

  // === Statistiques par contentieux (uniquement pour la vue globale) ===
  const isGlobal = contentieuxId === 'global' && enquetesByContentieux && contentieuxDefs;
  const enabledDefs = useMemo(() => (contentieuxDefs || []).filter(d => d.enabled !== false).sort((a, b) => a.order - b.order), [contentieuxDefs]);

  const contentieuxStats = useMemo(() => {
    if (!isGlobal) return null;
    const allResultats = audienceState?.resultats || {};

    return enabledDefs.map(def => {
      const cEnquetes = enquetesByContentieux!.get(def.id) || [];
      const cEnqueteIds = new Set(cEnquetes.map(e => e.id));

      // Scoped resultats for this contentieux
      const cResultats = Object.fromEntries(
        Object.entries(allResultats).filter(([key, r]) => {
          if (r.isDirectResult) return def.id === 'crimorg';
          return cEnqueteIds.has(Number(key));
        })
      );

      // Procédures terminées (hors classements et OI)
      const cTerminees = cEnquetes.filter(e => {
        if (e.statut !== 'archive') return false;
        const ar = Object.values(cResultats).find(r => r.enqueteId === e.id);
        if (!ar?.dateAudience) return false;
        if (ar.isClassement || ar.isOI) return false;
        return new Date(ar.dateAudience).getFullYear() === selectedYear;
      });
      const cDirectFiltered = Object.values(cResultats)
        .filter(r => r.isDirectResult && !r.isClassement && !r.isOI && new Date(r.dateAudience).getFullYear() === selectedYear);
      const totalTerminees = cTerminees.length + cDirectFiltered.length;

      // Durée moyenne terminées
      const durTerminees = cTerminees.reduce((res, e) => {
        const ar = Object.values(cResultats).find(r => r.enqueteId === e.id);
        if (!ar?.dateAudience || !e.dateDebut) return res;
        const start = new Date(e.dateDebut);
        const end = new Date(ar.dateAudience);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return res;
        const duree = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
        if (duree < 0) return res;
        return { total: res.total + duree, count: res.count + 1 };
      }, { total: 0, count: 0 });
      const avgDuration = durTerminees.count > 0 ? Math.round(durTerminees.total / durTerminees.count) : 0;

      // Enquêtes en cours
      const enCours = cEnquetes.filter(e => e.statut === 'en_cours').length;

      // Actes - enquêtes de l'année
      const cEnquetesForYear = cEnquetes.filter(e => new Date(e.dateCreation).getFullYear() === selectedYear);
      const cActes = cEnquetesForYear.reduce((acc, e) => {
        const tags = e.tags || [];
        const ecoutes = tags.filter(t => t.category === 'acte' && t.value === 'ecoute').length;
        const geo = tags.filter(t => t.category === 'acte' && t.value === 'geolocalisation').length;
        const autres = tags.filter(t => t.category === 'acte' && t.value === 'autre').length;
        const prolongEcoutes = tags.filter(t => t.category === 'prolongation' && t.value === 'ecoute').length;
        const prolongGeo = tags.filter(t => t.category === 'prolongation' && t.value === 'geolocalisation').length;
        const prolongAutres = tags.filter(t => t.category === 'prolongation' && t.value === 'autre').length;
        return acc + ecoutes + geo + autres + prolongEcoutes + prolongGeo + prolongAutres;
      }, 0);

      // Déférements par mois
      const deferementsParMois: Record<number, number> = {};
      for (let m = 0; m <= 11; m++) deferementsParMois[m] = 0;
      Object.values(cResultats).forEach(r => {
        if (r.nombreDeferes && r.dateDefere) {
          const date = new Date(r.dateDefere);
          if (date.getFullYear() === selectedYear) {
            deferementsParMois[date.getMonth()] = (deferementsParMois[date.getMonth()] || 0) + r.nombreDeferes;
          }
        } else {
          r.condamnations.forEach(c => {
            if (!c.defere) return;
            const dateRef = c.dateDefere || r.dateAudience;
            const date = new Date(dateRef);
            if (date.getFullYear() === selectedYear) {
              deferementsParMois[date.getMonth()] = (deferementsParMois[date.getMonth()] || 0) + 1;
            }
          });
        }
      });
      const totalDeferements = Object.values(deferementsParMois).reduce((a, b) => a + b, 0);

      // Condamnations
      const totalCondamnations = Object.values(cResultats)
        .filter(r => new Date(r.dateAudience).getFullYear() === selectedYear)
        .reduce((acc, r) => acc + r.condamnations.length, 0);

      return {
        def,
        totalTerminees,
        avgDuration,
        enCours,
        totalActes: cActes,
        deferementsParMois,
        totalDeferements,
        totalCondamnations,
      };
    });
  }, [isGlobal, enabledDefs, enquetesByContentieux, audienceState?.resultats, selectedYear]);

  // Helper pour afficher les tendances
  const DiffBadge = ({ diff, suffix = '' }: { diff: number; suffix?: string }) => {
    if (diff === 0) return <span className="text-xs text-gray-400">= {suffix}</span>;
    const isPositive = diff > 0;
    return (
      <span className={`text-xs font-semibold ${isPositive ? 'text-green-600' : 'text-red-500'}`}>
        {isPositive ? '+' : ''}{diff}{suffix}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {/* Carte Total des procédures terminées */}
        <Card>
          <CardHeader>
            <CardTitle>Total des procédures terminées</CardTitle>
            <p className="text-sm text-gray-500">Hors classements sans suite et ouvertures d'information</p>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {enquetesTermineesFiltered.length + directResultsFiltered.length}
            </div>
            <div className="mt-4 pt-4 border-t space-y-1">
              {getMonthsToShow().map(month => {
                const prelimCount = enquetesTermineesFiltered.filter(e => {
                  const audienceResult = Object.values(scopedResultats)
                    .find(r => r.enqueteId === e.id);
                  const audienceDate = new Date(audienceResult.dateAudience);
                  return audienceResult &&
                         audienceDate.getMonth() === month &&
                         audienceDate.getFullYear() === selectedYear;
                }).length;
                const directCount = directResultsFiltered.filter(r => {
                  const audienceDate = new Date(r.dateAudience);
                  return audienceDate.getMonth() === month &&
                         audienceDate.getFullYear() === selectedYear;
                }).length;
                return (
                  <div key={month} className="flex justify-between text-sm">
                    <span>{new Date(selectedYear, month).toLocaleString('default', { month: 'long' })}:</span>
                    <span className="font-medium">{prelimCount + directCount}</span>
                  </div>
                );
              })}
            </div>
            {/* Subdivision par contentieux */}
            {isGlobal && contentieuxStats && contentieuxStats.length > 0 && (
              <div className="mt-4 pt-4 border-t">
                <p className="text-xs font-medium text-gray-500 mb-2">Par contentieux</p>
                <div className="space-y-1">
                  {contentieuxStats.filter(s => s.totalTerminees > 0).map(s => (
                    <div key={s.def.id} className="flex justify-between items-center text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.def.color }} />
                        <span className="text-gray-700">{s.def.label}</span>
                      </div>
                      <span className="font-semibold">{s.totalTerminees}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-3 pt-3 border-t">
              <p className="text-xs text-gray-400">
                Total avec OI et classements sans suite : <span className="font-semibold">{enquetesTerminees.length + directResults.length}</span>
              </p>
              <p className="text-xs text-gray-400">
                dont {oiCount} ouverture{oiCount > 1 ? 's' : ''} d'information et {classementsCount} classement{classementsCount > 1 ? 's' : ''} sans suite
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Carte Durée moyenne */}
        <Card>
          <CardHeader>
            <CardTitle>Durée moyenne</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{Math.round(averageDurationTerminees)} jours</div>
            <p className="text-sm text-gray-500">Pour les enquêtes préliminaires terminées</p>
            <div className="mt-2 pt-2 border-t">
              <div className="text-sm">Enquêtes en cours: {Math.round(averageDurationEnCours)} jours</div>
            </div>
            {/* Subdivision par contentieux */}
            {isGlobal && contentieuxStats && contentieuxStats.length > 0 && (
              <div className="mt-4 pt-4 border-t">
                <p className="text-xs font-medium text-gray-500 mb-2">Par contentieux (terminées)</p>
                <div className="space-y-1">
                  {contentieuxStats.filter(s => s.avgDuration > 0).map(s => (
                    <div key={s.def.id} className="flex justify-between items-center text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.def.color }} />
                        <span className="text-gray-700">{s.def.label}</span>
                      </div>
                      <span className="font-semibold">{s.avgDuration} jours</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Carte Actes d'enquête (utilise le hook useActeStats) */}
        <Card>
          <CardHeader>
            <CardTitle>Actes d'enquête en préliminaire</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{acteStats.totalAvecProlongations}</div>
            <p className="text-sm text-gray-500 mb-4">
              Moyenne de {arrondiFavorable(acteStats.totalAvecProlongations / (enquetesForYear.length || 1))} actes/prolongations par enquête
            </p>

            <div className="bg-gray-50 p-3 rounded-md mb-4">
              <div className="text-sm font-medium mb-1">Estimation du temps de traitement total</div>
              <div className="text-lg font-bold">
                {tempsEstimeHeures}h{tempsEstimeMinutesRestantes > 0 ? tempsEstimeMinutesRestantes : ''}
              </div>
              <div className="text-xs text-gray-500">
                Basé sur une moyenne de 35 min par acte ou prolongation
                {moisComplexes.includes(moisActuel) &&
                  <span className="ml-1">(période à forte charge)</span>
                }
              </div>
              <div className="text-sm mt-2">
                Moyenne hebdomadaire : {moyenneActesParSemaine} actes ({moyenneTempsParSemaine}h)
                <br/>
                Moyenne mensuelle : {moyenneActesParMois} actes ({moyenneTempsParMois}h)
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between">
                <span>Écoutes</span>
                <span className="font-bold">{acteStats.ecoutes}</span>
              </div>
              <div className="flex justify-between">
                <span>Géolocalisations</span>
                <span className="font-bold">{acteStats.geolocalisations}</span>
              </div>
              <div className="flex justify-between">
                <span>Autres actes</span>
                <span className="font-bold">{acteStats.autresActes}</span>
              </div>
              <div className="pt-2 mt-2 border-t">
                <div className="flex justify-between">
                  <span>Prolongations totales</span>
                  <span className="font-bold">{acteStats.totalProlongations}</span>
                </div>
                <div className="text-sm text-gray-500 mt-1">
                  Écoutes: {acteStats.prolongationsEcoutes} | Géoloc: {acteStats.prolongationsGeo} | Autres: {acteStats.prolongationsAutres}
                </div>
                <div className="flex justify-between mt-2 text-sm">
                  <span>Moyenne de prolongations par acte</span>
                  <span className="font-semibold">
                    {acteStats.totalActes > 0 ? (acteStats.totalProlongations / acteStats.totalActes).toFixed(2) : '0'}
                  </span>
                </div>
              </div>
            </div>
            {/* Répartition par contentieux */}
            {isGlobal && contentieuxStats && contentieuxStats.filter(s => s.totalActes > 0).length > 0 && (() => {
              const actesData = contentieuxStats.filter(s => s.totalActes > 0).sort((a, b) => b.totalActes - a.totalActes);
              const totalActesGlobal = actesData.reduce((a, s) => a + s.totalActes, 0);
              return (
                <div className="mt-4 pt-4 border-t">
                  <p className="text-xs font-medium text-gray-500 mb-2">Répartition par contentieux</p>
                  <div className="flex items-center gap-4">
                    <div className="h-[120px] w-[120px] flex-shrink-0">
                      <Pie
                        data={{
                          labels: actesData.map(s => s.def.label),
                          datasets: [{
                            data: actesData.map(s => s.totalActes),
                            backgroundColor: actesData.map(s => s.def.color),
                          }],
                        }}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          plugins: {
                            legend: { display: false },
                            datalabels: { display: false },
                            tooltip: {
                              callbacks: {
                                label: (ctx) => {
                                  const pct = totalActesGlobal > 0 ? ((ctx.raw as number / totalActesGlobal) * 100).toFixed(0) : '0';
                                  return ` ${ctx.label}: ${ctx.raw} (${pct}%)`;
                                }
                              }
                            },
                          },
                        }}
                      />
                    </div>
                    <div className="space-y-1 flex-grow">
                      {actesData.map(s => (
                        <div key={s.def.id} className="flex justify-between items-center text-xs">
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.def.color }} />
                            <span>{s.def.label}</span>
                          </div>
                          <span className="font-semibold">
                            {s.totalActes} ({totalActesGlobal > 0 ? ((s.totalActes / totalActesGlobal) * 100).toFixed(0) : 0}%)
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>

        {/* Carte Suivi instances supérieures */}
        {suiviStats.total > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Flag className="h-4 w-4 text-amber-500" />
                Suivi parquet extérieur
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{suiviStats.total}</div>
              <p className="text-sm text-gray-500 mb-4">
                dossier{suiviStats.total > 1 ? 's' : ''} suivi{suiviStats.total > 1 ? 's' : ''}
              </p>

              <div className="space-y-3">
                <div className="flex items-center justify-between bg-blue-50 p-2.5 rounded-lg border border-blue-200">
                  <div className="flex items-center gap-2">
                    <Flag className="h-3.5 w-3.5 text-blue-600" />
                    <span className="text-sm font-medium text-blue-800">JIRS</span>
                  </div>
                  <span className="text-lg font-bold text-blue-700">{suiviStats.jirs.length}</span>
                </div>
                <div className="flex items-center justify-between bg-purple-50 p-2.5 rounded-lg border border-purple-200">
                  <div className="flex items-center gap-2">
                    <Flag className="h-3.5 w-3.5 text-purple-600" />
                    <span className="text-sm font-medium text-purple-800">Parquet Général</span>
                  </div>
                  <span className="text-lg font-bold text-purple-700">{suiviStats.pg.length}</span>
                </div>
                {suiviStats.both.length > 0 && (
                  <div className="text-xs text-gray-500 text-center pt-1 border-t">
                    dont {suiviStats.both.length} suivi{suiviStats.both.length > 1 ? 's' : ''} par les deux
                  </div>
                )}
              </div>

              {/* Liste des dossiers */}
              <div className="mt-4 pt-3 border-t space-y-1">
                <p className="text-xs font-medium text-gray-500 mb-1.5">Dossiers concernés :</p>
                {[...new Map([...suiviStats.jirs, ...suiviStats.pg].map(e => [e.id, e])).values()].map(e => {
                  const isJIRS = e.tags.some(t => t.category === 'suivi' && t.value === 'JIRS');
                  const isPG = e.tags.some(t => t.category === 'suivi' && t.value === 'PG');
                  return (
                    <div key={e.id} className="flex items-center justify-between text-xs">
                      <span className="text-gray-700 truncate mr-2">{e.numero}</span>
                      <div className="flex gap-1 flex-shrink-0">
                        {isJIRS && (
                          <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-medium">JIRS</span>
                        )}
                        {isPG && (
                          <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[10px] font-medium">PG</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Carte Enquêtes en cours */}
        <Card>
          <CardHeader>
            <CardTitle>Nombre d'enquêtes en cours</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{allEnquetesEnCours.length}</div>
            <p className="text-sm text-gray-500 mb-4">enquête{allEnquetesEnCours.length > 1 ? 's' : ''} en cours au total</p>

            {/* Subdivision par contentieux */}
            {isGlobal && contentieuxStats && contentieuxStats.length > 0 && (
              <div className="mb-4 p-3 bg-gray-50 rounded-md">
                <p className="text-xs font-medium text-gray-500 mb-2">Par contentieux</p>
                <div className="space-y-1">
                  {contentieuxStats.filter(s => s.enCours > 0).map(s => (
                    <div key={s.def.id} className="flex justify-between items-center text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.def.color }} />
                        <span className="text-gray-700">{s.def.label}</span>
                      </div>
                      <span className="font-semibold">{s.enCours}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-blue-50 p-3 rounded-md mb-4">
              <div className="text-sm font-medium text-blue-800">Ouvertes depuis le début de l'année {selectedYear}</div>
              <div className="text-2xl font-bold text-blue-700">{enquetesOuvertesAnnee.length}</div>
            </div>

            <div className="pt-3 border-t">
              <p className="text-sm font-medium mb-2">Ouvertures par mois ({selectedYear})</p>
              <div className="space-y-1">
                {getMonthsToShow().map(month => {
                  const count = enquetesOuvertesAnnee.filter(e =>
                    new Date(e.dateCreation).getMonth() === month
                  ).length;
                  return (
                    <div key={month} className="flex justify-between text-sm">
                      <span>{new Date(selectedYear, month).toLocaleString('default', { month: 'long' })}</span>
                      <span className="font-medium">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Carte Déférements */}
        <Card>
          <CardHeader>
            <CardTitle>Évolution des déférements</CardTitle>
            <p className="text-sm text-gray-500">Toutes enquêtes confondues</p>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold mb-4">
              {totalDeferementsYear}
              <span className="text-base font-normal text-gray-500 ml-2">déférement{totalDeferementsYear > 1 ? 's' : ''} en {selectedYear}</span>
            </div>
            {(() => {
              const monthsToShow = getMonthsToShow();

              // Mode global : une courbe par contentieux
              if (isGlobal && contentieuxStats && contentieuxStats.filter(s => s.totalDeferements > 0).length > 0) {
                const activeStats = contentieuxStats.filter(s => s.totalDeferements > 0);
                return (
                  <>
                    <div style={{ width: '100%', height: '300px' }}>
                      <Line
                        data={{
                          labels: monthsToShow.map(month =>
                            new Date(selectedYear, month).toLocaleString('default', { month: 'short' })
                          ),
                          datasets: activeStats.map(s => ({
                            label: s.def.label,
                            data: monthsToShow.map(month => s.deferementsParMois[month] || 0),
                            borderColor: s.def.color,
                            backgroundColor: s.def.color + '20',
                            tension: 0.3,
                            fill: false,
                            borderWidth: 2,
                            pointRadius: 3,
                          })),
                        }}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          scales: {
                            y: { beginAtZero: true, ticks: { stepSize: 1 } }
                          },
                          plugins: {
                            legend: { display: false },
                            datalabels: { display: false },
                          }
                        }}
                      />
                    </div>
                    <div className="flex flex-wrap justify-center gap-3 mt-3">
                      {activeStats.map(s => (
                        <div key={s.def.id} className="flex items-center gap-1.5 text-xs">
                          <div className="w-3 h-1 rounded" style={{ backgroundColor: s.def.color }} />
                          <span>{s.def.label}</span>
                          <span className="font-semibold">({s.totalDeferements})</span>
                        </div>
                      ))}
                    </div>
                  </>
                );
              }

              // Mode individuel : courbe simple
              const deferementsDetailParMois = monthsToShow.map(month => {
                const dossiers: string[] = [];
                Object.values(scopedResultats).forEach(r => {
                  const enquete = enquetes.find(e => e.id === r.enqueteId);
                  const dossierLabel = enquete?.numero || r.numeroAudience || `#${r.enqueteId}`;
                  if (r.nombreDeferes && r.dateDefere) {
                    const date = new Date(r.dateDefere);
                    if (date.getFullYear() === selectedYear && date.getMonth() === month) {
                      for (let i = 0; i < r.nombreDeferes; i++) dossiers.push(dossierLabel);
                    }
                  } else {
                    r.condamnations.forEach(c => {
                      if (!c.defere) return;
                      const dateRef = c.dateDefere || r.dateAudience;
                      const date = new Date(dateRef);
                      if (date.getFullYear() === selectedYear && date.getMonth() === month) {
                        dossiers.push(c.nom ? `${dossierLabel} (${c.nom})` : dossierLabel);
                      }
                    });
                  }
                });
                return { count: dossiers.length, dossiers };
              });

              return (
                <div style={{ width: '100%', height: '300px' }}>
                  <Line
                    data={{
                      labels: monthsToShow.map(month =>
                        new Date(selectedYear, month).toLocaleString('default', { month: 'long' })
                      ),
                      datasets: [{
                        label: 'Déférements',
                        data: deferementsDetailParMois.map(d => d.count),
                        borderColor: '#3498db',
                        backgroundColor: 'rgba(52, 152, 219, 0.1)',
                        tension: 0.3,
                        fill: true
                      }]
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      scales: {
                        y: { beginAtZero: true, ticks: { stepSize: 1 } }
                      },
                      plugins: {
                        legend: { display: false },
                        datalabels: { display: false },
                        tooltip: {
                          callbacks: {
                            afterBody: (tooltipItems) => {
                              const index = tooltipItems[0]?.dataIndex;
                              if (index === undefined) return '';
                              const detail = deferementsDetailParMois[index];
                              if (!detail || detail.dossiers.length === 0) return '';
                              return ['', 'Dossiers :', ...detail.dossiers.map(d => `  • ${d}`)];
                            }
                          }
                        }
                      }
                    }}
                  />
                </div>
              );
            })()}
          </CardContent>
        </Card>
      </div>

      {/* Comparatif N/N-1 */}
      {comparison.hasPrevData && (
        <Card>
          <CardHeader>
            <CardTitle>Comparatif {prevYear} / {selectedYear}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="text-center p-3 bg-gray-50 rounded-lg">
                <div className="text-xs text-gray-500 mb-1">Procédures terminées</div>
                <div className="text-sm text-gray-400">{prevYear}: {comparison.prevTotalTerminees}</div>
                <div className="text-lg font-bold">{selectedYear}: {comparison.currentTotalTerminees}</div>
                <DiffBadge diff={comparison.diffTerminees} />
              </div>
              <div className="text-center p-3 bg-gray-50 rounded-lg">
                <div className="text-xs text-gray-500 mb-1">Condamnations</div>
                <div className="text-sm text-gray-400">{prevYear}: {comparison.prevCondamnations}</div>
                <div className="text-lg font-bold">{selectedYear}: {comparison.currentCondamnations}</div>
                <DiffBadge diff={comparison.diffCondamnations} />
              </div>
              <div className="text-center p-3 bg-gray-50 rounded-lg">
                <div className="text-xs text-gray-500 mb-1">Prison ferme (mois)</div>
                <div className="text-sm text-gray-400">{prevYear}: {comparison.prevPrison}</div>
                <div className="text-lg font-bold">{selectedYear}: {comparison.currentPrison}</div>
                <DiffBadge diff={comparison.diffPrison} suffix=" mois" />
              </div>
              <div className="text-center p-3 bg-gray-50 rounded-lg">
                <div className="text-xs text-gray-500 mb-1">Amendes totales</div>
                <div className="text-sm text-gray-400">{prevYear}: {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(comparison.prevAmendes)}</div>
                <div className="text-lg font-bold">{selectedYear}: {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(comparison.currentAmendes)}</div>
                <DiffBadge diff={comparison.diffAmendes} suffix=" EUR" />
              </div>
              <div className="text-center p-3 bg-gray-50 rounded-lg">
                <div className="text-xs text-gray-500 mb-1">Déférements</div>
                <div className="text-sm text-gray-400">{prevYear}: {comparison.prevDeferements}</div>
                <div className="text-lg font-bold">{selectedYear}: {comparison.currentDeferements}</div>
                <DiffBadge diff={comparison.diffDeferements} />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Répartition globale par service */}
      <Card className="col-span-full">
        <CardHeader>
          <CardTitle>Répartition globale par service ({selectedYear})</CardTitle>
          <p className="text-sm text-gray-500">Enquêtes en cours et enquêtes terminées</p>
        </CardHeader>
        <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="flex flex-wrap gap-4">
            {Object.entries(sortedCombinedServiceStats).map(([service, count]) => (
              <div
                key={service}
                className="flex items-center gap-2 min-w-[200px] bg-gray-50 p-2 rounded"
              >
                <div
                  className="w-3 h-3 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: serviceColors[service] }}
                />
                <span className="text-sm flex-grow whitespace-nowrap">{service}</span>
                <span className="font-bold">{count}</span>
              </div>
            ))}
          </div>
          <div className="h-[300px] flex items-center justify-center">
            <Pie
              data={{
                labels: Object.keys(sortedCombinedServiceStats),
                datasets: [{
                  data: Object.values(sortedCombinedServiceStats),
                  backgroundColor: Object.keys(sortedCombinedServiceStats).map(service => serviceColors[service])
                }]
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    callbacks: {
                      label: (context) => {
                        const value = context.raw as number;
                        const total = Object.values(sortedCombinedServiceStats).reduce((a, b) => a + b, 0);
                        const percentage = ((value / total) * 100).toFixed(1);
                        return `${context.label}: ${value} (${percentage}%)`;
                      }
                    }
                  },
                  datalabels: {
                    color: '#fff',
                    font: { weight: 'bold', size: 11 },
                    formatter: (value: number) => {
                      const total = Object.values(sortedCombinedServiceStats).reduce((a, b) => a + b, 0);
                      const percentage = ((value / total) * 100).toFixed(0);
                      if (value < 2) return '';
                      return `${value}\n${percentage}%`;
                    },
                    anchor: 'center', align: 'center', offset: 0
                  }
                },
                layout: { padding: { top: 20, bottom: 20, left: 20, right: 20 } }
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Répartition par service des enquêtes terminées */}
      <Card className="col-span-full">
        <CardHeader>
          <CardTitle>Répartition par service des enquêtes terminées ({selectedYear})</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="flex flex-wrap gap-4">
            <TooltipProvider>
              {Object.entries(sortedTerminatedServiceStats).map(([service, count]) => {
                const enquetesForService = enquetesTerminees.filter(e => {
                  const servicesFromTags = getServicesFromTags(e.tags);
                  return servicesFromTags.includes(service);
                });
                const directResultsForService = Object.values(scopedResultats)
                  .filter(r => r.isDirectResult &&
                               r.service === service &&
                               new Date(r.dateAudience).getFullYear() === selectedYear);
                return (
                  <TooltipRoot key={service} delayDuration={300}>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-2 min-w-[200px] bg-gray-50 p-2 rounded hover:bg-gray-100 cursor-help transition-colors">
                        <div className="w-3 h-3 flex-shrink-0 rounded-full" style={{ backgroundColor: serviceColors[service] }} />
                        <span className="text-sm flex-grow whitespace-nowrap">{service}</span>
                        <span className="font-bold">{count}</span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-md max-h-96 overflow-y-auto">
                      <div className="space-y-2">
                        <p className="font-semibold mb-2">{service} - Enquêtes terminées :</p>
                        {enquetesForService.length > 0 && (
                          <div className="space-y-1">
                            <p className="text-xs font-medium text-gray-300 mb-1">Enquêtes préliminaires :</p>
                            {enquetesForService.map(e => {
                              const audienceResult = Object.values(scopedResultats).find(r => r.enqueteId === e.id);
                              return (
                                <div key={e.id} className="text-xs">
                                  {e.numero} - {audienceResult?.dateAudience ?
                                    new Date(audienceResult.dateAudience).toLocaleDateString('fr-FR') :
                                    'Date inconnue'}
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {directResultsForService.length > 0 && (
                          <div className="space-y-1 mt-2">
                            <p className="text-xs font-medium text-gray-300 mb-1">CRPC/Déférés :</p>
                            {directResultsForService.map((r, idx) => (
                              <div key={`direct-${idx}`} className="text-xs">
                                {r.numeroAudience || 'N/A'} - {new Date(r.dateAudience).toLocaleDateString('fr-FR')}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </TooltipContent>
                  </TooltipRoot>
                );
              })}
            </TooltipProvider>
          </div>
          <div className="h-[300px] flex items-center justify-center">
            <Pie
              data={{
                labels: Object.keys(sortedTerminatedServiceStats),
                datasets: [{
                  data: Object.values(sortedTerminatedServiceStats),
                  backgroundColor: Object.keys(sortedTerminatedServiceStats).map(service => serviceColors[service])
                }]
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    callbacks: {
                      label: (context) => {
                        const value = context.raw as number;
                        const total = Object.values(sortedTerminatedServiceStats).reduce((a, b) => a + b, 0);
                        const percentage = ((value / total) * 100).toFixed(1);
                        return `${context.label}: ${value} (${percentage}%)`;
                      }
                    }
                  },
                  datalabels: {
                    color: '#fff',
                    font: { weight: 'bold', size: 11 },
                    formatter: (value: number) => {
                      const total = Object.values(sortedTerminatedServiceStats).reduce((a, b) => a + b, 0);
                      const percentage = ((value / total) * 100).toFixed(0);
                      if (value < 2) return '';
                      return `${value}\n${percentage}%`;
                    },
                    anchor: 'center', align: 'center', offset: 0
                  }
                },
                layout: { padding: { top: 20, bottom: 20, left: 20, right: 20 } }
              }}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
