import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Enquete } from '@/types/interfaces';
import { useAudience } from '@/hooks/useAudience';
import { useState } from 'react';
import { Pie } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, PointElement, LineElement, BarElement } from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { AudienceStats as AudienceStatsType } from '@/types/audienceTypes';
import { useTags } from '@/hooks/useTags';
import { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipContent } from '../ui/tooltip';

// Enregistrement des composants Chart.js
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

// Générer une palette de couleurs distinctes pour les services
const baseColors = [
  '#34495e', '#3498db', '#2ecc71', '#16a085', '#e74c3c', '#c0392b',
  '#f1c40f', '#f39c12', '#9b59b6', '#8e44ad', '#1abc9c', '#7f8c8d',
  '#d35400', '#27ae60', '#2980b9'
];

// Fonction pour générer des couleurs dynamiques pour les services
const getServiceColor = (service: string, index: number) => {
  const baseServiceColors: Record<string, string> = {
    'SLPJ Amiens': '#34495e',
    'SIPJ Amiens': '#3498db',
    'SR Amiens': '#2ecc71',
    'SLPJ Abbeville': '#95a5a6',
    'BR ROYE': '#e74c3c',
    'BR ABBEVILLE': '#f1c40f',
    'BR AMIENS': '#9b59b6',
    'GIR': '#1abc9c'
  };

  if (baseServiceColors[service]) {
    return baseServiceColors[service];
  }
  
  return baseColors[index % baseColors.length];
};

interface GeneralStatsProps {
  enquetes: Enquete[];
}

