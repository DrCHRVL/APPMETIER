import { useEffect, useState, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { useAudience } from '@/hooks/useAudience';
import { Enquete } from '@/types/interfaces';
import { AudienceStats as AudienceStatsType, ResultatAudience } from '@/types/audienceTypes';
import { getYearlyStats, getMonthlyStats } from '@/utils/audienceStats';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, PointElement, LineElement, BarElement } from 'chart.js';
import { Pie, Bar } from 'react-chartjs-2';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { ListFilter, X } from 'lucide-react';

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

// Constantes de couleurs orientations
const ORIENTATION_DATASETS = [
  { key: 'nombreCRPC', label: 'CRPC', color: '#34495e' },
  { key: 'nombreCI', label: 'CI', color: '#3498db' },
  { key: 'nombreCOPJ', label: 'COPJ', color: '#2ecc71' },
  { key: 'nombreOI', label: 'OI', color: '#95a5a6' },
  { key: 'nombreCDD', label: 'CDD', color: '#E8D0A9' },
  { key: 'nombreClassements', label: 'Classement', color: '#e74c3c' },
] as const;

// Composant Bar chart factorisé pour un bloc de mois
const OrientationBarBlock = ({
  months,
  monthlyStats,
  selectedYear,
}: {
  months: number[];
  monthlyStats: { [key: number]: AudienceStatsType | null };
  selectedYear: number;
}) => (
  <div style={{ width: '100%', height: '200px' }}>
    <Bar
      data={{
        labels: months.map(month =>
          new Date(selectedYear, month).toLocaleString('default', { month: 'short' })
        ),
        datasets: ORIENTATION_DATASETS.map(({ key, label, color }) => ({
          label,
          data: months.map(month => monthlyStats[month]?.[key] || 0),
          backgroundColor: color,
        })),
      }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, beginAtZero: true, ticks: { stepSize: 5 }, grid: { color: '#f0f0f0' } },
        },
        plugins: {
          legend: { display: false },
          datalabels: {
            color: '#fff',
            anchor: 'center',
            align: 'center',
            formatter: (value) => value || '',
            font: { weight: 'bold' },
            display: (context) => context.dataset.data[context.dataIndex] > 0,
          },
        },
      }}
    />
  </div>
);

