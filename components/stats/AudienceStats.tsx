import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { useAudience } from '@/hooks/useAudience';
import { Enquete } from '@/types/interfaces';
import { AudienceStats as AudienceStatsType } from '@/types/audienceTypes';
import { getYearlyStats, getMonthlyStats } from '@/utils/audienceStats';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, PointElement, LineElement, BarElement } from 'chart.js';
import { Pie, Line, Bar } from 'react-chartjs-2';
import ChartDataLabels from 'chartjs-plugin-datalabels';

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

interface AudienceStatsProps {
  enquetes: Enquete[];
}

export const AudienceStats = ({ enquetes }: AudienceStatsProps) => {
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [yearlyStats, setYearlyStats] = useState<AudienceStatsType | null>(null);
  const [monthlyStats, setMonthlyStats] = useState<{ [key: number]: AudienceStatsType | null }>({});
  
  const { audienceState } = useAudience();
  const directResults = Object.values(audienceState?.resultats || {}).filter(r => r.isDirectResult);
  const currentDate = new Date();

  // Fonction pour obtenir les mois écoulés jusqu'au mois actuel
  const getMonthsToShow = () => {
    const lastMonth = selectedYear === currentDate.getFullYear() ? 
      currentDate.getMonth() : 
      11;
    return Array.from({ length: lastMonth + 1 }, (_, i) => i);
  };

  // Mise à jour des stats annuelles
  useEffect(() => {
    if (!audienceState?.resultats || !enquetes) {
      setYearlyStats(null);
      return;
    }

    const stats = getYearlyStats(audienceState.resultats, enquetes, selectedYear);
    setYearlyStats(stats);
  }, [audienceState?.resultats, selectedYear, enquetes]);

  // Mise à jour des stats mensuelles
  useEffect(() => {
    if (!audienceState?.resultats || !enquetes) return;

    const months = getMonthsToShow();
    const monthlyStatsData: { [key: number]: AudienceStatsType | null } = {};

    months.forEach(month => {
      const stats = getMonthlyStats(audienceState.resultats, enquetes, selectedYear, month);
      monthlyStatsData[month] = stats;
    });

    setMonthlyStats(monthlyStatsData);
  }, [audienceState?.resultats, selectedYear, enquetes]);

  if (!yearlyStats) {
    return (
      <Card>
        <CardContent>
          <p className="text-center py-4">Aucune donnée disponible pour l'année {selectedYear}</p>
        </CardContent>
      </Card>
    );
  }

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
        
        {/* Carte Orientation */}
        <Card>
          <CardHeader>
            <CardTitle>Orientation</CardTitle>
          </CardHeader>

          <CardContent className="space-y-4">
            <p className="text-sm text-gray-500">
              Correspond au nombre de fois où un juge a été mobilisé et aux classements sans suite.
            </p>
            <p className="text-xs text-gray-500">
              (Soit 1 fois par dossier pour une CI, une OI, une CDD ou un classement. Soit pour chaque prévenu pour une CRPC)
            </p>
            {/* Liste en haut */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#34495e' }} />
                  <span>CRPC</span>
                </div>
                <span className="font-bold">{yearlyStats.nombreCRPC}</span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#3498db' }} />
                  <span>CI</span>
                </div>
                <span className="font-bold">{yearlyStats.nombreCI}</span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#2ecc71' }} />
                  <span>COPJ</span>
                </div>
                <span className="font-bold">{yearlyStats.nombreCOPJ}</span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#95a5a6' }} />
                  <span>OI (ouverture d'info)</span>
                </div>
                <span className="font-bold">{yearlyStats.nombreOI}</span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#E8D0A9' }} />
                  <span>CDD</span>
                </div>
                <span className="font-bold">{yearlyStats.nombreCDD}</span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#e74c3c' }} />
                  <span>Classement sans suite</span>
                </div>
                <span className="font-bold">
                  {yearlyStats.nombreClassements || 0}
                </span>
              </div>
              <div className="pt-2 mt-2 border-t">
                <div className="flex justify-between">
                  <span>Dont déférements</span>
                  <span className="font-bold">{yearlyStats.nombreDeferements}</span>
                </div>
              </div>
            </div>

            {/* Graphique en bas */}
            <div className="h-[400px] mt-2">
              <Pie
                data={{
                  labels: ['CRPC', 'CI', 'COPJ', 'OI', 'CDD', 'Classement'],
                  datasets: [{
                    data: [
                      yearlyStats.nombreCRPC,
                      yearlyStats.nombreCI,
                      yearlyStats.nombreCOPJ,
                      yearlyStats.nombreOI,
                      yearlyStats.nombreCDD,
                      yearlyStats.nombreClassements || 0
                    ],
                    backgroundColor: [
                      '#34495e',
                      '#3498db',
                      '#2ecc71',
                      '#95a5a6',
                      '#E8D0A9',
                      '#e74c3c'
                    ]
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
                          const value = context.raw;
                          const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
                          const percentage = ((value / total) * 100).toFixed(1);
                          return ` ${context.label}: ${value} (${percentage}%)`;
                        }
                      }
                    },
                    datalabels: {
                      color: '#fff',
                      font: { 
                        weight: 'bold',
                        size: 11
                      },
                      formatter: (value: number, ctx: any) => {
                        const total = ctx.dataset.data.reduce((a: number, b: number) => a + b, 0);
                        const percentage = ((value / total) * 100).toFixed(0);
                        if (percentage < 5) return '';
                        return `${percentage}%`;
                      },
                      anchor: 'center',
                      align: 'center',
                      offset: 0
                    }
                  },
                  layout: {
                    padding: {
                      top: 0,
                      right: 0,
                      bottom: 0,
                      left: 0
                    }
                  }
                }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Carte Orientation par mois (Version verticale) */}
        <Card>
          <CardHeader>
            <CardTitle>Orientation par mois</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-6">
              {/* Premier trimestre */}
              <div style={{ width: '100%', height: '200px' }}>
                <Bar
                  data={{
                    labels: [0, 1, 2, 3].map(month => 
                      new Date(selectedYear, month).toLocaleString('default', { month: 'short' })
                    ),
                    datasets: [
                      {
                        label: 'CRPC',
                        data: [0, 1, 2, 3].map(month => 
                          monthlyStats[month]?.nombreCRPC || 0
                        ),
                        backgroundColor: '#34495e'
                      },
                      {
                        label: 'CI',
                        data: [0, 1, 2, 3].map(month => 
                          monthlyStats[month]?.nombreCI || 0
                        ),
                        backgroundColor: '#3498db'
                      },
                      {
                        label: 'COPJ',
                        data: [0, 1, 2, 3].map(month => 
                          monthlyStats[month]?.nombreCOPJ || 0
                        ),
                        backgroundColor: '#2ecc71'
                      },
                      {
                        label: 'OI',
                        data: [0, 1, 2, 3].map(month => 
                          monthlyStats[month]?.nombreOI || 0
                        ),
                        backgroundColor: '#95a5a6'
                      },
                      {
                        label: 'CDD',
                        data: [0, 1, 2, 3].map(month => 
                          monthlyStats[month]?.nombreCDD || 0
                        ),
                        backgroundColor: '#E8D0A9'
                      },
                      {
                        label: 'Classement',
                        data: [0, 1, 2, 3].map(month => {
                          return monthlyStats[month]?.nombreClassements || 0;
                        }),
                        backgroundColor: '#e74c3c'
                      }
                    ]
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                      x: {
                        stacked: true,
                        grid: { display: false }
                      },
                      y: {
                        stacked: true,
                        beginAtZero: true,
                        ticks: { stepSize: 5 },
                        grid: { color: '#f0f0f0' }
                      }
                    },
                    plugins: {
                      legend: {
                        display: false
                      },
                      datalabels: {
                        color: '#fff',
                        anchor: 'center',
                        align: 'center',
                        formatter: (value) => value || '',
                        font: { weight: 'bold' },
                        display: (context) => context.dataset.data[context.dataIndex] > 0
                      }
                    }
                  }}
                />
              </div>
              
              {/* Deuxième trimestre */}
              <div style={{ width: '100%', height: '200px' }}>
                <Bar
                  data={{
                    labels: [4, 5, 6, 7].map(month => 
                      new Date(selectedYear, month).toLocaleString('default', { month: 'short' })
                    ),
                    datasets: [
                      {
                        label: 'CRPC',
                        data: [4, 5, 6, 7].map(month => 
                          monthlyStats[month]?.nombreCRPC || 0
                        ),
                        backgroundColor: '#34495e'
                      },
                      {
                        label: 'CI',
                        data: [4, 5, 6, 7].map(month => 
                          monthlyStats[month]?.nombreCI || 0
                        ),
                        backgroundColor: '#3498db'
                      },
                      {
                        label: 'COPJ',
                        data: [4, 5, 6, 7].map(month => 
                          monthlyStats[month]?.nombreCOPJ || 0
                        ),
                        backgroundColor: '#2ecc71'
                      },
                      {
                        label: 'OI',
                        data: [4, 5, 6, 7].map(month => 
                          monthlyStats[month]?.nombreOI || 0
                        ),
                        backgroundColor: '#95a5a6'
                      },
                      {
                        label: 'CDD',
                        data: [4, 5, 6, 7].map(month => 
                          monthlyStats[month]?.nombreCDD || 0
                        ),
                        backgroundColor: '#E8D0A9'
                      },
                      {
                        label: 'Classement',
                        data: [4, 5, 6, 7].map(month => {
                          return monthlyStats[month]?.nombreClassements || 0;
                        }),
                        backgroundColor: '#e74c3c'
                      }
                    ]
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                      x: {
                        stacked: true,
                        grid: { display: false }
                      },
                      y: {
                        stacked: true,
                        beginAtZero: true,
                        ticks: { stepSize: 5 },
                        grid: { color: '#f0f0f0' }
                      }
                    },
                    plugins: {
                      legend: {
                        display: false
                      },
                      datalabels: {
                        color: '#fff',
                        anchor: 'center',
                        align: 'center',
                        formatter: (value) => value || '',
                        font: { weight: 'bold' },
                        display: (context) => context.dataset.data[context.dataIndex] > 0
                      }
                    }
                  }}
                />
              </div>
              
              {/* Troisième trimestre */}
              <div style={{ width: '100%', height: '200px' }}>
                <Bar
                  data={{
                    labels: [8, 9, 10, 11].map(month => 
                      new Date(selectedYear, month).toLocaleString('default', { month: 'short' })
                    ),
                    datasets: [
                      {
                        label: 'CRPC',
                        data: [8, 9, 10, 11].map(month => 
                          monthlyStats[month]?.nombreCRPC || 0
                        ),
                        backgroundColor: '#34495e'
                      },
                      {
                        label: 'CI',
                        data: [8, 9, 10, 11].map(month => 
                          monthlyStats[month]?.nombreCI || 0
                        ),
                        backgroundColor: '#3498db'
                      },
                      {
                        label: 'COPJ',
                        data: [8, 9, 10, 11].map(month => 
                          monthlyStats[month]?.nombreCOPJ || 0
                        ),
                        backgroundColor: '#2ecc71'
                      },
                      {
                        label: 'OI',
                        data: [8, 9, 10, 11].map(month => 
                          monthlyStats[month]?.nombreOI || 0
                        ),
                        backgroundColor: '#95a5a6'
                      },
                      {
                        label: 'CDD',
                        data: [8, 9, 10, 11].map(month => 
                          monthlyStats[month]?.nombreCDD || 0
                        ),
                        backgroundColor: '#E8D0A9'
                      },
                      {
                        label: 'Classement',
                        data: [8, 9, 10, 11].map(month => {
                          return monthlyStats[month]?.nombreClassements || 0;
                        }),
                        backgroundColor: '#e74c3c'
                      }
                    ]
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                      x: {
                        stacked: true,
                        grid: { display: false }
                      },
                      y: {
                        stacked: true,
                        beginAtZero: true,
                        ticks: { stepSize: 5 },
                        grid: { color: '#f0f0f0' }
                      }
                    },
                    plugins: {
                      legend: {
                        display: false
                      },
                      datalabels: {
                        color: '#fff',
                        anchor: 'center',
                        align: 'center',
                        formatter: (value) => value || '',
                        font: { weight: 'bold' },
                        display: (context) => context.dataset.data[context.dataIndex] > 0
                      }
                    }
                  }}
                />
              </div>
              
              {/* Légende commune */}
              <div className="flex justify-center items-center gap-4 flex-wrap mt-2">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#34495e' }} />
                  <span className="text-sm">CRPC</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#3498db' }} />
                  <span className="text-sm">CI</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#2ecc71' }} />
                  <span className="text-sm">COPJ</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#95a5a6' }} />
                  <span className="text-sm">OI</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#E8D0A9' }} />
                  <span className="text-sm">CDD</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#e74c3c' }} />
                  <span className="text-sm">Classement</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Carte Condamnations */}
        <Card>
          <CardHeader>
            <CardTitle>Condamnations</CardTitle>
            <p className="text-sm text-gray-500">Toutes enquêtes confondues</p>
          </CardHeader>
          <CardContent>
            {(() => {
              const totalCondamnations = Object.values(audienceState.resultats || {})
                .filter(r => new Date(r.dateAudience).getFullYear() === selectedYear)
                .reduce((acc, r) => acc + r.condamnations.length, 0);
              
              const totalAudiences = Object.values(audienceState.resultats || {})
                .filter(r => new Date(r.dateAudience).getFullYear() === selectedYear)
                .length;
              
              return (
                <>
                  <div className="text-3xl font-bold">{totalCondamnations}</div>
                  <p className="text-sm text-gray-500">
                    Moyenne de {totalAudiences > 0 ? (totalCondamnations / totalAudiences).toFixed(1) : 0} par audience
                  </p>
                  <div className="mt-4 pt-4 border-t space-y-1">
                    {getMonthsToShow().map(month => {
                      const condamnationsCount = Object.values(audienceState.resultats || {})
                        .filter(r => {
                          const dateAudience = new Date(r.dateAudience);
                          return dateAudience.getFullYear() === selectedYear && 
                                 dateAudience.getMonth() === month;
                        })
                        .reduce((acc, r) => acc + r.condamnations.length, 0);
                      
                      return (
                        <div key={month} className="flex justify-between text-sm">
                          <span>{new Date(selectedYear, month).toLocaleString('default', { month: 'long' })}:</span>
                          <span className="font-medium">{condamnationsCount}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}
          </CardContent>
        </Card>

       {/* Carte Total des peines de prison */}
<Card>
  <CardHeader>
    <CardTitle>Total des peines de prison</CardTitle>
    <p className="text-sm text-gray-500">Toutes enquêtes confondues</p>
    <p className="text-sm text-gray-400">(Uniquement l'emprisonnement ferme, que cela soit la partie ferme d'une peine mixte ou un peine ferme seule) </p>
  </CardHeader>
  <CardContent>
    <div className="text-3xl font-bold">{yearlyStats.totalPeinePrison} mois</div>
    <div className="text-sm text-gray-500 mt-1">
      {(() => {
        const annees = Math.floor(yearlyStats.totalPeinePrison / 12);
        const moisRestants = yearlyStats.totalPeinePrison % 12;
        
        if (annees > 0 && moisRestants > 0) {
          return `Soit ${annees} an${annees > 1 ? 's' : ''} et ${moisRestants} mois`;
        } else if (annees > 0) {
          return `Soit ${annees} an${annees > 1 ? 's' : ''}`;
        } else {
          return null;
        }
      })()}
    </div>
    
    <div className="mt-4 pt-4 border-t space-y-1">
      {getMonthsToShow().map(month => {
        const moisPrison = monthlyStats[month] ? monthlyStats[month]?.totalPeinePrison : 0;
        
        return (
          <div key={month} className="flex justify-between text-sm">
            <span>{new Date(selectedYear, month).toLocaleString('default', { month: 'long' })}:</span>
            <span className="font-medium">
              {moisPrison} mois
              {moisPrison >= 12 && (
                <span className="text-xs text-gray-500 ml-1">
                  ({Math.floor(moisPrison / 12)} an{Math.floor(moisPrison / 12) > 1 ? 's' : ''}{moisPrison % 12 > 0 ? ` ${moisPrison % 12} m` : ''})
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  </CardContent>
</Card>

{/* Carte Peines moyennes */}
<Card>
  <CardHeader>
    <CardTitle>Peines moyennes</CardTitle>
    <p className="text-sm text-gray-500">Toutes enquêtes confondues</p>
    <p className="text-sm text-gray-400">(peines moyennes prononcées en fonction du type de peine)</p>
  </CardHeader>
  <CardContent className="space-y-4">
    {(() => {
      // Calculer tous les comptages pour les pourcentages
      const allCondamnations = Object.values(audienceState.resultats || {})
        .filter(r => new Date(r.dateAudience).getFullYear() === selectedYear)
        .flatMap(r => r.condamnations);
      
      const totalCondamnations = allCondamnations.length;
      
      // Prison ferme uniquement
      const condamnationsFerme = allCondamnations.filter(c => 
        c.peinePrison > 0 && (!c.sursisProbatoire || c.sursisProbatoire === 0) && (!c.sursisSimple || c.sursisSimple === 0)
      );
      
      // Sursis probatoire uniquement
      const condamnationsProb = allCondamnations.filter(c => 
        (!c.peinePrison || c.peinePrison === 0) && c.sursisProbatoire > 0 && (!c.sursisSimple || c.sursisSimple === 0)
      );
      
      // Sursis simple uniquement
      const condamnationsSimple = allCondamnations.filter(c => 
        (!c.peinePrison || c.peinePrison === 0) && (!c.sursisProbatoire || c.sursisProbatoire === 0) && c.sursisSimple > 0
      );
      
      // Mixte avec sursis probatoire
      const condamnationsMixteProb = allCondamnations.filter(c => 
        c.peinePrison > 0 && c.sursisProbatoire > 0
      );
      
      // Mixte avec sursis simple
      const condamnationsMixteSimple = allCondamnations.filter(c => 
        c.peinePrison > 0 && c.sursisSimple > 0 && (!c.sursisProbatoire || c.sursisProbatoire === 0)
      );
      
      // Calcul des moyennes pour mixte probatoire
      const moyenneMixteProb = condamnationsMixteProb.length > 0 ? {
        ferme: condamnationsMixteProb.reduce((acc, c) => acc + (Number(c.peinePrison) || 0), 0) / condamnationsMixteProb.length,
        sursis: condamnationsMixteProb.reduce((acc, c) => acc + (Number(c.sursisProbatoire) || 0), 0) / condamnationsMixteProb.length
      } : { ferme: 0, sursis: 0 };
      
      // Calcul des moyennes pour mixte simple
      const moyenneMixteSimple = condamnationsMixteSimple.length > 0 ? {
        ferme: condamnationsMixteSimple.reduce((acc, c) => acc + (Number(c.peinePrison) || 0), 0) / condamnationsMixteSimple.length,
        sursis: condamnationsMixteSimple.reduce((acc, c) => acc + (Number(c.sursisSimple) || 0), 0) / condamnationsMixteSimple.length
      } : { ferme: 0, sursis: 0 };
      
      return (
        <div className="grid gap-3">
          <div>
            <div className="font-medium mb-1">Prison ferme uniquement</div>
            <div className="text-2xl font-bold">{yearlyStats.moyennePrison} mois</div>
            <div className="text-xs text-gray-500 mt-1">
              {condamnationsFerme.length} condamnation{condamnationsFerme.length > 1 ? 's' : ''} 
              ({totalCondamnations > 0 ? ((condamnationsFerme.length / totalCondamnations) * 100).toFixed(1) : 0}%)
            </div>
          </div>
          <div>
            <div className="font-medium mb-1">Sursis probatoire uniquement</div>
            <div className="text-2xl font-bold">{yearlyStats.moyenneProbation} mois</div>
            <div className="text-xs text-gray-500 mt-1">
              {condamnationsProb.length} condamnation{condamnationsProb.length > 1 ? 's' : ''} 
              ({totalCondamnations > 0 ? ((condamnationsProb.length / totalCondamnations) * 100).toFixed(1) : 0}%)
            </div>
          </div>
          <div>
            <div className="font-medium mb-1">Sursis simple uniquement</div>
            <div className="text-2xl font-bold">{yearlyStats.moyenneSimple} mois</div>
            <div className="text-xs text-gray-500 mt-1">
              {condamnationsSimple.length} condamnation{condamnationsSimple.length > 1 ? 's' : ''} 
              ({totalCondamnations > 0 ? ((condamnationsSimple.length / totalCondamnations) * 100).toFixed(1) : 0}%)
            </div>
          </div>
          <div>
            <div className="font-medium mb-1">Mixte avec sursis probatoire</div>
            <div className="text-2xl font-bold">
              {(moyenneMixteProb.ferme + moyenneMixteProb.sursis).toFixed(1)} dont {moyenneMixteProb.sursis.toFixed(1)} avec sursis probatoire
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {condamnationsMixteProb.length} condamnation{condamnationsMixteProb.length > 1 ? 's' : ''} 
              ({totalCondamnations > 0 ? ((condamnationsMixteProb.length / totalCondamnations) * 100).toFixed(1) : 0}%)
            </div>
          </div>
          <div>
            <div className="font-medium mb-1">Mixte avec sursis simple</div>
            <div className="text-lg">
              {(moyenneMixteSimple.ferme + moyenneMixteSimple.sursis).toFixed(1)} dont {moyenneMixteSimple.sursis.toFixed(1)} avec sursis simple
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {condamnationsMixteSimple.length} condamnation{condamnationsMixteSimple.length > 1 ? 's' : ''} 
              ({totalCondamnations > 0 ? ((condamnationsMixteSimple.length / totalCondamnations) * 100).toFixed(1) : 0}%)
            </div>
          </div>
        </div>
      );
    })()}
  </CardContent>
</Card>

        {/* Carte Amendes */}
        <Card>
          <CardHeader>
            <CardTitle>Amendes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })
                .format(yearlyStats.moyenneAmende)}
            </div>
            <p className="text-sm text-gray-500">Moyenne par condamnation</p>
            <div className="mt-4 pt-4 border-t space-y-1">
              {getMonthsToShow().map(month => (
                <div key={month} className="flex justify-between text-sm">
                  <span>{new Date(selectedYear, month).toLocaleString('default', { month: 'long' })}:</span>
                  <span className="font-medium">
                    {monthlyStats[month] ? 
                      new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })
                        .format(monthlyStats[month]?.montantTotalAmendes || 0) : 
                      '0 €'}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Carte Interdictions */}
        <Card>
          <CardHeader>
            <CardTitle>Interdictions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span>Interdictions de paraître</span>
                <span className="font-bold">{yearlyStats.totalInterdictionsParaitre}</span>
              </div>
              <div className="text-sm text-gray-500">
                {((yearlyStats.totalInterdictionsParaitre / yearlyStats.nombreCondamnations) * 100).toFixed(1)}% des condamnations
              </div>
            </div>
          </CardContent>
        </Card>


        {/* Carte Confiscations */}
<Card>
  <CardHeader>
    <CardTitle>Confiscations</CardTitle>
  </CardHeader>
  <CardContent>
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex justify-between">
          <span>Véhicules saisis</span>
          <span className="font-bold">{yearlyStats.totalVehicules}</span>
        </div>
        <div className="flex justify-between">
          <span>Immeubles saisis</span>
          <span className="font-bold">{yearlyStats.totalImmeubles}</span>
        </div>
        <div className="flex justify-between">
          <span>Montant total des confiscations</span>
          <span className="font-bold">
            {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })
              .format(yearlyStats.totalArgent)}
          </span>
        </div>
      </div>
      <div className="text-sm text-gray-500">
        Ratio de {yearlyStats.ratioConfiscations.toFixed(2)} saisies par condamnation
      </div>
    </div>
  </CardContent>
</Card>


        {/* Carte Peines moyennes par type d'infraction */}
        <Card className="col-span-full">
          <CardHeader>
            <CardTitle>Peines moyennes par type d'infraction (mois)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {yearlyStats.peinesParInfraction ? 
                Object.entries(yearlyStats.peinesParInfraction).map(([infraction, stats]) => (
                  <div key={infraction} className="bg-gray-50 p-4 rounded-lg">
                    <div className="font-medium mb-2">{infraction}</div>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span>Ferme :</span>
                        <span className="font-bold">{stats.moyenneFerme.toFixed(1)} mois</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Probatoire :</span>
                        <span className="font-bold">{stats.moyenneProbation.toFixed(1)} mois</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Simple :</span>
                        <span className="font-bold">{stats.moyenneSimple.toFixed(1)} mois</span>
                      </div>
                      {stats.moyenneMixtesProbation && (
                        <div className="flex justify-between">
                          <span>Mixte probatoire :</span>
                          <span className="font-bold">
                            {Math.round(stats.moyenneMixtesProbation.split(' + ')
                              .reduce((a, b) => Number(a) + Number(b), 0) * 2) / 2} 
                            dont {Math.round(Number(stats.moyenneMixtesProbation.split(' + ')[1]) * 2) / 2} avec sursis probatoire
                          </span>
                        </div>
                      )}
                      {stats.moyenneMixtesSimple && (
                        <div className="flex justify-between">
                          <span>Mixte simple :</span>
                          <span className="font-bold">{stats.moyenneMixtesSimple}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))
                : <div>Aucune donnée disponible</div>
              }
            </div>
          </CardContent>
        </Card>
{/* Carte Peines moyennes par type d'audience */}
<Card>
  <CardHeader>
    <CardTitle>Peines moyennes par type d'audience</CardTitle>
  </CardHeader>
  <CardContent>
    <div className="space-y-4">
      {['CRPC-Def', 'CI', 'COPJ', 'CDD'].map(type => {
        // Récupérer toutes les condamnations de ce type (pas les résultats)
        const condamnationsOfType = Object.values(audienceState.resultats || {})
          .flatMap(r => r.condamnations)
          .filter(c => c && c.typeAudience === type);
        
        // Si aucune condamnation pour ce type, on n'affiche pas ce bloc
        if (condamnationsOfType.length === 0) return null;
        
        // Condamnations avec prison ferme pure
        const condamnationsFermePur = condamnationsOfType.filter(c => 
          c.peinePrison > 0 && 
          (!c.sursisProbatoire || c.sursisProbatoire === 0) && 
          (!c.sursisSimple || c.sursisSimple === 0)
        );
        
        // Moyenne peine ferme pure
        const moyenneFermePur = condamnationsFermePur.length > 0 
          ? condamnationsFermePur.reduce((acc, c) => acc + (Number(c.peinePrison) || 0), 0) / condamnationsFermePur.length 
          : 0;
        
        // Condamnations avec sursis probatoire pur
        const condamnationsProbatoire = condamnationsOfType.filter(c => 
          (!c.peinePrison || c.peinePrison === 0) && 
          c.sursisProbatoire > 0
        );
        
        // Moyenne sursis probatoire pur
        const moyenneProbatoire = condamnationsProbatoire.length > 0 
          ? condamnationsProbatoire.reduce((acc, c) => acc + (Number(c.sursisProbatoire) || 0), 0) / condamnationsProbatoire.length 
          : 0;
        
        // Condamnations avec peine mixte (ferme + sursis)
        const condamnationsMixtes = condamnationsOfType.filter(c => 
          c.peinePrison > 0 && 
          (c.sursisProbatoire > 0 || c.sursisSimple > 0)
        );
        
        // Calcul des moyennes pour les peines mixtes
        let moyenneMixteFerme = 0;
        let moyenneMixteSursis = 0;
        
        if (condamnationsMixtes.length > 0) {
          moyenneMixteFerme = condamnationsMixtes.reduce((acc, c) => 
            acc + (Number(c.peinePrison) || 0), 0) / condamnationsMixtes.length;
            
          moyenneMixteSursis = condamnationsMixtes.reduce((acc, c) => 
            acc + (Number(c.sursisProbatoire) || 0) + (Number(c.sursisSimple) || 0), 0) / condamnationsMixtes.length;
        }
        
        return (
          <div key={type} className="bg-gray-50 p-4 rounded-lg">
            <div className="font-medium mb-2">{type}</div>
            <div className="space-y-2">
              {condamnationsFermePur.length > 0 && (
                <div className="flex justify-between">
                  <span>Ferme pur :</span>
                  <span className="font-bold">
                    {moyenneFermePur.toFixed(1)} mois
                    <span className="text-xs text-gray-500 ml-1">
                      ({condamnationsFermePur.length} condamnation{condamnationsFermePur.length > 1 ? 's' : ''})
                    </span>
                  </span>
                </div>
              )}
              
              {condamnationsProbatoire.length > 0 && (
                <div className="flex justify-between">
                  <span>Sursis probatoire pur :</span>
                  <span className="font-bold">
                    {moyenneProbatoire.toFixed(1)} mois
                    <span className="text-xs text-gray-500 ml-1">
                      ({condamnationsProbatoire.length} condamnation{condamnationsProbatoire.length > 1 ? 's' : ''})
                    </span>
                  </span>
                </div>
              )}
              
              {condamnationsMixtes.length > 0 && (
                <div className="flex justify-between">
                  <span>Mixte :</span>
                  <span className="font-bold">
                    {(moyenneMixteFerme + moyenneMixteSursis).toFixed(1)} dont {moyenneMixteSursis.toFixed(1)} sursis
                    <span className="text-xs text-gray-500 ml-1">
                      ({condamnationsMixtes.length} condamnation{condamnationsMixtes.length > 1 ? 's' : ''})
                    </span>
                  </span>
                </div>
              )}
              
              <div className="text-sm text-gray-500 mt-2">
                Total : {condamnationsOfType.length} condamnation{condamnationsOfType.length > 1 ? 's' : ''}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  </CardContent>
</Card>{/* Carte Ouvertures d'information */}
<Card>
  <CardHeader>
    <CardTitle>Ouvertures d'information</CardTitle>
    <p className="text-sm text-gray-500">Toutes enquêtes confondues</p>
  </CardHeader>
  <CardContent>
    {(() => {
      // Récupérer le nombre d'OI directement des statistiques annuelles
      const nombreOI = yearlyStats?.nombreOI || 0;
      
      // Nombre total d'enquêtes
      const totalEnquetes = (yearlyStats?.nombreCRPC || 0) + 
                            (yearlyStats?.nombreCI || 0) + 
                            (yearlyStats?.nombreCOPJ || 0) + 
                            (yearlyStats?.nombreOI || 0) + 
                            (yearlyStats?.nombreCDD || 0);
      
      // Calcul du pourcentage
      const pourcentage = totalEnquetes > 0 
        ? ((nombreOI / totalEnquetes) * 100).toFixed(1) 
        : '0';
      
      // Récupérer le nombre d'OI par mois
      const ouverturesMensuelles = {};
      
      // Initialiser tous les mois à 0
      getMonthsToShow().forEach(month => {
        const monthName = new Date(selectedYear, month).toLocaleString('default', { month: 'long' });
        ouverturesMensuelles[monthName] = monthlyStats[month]?.nombreOI || 0;
      });
      
      return (
        <>
          <div className="flex items-center mb-4">
            <div className="text-3xl font-bold mr-2">{nombreOI}</div>
            <div className="text-lg ml-2">({pourcentage}% des dossiers terminés)</div>
          </div>
          
          <div className="mt-4 pt-4 border-t space-y-1">
            {Object.entries(ouverturesMensuelles).map(([month, count]) => (
              <div key={month} className="flex justify-between text-sm">
                <span>{month}:</span>
                <span className="font-medium">{count}</span>
              </div>
            ))}
          </div>
        </>
      );
    })()}
  </CardContent>
</Card>
      </div>
    </div>
  );
};