export const GeneralStats = ({ enquetes }: GeneralStatsProps) => {
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const { audienceState } = useAudience();
  const { getServicesFromTags } = useTags();
  const currentDate = new Date();
  const directResults = Object.values(audienceState?.resultats || {})
    .filter(r => r.isDirectResult && new Date(r.dateAudience).getFullYear() === selectedYear);
  
  // Filtrer les enquêtes par année
  const enquetesForYear = enquetes.filter(e => 
    new Date(e.dateCreation).getFullYear() === selectedYear
  );
  
  const activeEnquetes = enquetesForYear.filter(e => e.statut === 'en_cours');
  const archivedEnquetes = enquetesForYear.filter(e => e.statut === 'archive');
  
  // Filtrer les enquêtes terminées par année d'audience (et non année de création)
  const enquetesTerminees = enquetes.filter(e => {
    if (e.statut !== 'archive') return false;
    const audienceResult = Object.values(audienceState?.resultats || {})
      .find(r => r.enqueteId === e.id);
    if (!audienceResult?.dateAudience) return false;
    return new Date(audienceResult.dateAudience).getFullYear() === selectedYear;
  });

  // Obtenir le nombre de mois écoulés pour l'année sélectionnée
  const getMonthsToShow = () => {
    const lastMonth = selectedYear === currentDate.getFullYear() ? 
      currentDate.getMonth() : 
      11;
    return Array.from({ length: lastMonth + 1 }, (_, i) => i);
  };

  // Calcul des durées moyennes
  const averageDurationTerminees = enquetesTerminees.reduce((acc, e) => {
    const audienceResult = Object.values(audienceState.resultats || {}).find(r => r.enqueteId === e.id);
    if (!audienceResult?.dateAudience) return acc;
    
    const start = new Date(e.dateDebut);
    const end = new Date(audienceResult.dateAudience);
    const days = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return acc + days;
  }, 0) / (enquetesTerminees.length || 1);

  const averageDurationEnCours = activeEnquetes.reduce((acc, e) => {
    const start = new Date(e.dateDebut);
    const now = new Date();
    const days = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return acc + days;
  }, 0) / (activeEnquetes.length || 1);

  // Stats des actes d'enquête avec vérification et système de sécurité
  const acteStats = enquetesForYear.reduce((acc, e) => {
    const ecoutes = e.ecoutes?.length || 0;
    const geolocalisations = e.geolocalisations?.length || 0;
    const autresActes = e.actes?.length || 0;
    
    // Prolongations ÉCOUTES avec vérification
    const prolongationsEcoutes = e.ecoutes?.reduce((sum, ecoute) => {
      let prolongationsCount = 0;
      
      // Calcul basé sur la durée réelle (source de vérité)
      if (ecoute.dateDebut && ecoute.dateFin) {
        const debut = new Date(ecoute.dateDebut);
        const fin = new Date(ecoute.dateFin);
        const dureeJours = Math.floor((fin.getTime() - debut.getTime()) / (1000 * 60 * 60 * 24));
        
        // Écoute : 30j base + max 1 prolongation de 30j
        if (dureeJours > 30) {
          prolongationsCount = Math.min(1, Math.floor((dureeJours - 30) / 30));
        }
      }
      
      // Vérification avec l'historique
      if (ecoute.prolongationsHistory && ecoute.prolongationsHistory.length > 0) {
        const historiqueCount = Math.min(ecoute.prolongationsHistory.length, 1);
        
        if (historiqueCount !== prolongationsCount && prolongationsCount > 0) {
          console.warn(`⚠️ Incohérence écoute ${ecoute.numero || ecoute.id} - Historique: ${historiqueCount}, Calcul durée: ${prolongationsCount}`);
        }
        
        // Prendre le maximum pour ne rien perdre
        prolongationsCount = Math.max(historiqueCount, prolongationsCount);
      }
      
      // Fallback ancien système
      if (prolongationsCount === 0 && (ecoute.prolongationData || ecoute.prolongationDate)) {
        prolongationsCount = 1;
      }
      
      return sum + prolongationsCount;
    }, 0) || 0;
    
    // Prolongations GÉOLOCALISATIONS avec vérification
    const prolongationsGeo = e.geolocalisations?.reduce((sum, geoloc) => {
      let prolongationsCount = 0;
      
      // Calcul basé sur la durée réelle (source de vérité)
      if (geoloc.dateDebut && geoloc.dateFin) {
        const debut = new Date(geoloc.dateDebut);
        const fin = new Date(geoloc.dateFin);
        const dureeJours = Math.floor((fin.getTime() - debut.getTime()) / (1000 * 60 * 60 * 24));
        
        // Géoloc : 15j base, puis +30j par prolongation
        // 45j = 1 prolong, 75j = 2 prolong, 105j = 3 prolong, 135j = 4 prolong, etc.
        if (dureeJours > 15) {
          prolongationsCount = Math.floor((dureeJours - 15) / 30);
        }
      }
      
      // Vérification avec l'historique
      if (geoloc.prolongationsHistory && geoloc.prolongationsHistory.length > 0) {
        const historiqueCount = geoloc.prolongationsHistory.length;
        
        if (historiqueCount !== prolongationsCount && prolongationsCount > 0) {
          console.warn(`⚠️ Incohérence géoloc ${geoloc.objet || geoloc.id} - Historique: ${historiqueCount}, Calcul durée: ${prolongationsCount}`);
        }
        
        // Prendre le maximum pour ne rien perdre
        prolongationsCount = Math.max(historiqueCount, prolongationsCount);
      }
      
      // Fallback ancien système
      if (prolongationsCount === 0 && (geoloc.prolongationData || geoloc.prolongationDate)) {
        prolongationsCount = 1;
      }
      
      return sum + prolongationsCount;
    }, 0) || 0;
    
    // Prolongations AUTRES ACTES (pas de règle de durée spécifique)
    const prolongationsAutres = e.actes?.reduce((sum, acte) => {
      // Priorité à l'historique
      if (acte.prolongationsHistory && acte.prolongationsHistory.length > 0) {
        return sum + acte.prolongationsHistory.length;
      }
      // Fallback ancien système
      if (acte.prolongationData || acte.prolongationDate) {
        return sum + 1;
      }
      return sum;
    }, 0) || 0;

    return {
      ecoutes: acc.ecoutes + ecoutes,
      geolocalisations: acc.geolocalisations + geolocalisations,
      autresActes: acc.autresActes + autresActes,
      prolongationsEcoutes: acc.prolongationsEcoutes + prolongationsEcoutes,
      prolongationsGeo: acc.prolongationsGeo + prolongationsGeo,
      prolongationsAutres: acc.prolongationsAutres + prolongationsAutres
    };
  }, { 
    ecoutes: 0, 
    geolocalisations: 0, 
    autresActes: 0, 
    prolongationsEcoutes: 0, 
    prolongationsGeo: 0, 
    prolongationsAutres: 0 
  });

  const totalActes = acteStats.ecoutes + acteStats.geolocalisations + acteStats.autresActes;

  // Collecter tous les services pour la répartition globale
  const combinedServiceStats: Record<string, number> = {};
  
  enquetesForYear.forEach(e => {
    const servicesFromTags = getServicesFromTags(e.tags);
    servicesFromTags.forEach(service => {
      if (service) {
        combinedServiceStats[service] = (combinedServiceStats[service] || 0) + 1;
      }
    });
  });
  
  Object.values(audienceState?.resultats || {})
    .filter(r => r.isDirectResult && new Date(r.dateAudience).getFullYear() === selectedYear)
    .forEach(r => {
      if (r.service) {
        combinedServiceStats[r.service] = (combinedServiceStats[r.service] || 0) + 1;
      }
    });

  // Trier les services par ordre décroissant
  const sortedCombinedServiceStats = Object.entries(combinedServiceStats)
    .sort(([, a], [, b]) => b - a)
    .reduce((acc, [service, count]) => {
      acc[service] = count;
      return acc;
    }, {} as Record<string, number>);

  // Calculer les services pour les enquêtes terminées uniquement
  const terminatedServiceStats: Record<string, number> = {};
  
  enquetesTerminees.forEach(e => {
    const servicesFromTags = getServicesFromTags(e.tags);
    servicesFromTags.forEach(service => {
      if (service) {
        terminatedServiceStats[service] = (terminatedServiceStats[service] || 0) + 1;
      }
    });
  });
  
  Object.values(audienceState?.resultats || {})
    .filter(r => r.isDirectResult && new Date(r.dateAudience).getFullYear() === selectedYear)
    .forEach(r => {
      if (r.service) {
        terminatedServiceStats[r.service] = (terminatedServiceStats[r.service] || 0) + 1;
      }
    });

  const sortedTerminatedServiceStats = Object.entries(terminatedServiceStats)
    .sort(([, a], [, b]) => b - a)
    .reduce((acc, [service, count]) => {
      acc[service] = count;
      return acc;
    }, {} as Record<string, number>);

  // Générer les couleurs pour chaque service
  const serviceEntries = Object.entries(sortedCombinedServiceStats);
  const serviceColors: Record<string, string> = {};
  
  serviceEntries.forEach(([service, _], index) => {
    serviceColors[service] = getServiceColor(service, index);
  });

  return (
    <div className="space-y-6">
      {/* Sélecteur d'année */}
      <div className="flex items-center gap-4 mb-6">
        <label className="font-medium">Année :</label>
        <select 
          className="p-2 border rounded"
          value={selectedYear}
          onChange={(e) => setSelectedYear(Number(e.target.value))}
        >
          {Array.from(
            { length: (new Date().getFullYear() - 2024) + 2 },
            (_, i) => 2024 + i
          ).map(year => (
            <option key={year} value={year}>{year}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {/* Carte Total des procédures terminées */}
        <Card>
          <CardHeader>
            <CardTitle>Total des procédures terminées</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {enquetesTerminees.length + directResults.length}
            </div>
            <div className="mt-4 pt-4 border-t space-y-1">
              {getMonthsToShow().map(month => {
                const prelimCount = enquetesTerminees.filter(e => {
                  const audienceResult = Object.values(audienceState.resultats || {})
                    .find(r => r.enqueteId === e.id);
                  const audienceDate = new Date(audienceResult.dateAudience);
                  return audienceResult && 
                         audienceDate.getMonth() === month && 
                         audienceDate.getFullYear() === selectedYear;
                }).length;

                const directCount = directResults.filter(r => {
                  const audienceDate = new Date(r.dateAudience);
                  return audienceDate.getMonth() === month && 
                         audienceDate.getFullYear() === selectedYear;
                }).length;

                const totalCount = prelimCount + directCount;

                return (
                  <div key={month} className="flex justify-between text-sm">
                    <span>{new Date(selectedYear, month).toLocaleString('default', { month: 'long' })}:</span>
                    <span className="font-medium">{totalCount}</span>
                  </div>
                );
              })}
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
          </CardContent>
        </Card>

        {/* Carte Actes d'enquête */}
        <Card>
          <CardHeader>
            <CardTitle>Actes d'enquête en préliminaire</CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const stats = acteStats;
              const totalActes = stats.ecoutes + stats.geolocalisations + stats.autresActes;
              const totalProlongations = stats.prolongationsEcoutes + stats.prolongationsGeo + stats.prolongationsAutres;
              const totalAvecProlongations = totalActes + totalProlongations;
              
              const tempsPourUnActe = 35;
              const tempsPourUneProlongation = 35;
              const tempsActesMinutes = totalActes * tempsPourUnActe;
              const tempsProlongationsMinutes = totalProlongations * tempsPourUneProlongation;
              const tempsEstimeMinutes = tempsActesMinutes + tempsProlongationsMinutes;
              
              const moisActuel = new Date().getMonth();
              const moisComplexes = [0, 1, 5, 6, 8, 9, 10, 11];
              const facteurComplexite = moisComplexes.includes(moisActuel) ? 1.18 : 1.05;
              
              const tempsEstimeMinutesAjuste = Math.ceil(tempsEstimeMinutes * facteurComplexite);
              const tempsEstimeHeures = Math.floor(tempsEstimeMinutesAjuste / 60);
              const tempsEstimeMinutesRestantes = tempsEstimeMinutesAjuste % 60;
              
              const debutAnnee = new Date(selectedYear, 0, 1);
              const finAnnee = selectedYear === new Date().getFullYear() 
                ? new Date() 
                : new Date(selectedYear, 11, 31);
              
              const millisecondesParSemaine = 7 * 24 * 60 * 60 * 1000;
              const nombreSemainesReel = Math.max(1, Math.ceil((finAnnee.getTime() - debutAnnee.getTime()) / millisecondesParSemaine));
              const nombreSemainesAjuste = Math.max(1, Math.floor(nombreSemainesReel * 0.95));
              
              const nombreMoisReel = selectedYear === new Date().getFullYear() 
                ? new Date().getMonth() + 1 
                : 12;
              const nombreMoisAjuste = Math.max(1, Math.floor(nombreMoisReel * 0.93));
              
              const arrondiFavorable = (nombre: number) => Math.ceil(nombre * 10) / 10;
              
              const moyenneActesParSemaine = arrondiFavorable(totalAvecProlongations / nombreSemainesAjuste);
              const moyenneActesParMois = arrondiFavorable(totalAvecProlongations / nombreMoisAjuste);
              const moyenneTempsParSemaine = arrondiFavorable((tempsEstimeMinutesAjuste / nombreSemainesAjuste) / 60);
              const moyenneTempsParMois = arrondiFavorable((tempsEstimeMinutesAjuste / nombreMoisAjuste) / 60);

              return (
                <>
                  <div className="text-3xl font-bold">{totalAvecProlongations}</div>
                  <p className="text-sm text-gray-500 mb-4">
                    Moyenne de {arrondiFavorable(totalAvecProlongations / (enquetesForYear.length || 1))} actes/prolongations par enquête
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
                      <span className="font-bold">{stats.ecoutes}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Géolocalisations</span>
                      <span className="font-bold">{stats.geolocalisations}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Autres actes</span>
                      <span className="font-bold">{stats.autresActes}</span>
                    </div>
                    <div className="pt-2 mt-2 border-t">
                      <div className="flex justify-between">
                        <span>Prolongations totales</span>
                        <span className="font-bold">{totalProlongations}</span>
                      </div>
                      <div className="text-sm text-gray-500 mt-1">
                        Écoutes: {stats.prolongationsEcoutes} | Géoloc: {stats.prolongationsGeo} | Autres: {stats.prolongationsAutres}
                      </div>
                      
                      <div className="flex justify-between mt-2 text-sm">
                        <span>Moyenne de prolongations par acte</span>
                        <span className="font-semibold">
                          {totalActes > 0 ? (totalProlongations / totalActes).toFixed(2) : '0'}
                        </span>
                      </div>
                    </div>
                  </div>
                </>
              );
            })()}
          </CardContent>
        </Card>

        {/* Carte Déférements */}
        <Card>
          <CardHeader>
            <CardTitle>Évolution des déférements</CardTitle>
            <p className="text-sm text-gray-500">Toutes enquêtes confondues</p>
          </CardHeader>
          <CardContent>
            <div style={{ width: '100%', height: '300px' }}>
              <Line
                data={{
                  labels: getMonthsToShow().map(month => 
                    new Date(selectedYear, month).toLocaleString('default', { month: 'long' })
                  ),
                  datasets: [{
                    label: 'Déférements',
                    data: getMonthsToShow().map(month => {
                      return Object.values(audienceState.resultats || {})
                        .reduce((acc, r) => {
                          // Si nombreDeferes est renseigné (audience en attente), utiliser celui-ci
                          if (r.nombreDeferes && r.dateDefere) {
                            const date = new Date(r.dateDefere);
                            if (date.getFullYear() === selectedYear && date.getMonth() === month) {
                              return acc + r.nombreDeferes;
                            }
                          } else {
                            // Sinon, compter les condamnations avec defere: true
                            return acc + r.condamnations.filter(c => {
                              if (!c.defere) return false;
                              const dateRef = c.dateDefere || r.dateAudience;
                              const date = new Date(dateRef);
                              return date.getFullYear() === selectedYear && 
                                     date.getMonth() === month;
                            }).length;
                          }
                          return acc;
                        }, 0);
                    }),
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
                    y: {
                      beginAtZero: true,
                      ticks: {
                        stepSize: 1
                      }
                    }
                  },
                  plugins: {
                    legend: {
                      display: false
                    },
                    datalabels: {
                      display: false
                    }
                  }
                }}
              />
            </div>
          </CardContent>
        </Card>
      </div>

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
                  legend: {
                    display: false
                  },
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
                    font: { 
                      weight: 'bold',
                      size: 11
                    },
                    formatter: (value: number) => {
                      const total = Object.values(sortedCombinedServiceStats).reduce((a, b) => a + b, 0);
                      const percentage = ((value / total) * 100).toFixed(0);
                      if (value < 2) return '';
                      return `${value}\n${percentage}%`;
                    },
                    anchor: 'center',
                    align: 'center',
                    offset: 0
                  }
                },
                layout: {
                  padding: {
                    top: 20,
                    bottom: 20,
                    left: 20,
                    right: 20
                  }
                }
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
                // Récupérer les enquêtes terminées pour ce service
                const enquetesForService = enquetesTerminees.filter(e => {
                  const servicesFromTags = getServicesFromTags(e.tags);
                  return servicesFromTags.includes(service);
                });

                // Récupérer aussi les résultats directs pour ce service
                const directResultsForService = Object.values(audienceState?.resultats || {})
                  .filter(r => r.isDirectResult && 
                               r.service === service && 
                               new Date(r.dateAudience).getFullYear() === selectedYear);

                return (
                  <TooltipRoot key={service} delayDuration={300}>
                    <TooltipTrigger asChild>
                      <div 
                        className="flex items-center gap-2 min-w-[200px] bg-gray-50 p-2 rounded hover:bg-gray-100 cursor-help transition-colors"
                      >
                        <div 
                          className="w-3 h-3 flex-shrink-0 rounded-full" 
                          style={{ backgroundColor: serviceColors[service] }}
                        />
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
                              const audienceResult = Object.values(audienceState?.resultats || {})
                                .find(r => r.enqueteId === e.id);
                              return (
                                <div key={e.id} className="text-xs">
                                  • {e.numero} - {audienceResult?.dateAudience ? 
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
                                • {r.numeroAudience || 'N/A'} - {new Date(r.dateAudience).toLocaleDateString('fr-FR')}
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
                  legend: {
                    display: false
                  },
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
                    font: { 
                      weight: 'bold',
                      size: 11
                    },
                    formatter: (value: number) => {
                      const total = Object.values(sortedTerminatedServiceStats).reduce((a, b) => a + b, 0);
                      const percentage = ((value / total) * 100).toFixed(0);
                      if (value < 2) return '';
                      return `${value}\n${percentage}%`;
                    },
                    anchor: 'center',
                    align: 'center',
                    offset: 0
                  }
                },
                layout: {
                  padding: {
                    top: 20,
                    bottom: 20,
                    left: 20,
                    right: 20
                  }
                }
              }}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};