// Bouton + popup pour lister les mis en cause avec interdiction de paraître par type de contentieux
const InterdictionsDetailButton = ({
  scopedResultats,
  enquetes,
  selectedYear,
}: {
  scopedResultats: Record<string, ResultatAudience>;
  enquetes: Enquete[];
  selectedYear: number;
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const interdictionsData = useMemo(() => {
    const result: Record<string, { nom: string; lieu?: string; duree?: number; dossier: string; dateAudience: string }[]> = {};

    Object.values(scopedResultats).forEach(r => {
      if (!r.dateAudience || new Date(r.dateAudience).getFullYear() !== selectedYear) return;

      const enquete = enquetes.find(e => e.id === r.enqueteId);
      const dossier = enquete?.numero || r.numeroAudience || `#${r.enqueteId}`;
      const typeInfraction = r.typeInfraction || 'Non renseigné';

      r.condamnations?.forEach(c => {
        if (!c.interdictionParaitre) return;
        if (!result[typeInfraction]) result[typeInfraction] = [];
        result[typeInfraction].push({
          nom: c.nom || 'Inconnu',
          lieu: c.lieuInterdictionParaitre,
          duree: c.dureeInterdictionParaitre,
          dossier,
          dateAudience: r.dateAudience,
        });
      });
    });

    return result;
  }, [scopedResultats, enquetes, selectedYear]);

  const sortedTypes = Object.entries(interdictionsData).sort(([, a], [, b]) => b.length - a.length);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="mt-2 flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 hover:underline transition-colors"
      >
        <ListFilter className="h-3.5 w-3.5" />
        Voir le détail par contentieux
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setIsOpen(false)}>
          <div
            className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-white">
              <h3 className="font-semibold text-lg">Interdictions de paraître ({selectedYear})</h3>
              <button onClick={() => setIsOpen(false)} className="p-1 hover:bg-gray-100 rounded">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              {sortedTypes.length === 0 ? (
                <p className="text-gray-500 text-center py-4">Aucune interdiction de paraître</p>
              ) : (
                sortedTypes.map(([type, items]) => (
                  <div key={type}>
                    <h4 className="font-medium text-sm text-gray-700 mb-2 bg-gray-50 p-2 rounded">
                      {type} <span className="text-gray-400">({items.length})</span>
                    </h4>
                    <div className="space-y-1 pl-2">
                      {items.map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between text-sm py-1 border-b border-gray-100 last:border-0">
                          <div>
                            <span className="font-medium">{item.nom}</span>
                            <span className="text-gray-400 ml-2">({item.dossier})</span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-500">
                            {item.lieu && <span>{item.lieu}</span>}
                            {item.duree && <span>{item.duree} mois</span>}
                            <span>{new Date(item.dateAudience).toLocaleDateString('fr-FR')}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

interface AudienceStatsProps {
  enquetes: Enquete[];
  selectedYear: number;
  contentieuxId?: string;
}

export const AudienceStats = ({ enquetes, selectedYear, contentieuxId }: AudienceStatsProps) => {
  const [yearlyStats, setYearlyStats] = useState<AudienceStatsType | null>(null);
  const [monthlyStats, setMonthlyStats] = useState<{ [key: number]: AudienceStatsType | null }>({});

  const { audienceState } = useAudience();
  const currentDate = new Date();

  // IDs des enquêtes du contentieux actif
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

  const getMonthsToShow = () => {
    const lastMonth = selectedYear === currentDate.getFullYear() ?
      currentDate.getMonth() : 11;
    return Array.from({ length: lastMonth + 1 }, (_, i) => i);
  };

  useEffect(() => {
    if (Object.keys(scopedResultats).length === 0 || !enquetes) {
      setYearlyStats(null);
      return;
    }
    setYearlyStats(getYearlyStats(scopedResultats, enquetes, selectedYear));
  }, [scopedResultats, selectedYear, enquetes]);

  useEffect(() => {
    if (Object.keys(scopedResultats).length === 0 || !enquetes) return;
    const months = getMonthsToShow();
    const data: { [key: number]: AudienceStatsType | null } = {};
    months.forEach(month => {
      data[month] = getMonthlyStats(scopedResultats, enquetes, selectedYear, month);
    });
    setMonthlyStats(data);
  }, [scopedResultats, selectedYear, enquetes]);

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
            <div className="space-y-2">
              {ORIENTATION_DATASETS.map(({ key, label, color }) => (
                <div key={key} className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                    <span>{label === 'Classement' ? 'Classement sans suite' : label === 'OI' ? 'OI (ouverture d\'info)' : label}</span>
                  </div>
                  <span className="font-bold">{yearlyStats[key] || 0}</span>
                </div>
              ))}
              <div className="pt-2 mt-2 border-t">
                <div className="flex justify-between">
                  <span>Dont déférements</span>
                  <span className="font-bold">{yearlyStats.nombreDeferements}</span>
                </div>
              </div>
            </div>

            <div className="h-[400px] mt-2">
              <Pie
                data={{
                  labels: ORIENTATION_DATASETS.map(d => d.label),
                  datasets: [{
                    data: ORIENTATION_DATASETS.map(d => yearlyStats[d.key] || 0),
                    backgroundColor: ORIENTATION_DATASETS.map(d => d.color),
                  }],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { display: false },
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
                      font: { weight: 'bold', size: 11 },
                      formatter: (value: number, ctx: any) => {
                        const total = ctx.dataset.data.reduce((a: number, b: number) => a + b, 0);
                        const percentage = ((value / total) * 100).toFixed(0);
                        if (Number(percentage) < 5) return '';
                        return `${percentage}%`;
                      },
                      anchor: 'center', align: 'center', offset: 0,
                    },
                  },
                  layout: { padding: { top: 0, right: 0, bottom: 0, left: 0 } },
                }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Carte Orientation par mois - FACTORISEE */}
        <Card>
          <CardHeader>
            <CardTitle>Orientation par mois</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-6">
              <OrientationBarBlock months={[0, 1, 2, 3]} monthlyStats={monthlyStats} selectedYear={selectedYear} />
              <OrientationBarBlock months={[4, 5, 6, 7]} monthlyStats={monthlyStats} selectedYear={selectedYear} />
              <OrientationBarBlock months={[8, 9, 10, 11]} monthlyStats={monthlyStats} selectedYear={selectedYear} />

              {/* Légende commune */}
              <div className="flex justify-center items-center gap-4 flex-wrap mt-2">
                {ORIENTATION_DATASETS.map(({ label, color }) => (
                  <div key={label} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                    <span className="text-sm">{label}</span>
                  </div>
                ))}
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
              const totalCondamnations = Object.values(scopedResultats)
                .filter(r => new Date(r.dateAudience).getFullYear() === selectedYear)
                .reduce((acc, r) => acc + r.condamnations.length, 0);
              const totalAudiences = Object.values(scopedResultats)
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
                      const count = Object.values(scopedResultats)
                        .filter(r => {
                          const d = new Date(r.dateAudience);
                          return d.getFullYear() === selectedYear && d.getMonth() === month;
                        })
                        .reduce((acc, r) => acc + r.condamnations.length, 0);
                      return (
                        <div key={month} className="flex justify-between text-sm">
                          <span>{new Date(selectedYear, month).toLocaleString('default', { month: 'long' })}:</span>
                          <span className="font-medium">{count}</span>
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
                if (annees > 0 && moisRestants > 0) return `Soit ${annees} an${annees > 1 ? 's' : ''} et ${moisRestants} mois`;
                if (annees > 0) return `Soit ${annees} an${annees > 1 ? 's' : ''}`;
                return null;
              })()}
            </div>
            <div className="mt-4 pt-4 border-t space-y-1">
              {getMonthsToShow().map(month => {
                const moisPrison = monthlyStats[month]?.totalPeinePrison || 0;
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
              const allCondamnations = Object.values(scopedResultats)
                .filter(r => new Date(r.dateAudience).getFullYear() === selectedYear)
                .flatMap(r => r.condamnations);
              const totalCondamnations = allCondamnations.length;

              const condamnationsFerme = allCondamnations.filter(c =>
                c.peinePrison > 0 && (!c.sursisProbatoire || c.sursisProbatoire === 0) && (!c.sursisSimple || c.sursisSimple === 0)
              );
              const condamnationsProb = allCondamnations.filter(c =>
                (!c.peinePrison || c.peinePrison === 0) && c.sursisProbatoire > 0 && (!c.sursisSimple || c.sursisSimple === 0)
              );
              const condamnationsSimple = allCondamnations.filter(c =>
                (!c.peinePrison || c.peinePrison === 0) && (!c.sursisProbatoire || c.sursisProbatoire === 0) && c.sursisSimple > 0
              );
              const condamnationsMixteProb = allCondamnations.filter(c =>
                c.peinePrison > 0 && c.sursisProbatoire > 0
              );
              const condamnationsMixteSimple = allCondamnations.filter(c =>
                c.peinePrison > 0 && c.sursisSimple > 0 && (!c.sursisProbatoire || c.sursisProbatoire === 0)
              );

              const moyenneMixteProb = condamnationsMixteProb.length > 0 ? {
                ferme: condamnationsMixteProb.reduce((acc, c) => acc + (Number(c.peinePrison) || 0), 0) / condamnationsMixteProb.length,
                sursis: condamnationsMixteProb.reduce((acc, c) => acc + (Number(c.sursisProbatoire) || 0), 0) / condamnationsMixteProb.length
              } : { ferme: 0, sursis: 0 };

              const moyenneMixteSimple = condamnationsMixteSimple.length > 0 ? {
                ferme: condamnationsMixteSimple.reduce((acc, c) => acc + (Number(c.peinePrison) || 0), 0) / condamnationsMixteSimple.length,
                sursis: condamnationsMixteSimple.reduce((acc, c) => acc + (Number(c.sursisSimple) || 0), 0) / condamnationsMixteSimple.length
              } : { ferme: 0, sursis: 0 };

              const pctOf = (n: number) => totalCondamnations > 0 ? ((n / totalCondamnations) * 100).toFixed(1) : '0';

              return (
                <div className="grid gap-3">
                  <div>
                    <div className="font-medium mb-1">Prison ferme uniquement</div>
                    <div className="text-2xl font-bold">{yearlyStats.moyennePrison} mois</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {condamnationsFerme.length} condamnation{condamnationsFerme.length > 1 ? 's' : ''} ({pctOf(condamnationsFerme.length)}%)
                    </div>
                  </div>
                  <div>
                    <div className="font-medium mb-1">Sursis probatoire uniquement</div>
                    <div className="text-2xl font-bold">{yearlyStats.moyenneProbation} mois</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {condamnationsProb.length} condamnation{condamnationsProb.length > 1 ? 's' : ''} ({pctOf(condamnationsProb.length)}%)
                    </div>
                  </div>
                  <div>
                    <div className="font-medium mb-1">Sursis simple uniquement</div>
                    <div className="text-2xl font-bold">{yearlyStats.moyenneSimple} mois</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {condamnationsSimple.length} condamnation{condamnationsSimple.length > 1 ? 's' : ''} ({pctOf(condamnationsSimple.length)}%)
                    </div>
                  </div>
                  <div>
                    <div className="font-medium mb-1">Mixte avec sursis probatoire</div>
                    <div className="text-2xl font-bold">
                      {(moyenneMixteProb.ferme + moyenneMixteProb.sursis).toFixed(1)} dont {moyenneMixteProb.sursis.toFixed(1)} avec sursis probatoire
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {condamnationsMixteProb.length} condamnation{condamnationsMixteProb.length > 1 ? 's' : ''} ({pctOf(condamnationsMixteProb.length)}%)
                    </div>
                  </div>
                  <div>
                    <div className="font-medium mb-1">Mixte avec sursis simple</div>
                    <div className="text-lg">
                      {(moyenneMixteSimple.ferme + moyenneMixteSimple.sursis).toFixed(1)} dont {moyenneMixteSimple.sursis.toFixed(1)} avec sursis simple
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {condamnationsMixteSimple.length} condamnation{condamnationsMixteSimple.length > 1 ? 's' : ''} ({pctOf(condamnationsMixteSimple.length)}%)
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
              {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(yearlyStats.moyenneAmende)}
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
                      '0 \u20ac'}
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
                {yearlyStats.nombreCondamnations > 0
                  ? ((yearlyStats.totalInterdictionsParaitre / yearlyStats.nombreCondamnations) * 100).toFixed(1)
                  : 0}% des condamnations
              </div>
              {yearlyStats.totalInterdictionsParaitre > 0 && (
                <InterdictionsDetailButton
                  scopedResultats={scopedResultats}
                  enquetes={enquetes}
                  selectedYear={selectedYear}
                />
              )}
            </div>
          </CardContent>
        </Card>

        {/* Carte Confiscations */}
        <Card>
          <CardHeader>
            <CardTitle>Confiscations et saisies</CardTitle>
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
              </div>
              <div className="border-t pt-2 space-y-2">
                <p className="text-xs text-gray-500 font-medium uppercase">Avoirs financiers</p>
                <div className="flex justify-between">
                  <span>Numéraire (espèces)</span>
                  <span className="font-bold">
                    {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(yearlyStats.totalNumeraire)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Saisies bancaires</span>
                  <span className="font-bold">
                    {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(yearlyStats.totalBancaire)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Cryptomonnaies</span>
                  <span className="font-bold">
                    {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(yearlyStats.totalCrypto)}
                  </span>
                </div>
                <div className="flex justify-between border-t pt-1">
                  <span className="font-medium">Total avoirs</span>
                  <span className="font-bold">
                    {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(yearlyStats.totalArgent)}
                  </span>
                </div>
              </div>
              {(yearlyStats.totalObjets > 0 || yearlyStats.totalStupefiants > 0) && (
                <div className="border-t pt-2 space-y-2">
                  {yearlyStats.totalObjets > 0 && (
                    <div className="flex justify-between">
                      <span>Objets mobiliers saisis</span>
                      <span className="font-bold">{yearlyStats.totalObjets}</span>
                    </div>
                  )}
                  {yearlyStats.totalStupefiants > 0 && (
                    <div className="flex justify-between">
                      <span>Dossiers avec stupéfiants</span>
                      <span className="font-bold">{yearlyStats.totalStupefiants}</span>
                    </div>
                  )}
                </div>
              )}
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
                            {' '}dont {Math.round(Number(stats.moyenneMixtesProbation.split(' + ')[1]) * 2) / 2} avec sursis probatoire
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
                const condamnationsOfType = Object.values(scopedResultats)
                  .flatMap(r => r.condamnations)
                  .filter(c => c && c.typeAudience === type);
                if (condamnationsOfType.length === 0) return null;

                const condamnationsFermePur = condamnationsOfType.filter(c =>
                  c.peinePrison > 0 && (!c.sursisProbatoire || c.sursisProbatoire === 0) && (!c.sursisSimple || c.sursisSimple === 0)
                );
                const moyenneFermePur = condamnationsFermePur.length > 0
                  ? condamnationsFermePur.reduce((acc, c) => acc + (Number(c.peinePrison) || 0), 0) / condamnationsFermePur.length : 0;

                const condamnationsProbatoire = condamnationsOfType.filter(c =>
                  (!c.peinePrison || c.peinePrison === 0) && c.sursisProbatoire > 0
                );
                const moyenneProbatoire = condamnationsProbatoire.length > 0
                  ? condamnationsProbatoire.reduce((acc, c) => acc + (Number(c.sursisProbatoire) || 0), 0) / condamnationsProbatoire.length : 0;

                const condamnationsMixtes = condamnationsOfType.filter(c =>
                  c.peinePrison > 0 && (c.sursisProbatoire > 0 || c.sursisSimple > 0)
                );
                let moyenneMixteFerme = 0;
                let moyenneMixteSursis = 0;
                if (condamnationsMixtes.length > 0) {
                  moyenneMixteFerme = condamnationsMixtes.reduce((acc, c) => acc + (Number(c.peinePrison) || 0), 0) / condamnationsMixtes.length;
                  moyenneMixteSursis = condamnationsMixtes.reduce((acc, c) => acc + (Number(c.sursisProbatoire) || 0) + (Number(c.sursisSimple) || 0), 0) / condamnationsMixtes.length;
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
                            <span className="text-xs text-gray-500 ml-1">({condamnationsFermePur.length} condamnation{condamnationsFermePur.length > 1 ? 's' : ''})</span>
                          </span>
                        </div>
                      )}
                      {condamnationsProbatoire.length > 0 && (
                        <div className="flex justify-between">
                          <span>Sursis probatoire pur :</span>
                          <span className="font-bold">
                            {moyenneProbatoire.toFixed(1)} mois
                            <span className="text-xs text-gray-500 ml-1">({condamnationsProbatoire.length} condamnation{condamnationsProbatoire.length > 1 ? 's' : ''})</span>
                          </span>
                        </div>
                      )}
                      {condamnationsMixtes.length > 0 && (
                        <div className="flex justify-between">
                          <span>Mixte :</span>
                          <span className="font-bold">
                            {(moyenneMixteFerme + moyenneMixteSursis).toFixed(1)} dont {moyenneMixteSursis.toFixed(1)} sursis
                            <span className="text-xs text-gray-500 ml-1">({condamnationsMixtes.length} condamnation{condamnationsMixtes.length > 1 ? 's' : ''})</span>
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
        </Card>

        {/* Carte Classements sans suite */}
        <Card>
          <CardHeader>
            <CardTitle>Classements sans suite</CardTitle>
            <p className="text-sm text-gray-500">Toutes enquêtes confondues</p>
          </CardHeader>
          <CardContent>
            {(() => {
              const nombreClassements = yearlyStats?.nombreClassements || 0;
              const totalEnquetes = (yearlyStats?.nombreCRPC || 0) +
                                    (yearlyStats?.nombreCI || 0) +
                                    (yearlyStats?.nombreCOPJ || 0) +
                                    (yearlyStats?.nombreOI || 0) +
                                    (yearlyStats?.nombreCDD || 0) +
                                    (yearlyStats?.nombreClassements || 0);
              const pourcentage = totalEnquetes > 0 ? ((nombreClassements / totalEnquetes) * 100).toFixed(1) : '0';

              // Calcul de l'âge moyen et répartition par type de fait
              const classementResults = Object.values(scopedResultats)
                .filter(r => r.isClassement && r.dateAudience &&
                  new Date(r.dateAudience).getFullYear() === selectedYear);

              let totalAge = 0;
              let countAge = 0;
              const infractionCounts: Record<string, number> = {};

              classementResults.forEach(r => {
                const enquete = enquetes.find(e => e.id === r.enqueteId);
                if (enquete) {
                  const dateDebut = new Date(enquete.dateDebut);
                  const dateFin = new Date(r.dateAudience);
                  const ageJours = Math.floor((dateFin.getTime() - dateDebut.getTime()) / (1000 * 60 * 60 * 24));
                  if (ageJours >= 0) { totalAge += ageJours; countAge++; }
                  enquete.tags.filter(t => t.category === 'infractions').forEach(t => {
                    if (t.value) infractionCounts[t.value] = (infractionCounts[t.value] || 0) + 1;
                  });
                }
              });

              const ageMoyen = countAge > 0 ? Math.round(totalAge / countAge) : 0;
              const totalInfractions = Object.values(infractionCounts).reduce((a, b) => a + b, 0);
              const sortedInfractions = Object.entries(infractionCounts).sort(([, a], [, b]) => b - a);

              const ouverturesMensuelles: Record<string, number> = {};
              getMonthsToShow().forEach(month => {
                const monthName = new Date(selectedYear, month).toLocaleString('default', { month: 'long' });
                ouverturesMensuelles[monthName] = monthlyStats[month]?.nombreClassements || 0;
              });

              return (
                <>
                  <div className="flex items-center mb-2">
                    <div className="text-3xl font-bold mr-2">{nombreClassements}</div>
                    <div className="text-lg ml-2">({pourcentage}% des orientations)</div>
                  </div>

                  {countAge > 0 && (
                    <div className="bg-red-50 p-3 rounded-md mb-4">
                      <div className="text-sm font-medium text-red-800">Âge moyen des dossiers au classement</div>
                      <div className="text-2xl font-bold text-red-700">{ageMoyen} jours</div>
                    </div>
                  )}

                  {sortedInfractions.length > 0 && (
                    <div className="mb-4">
                      <p className="text-sm font-medium mb-2">Répartition par type de fait</p>
                      <div className="space-y-1">
                        {sortedInfractions.map(([infraction, count]) => (
                          <div key={infraction} className="flex justify-between text-sm">
                            <span>{infraction}</span>
                            <span className="font-medium">{count} ({totalInfractions > 0 ? ((count / totalInfractions) * 100).toFixed(0) : 0}%)</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="pt-3 border-t space-y-1">
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

        {/* Carte Ouvertures d'information */}
        <Card>
          <CardHeader>
            <CardTitle>Ouvertures d'information</CardTitle>
            <p className="text-sm text-gray-500">Toutes enquêtes confondues</p>
          </CardHeader>
          <CardContent>
            {(() => {
              const nombreOI = yearlyStats?.nombreOI || 0;
              const totalEnquetes = (yearlyStats?.nombreCRPC || 0) +
                                    (yearlyStats?.nombreCI || 0) +
                                    (yearlyStats?.nombreCOPJ || 0) +
                                    (yearlyStats?.nombreOI || 0) +
                                    (yearlyStats?.nombreCDD || 0) +
                                    (yearlyStats?.nombreClassements || 0);
              const pourcentage = totalEnquetes > 0 ? ((nombreOI / totalEnquetes) * 100).toFixed(1) : '0';

              // Calcul de l'âge moyen et répartition par type de fait
              const oiResults = Object.values(scopedResultats)
                .filter(r => r.isOI && r.dateAudience &&
                  new Date(r.dateAudience).getFullYear() === selectedYear);

              let totalAge = 0;
              let countAge = 0;
              const infractionCounts: Record<string, number> = {};

              oiResults.forEach(r => {
                const enquete = enquetes.find(e => e.id === r.enqueteId);
                if (enquete) {
                  const dateDebut = new Date(enquete.dateDebut);
                  const dateFin = new Date(r.dateAudience);
                  const ageJours = Math.floor((dateFin.getTime() - dateDebut.getTime()) / (1000 * 60 * 60 * 24));
                  if (ageJours >= 0) { totalAge += ageJours; countAge++; }
                  enquete.tags.filter(t => t.category === 'infractions').forEach(t => {
                    if (t.value) infractionCounts[t.value] = (infractionCounts[t.value] || 0) + 1;
                  });
                }
              });

              const ageMoyen = countAge > 0 ? Math.round(totalAge / countAge) : 0;
              const totalInfractions = Object.values(infractionCounts).reduce((a, b) => a + b, 0);
              const sortedInfractions = Object.entries(infractionCounts).sort(([, a], [, b]) => b - a);

              const ouverturesMensuelles: Record<string, number> = {};
              getMonthsToShow().forEach(month => {
                const monthName = new Date(selectedYear, month).toLocaleString('default', { month: 'long' });
                ouverturesMensuelles[monthName] = monthlyStats[month]?.nombreOI || 0;
              });

              return (
                <>
                  <div className="flex items-center mb-2">
                    <div className="text-3xl font-bold mr-2">{nombreOI}</div>
                    <div className="text-lg ml-2">({pourcentage}% des orientations)</div>
                  </div>

                  {countAge > 0 && (
                    <div className="bg-gray-100 p-3 rounded-md mb-4">
                      <div className="text-sm font-medium text-gray-700">Âge moyen des dossiers avant ouverture d'info</div>
                      <div className="text-2xl font-bold text-gray-800">{ageMoyen} jours</div>
                    </div>
                  )}

                  {sortedInfractions.length > 0 && (
                    <div className="mb-4">
                      <p className="text-sm font-medium mb-2">Répartition par type de fait</p>
                      <div className="space-y-1">
                        {sortedInfractions.map(([infraction, count]) => (
                          <div key={infraction} className="flex justify-between text-sm">
                            <span>{infraction}</span>
                            <span className="font-medium">{count} ({totalInfractions > 0 ? ((count / totalInfractions) * 100).toFixed(0) : 0}%)</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="pt-3 border-t space-y-1">
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
