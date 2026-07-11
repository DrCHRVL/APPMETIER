import { useEffect, useState, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { useAudience } from '@/hooks/useAudience';
import { useInfractionNatinf } from '@/hooks/useInfractionNatinf';
import { useNatinf } from '@/hooks/useNatinf';
import { NatinfBadge } from '../natinf/NatinfBadge';
import { Enquete } from '@/types/interfaces';
import { ContentieuxId, ContentieuxDefinition } from '@/types/userTypes';
import { AudienceStats as AudienceStatsType, ResultatAudience, migrateConfiscations } from '@/types/audienceTypes';
import { getYearlyStats, getMonthlyStats } from '@/utils/audienceStats';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, PointElement, LineElement, BarElement } from 'chart.js';
import { Pie, Bar } from 'react-chartjs-2';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { ListFilter, X, Filter } from 'lucide-react';

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

import { ORIENTATION_DATASETS } from '@/utils/chartColors';

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
            display: (context) => (context.dataset.data[context.dataIndex] as number) > 0,
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
  const { getByCode } = useNatinf();

  const interdictionsData = useMemo(() => {
    const result: Record<string, { nom: string; lieu?: string; duree?: number; dossier: string; dateAudience: string }[]> = {};

    Object.values(scopedResultats).forEach(r => {
      if (!r.dateAudience || new Date(r.dateAudience).getFullYear() !== selectedYear) return;

      const enquete = enquetes.find(e => e.id === r.enqueteId);
      const dossier = enquete?.numero || r.numeroAudience || `#${r.enqueteId}`;
      // Libellé résolu par NATINF si le résultat est migré, sinon libellé legacy.
      const code = r.infractionNatinfCodes?.[0];
      const typeInfraction = (code ? getByCode(code)?.libelle : undefined)
        || r.typeInfraction || 'Non renseigné';

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
  }, [scopedResultats, enquetes, selectedYear, getByCode]);

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
  enquetesByContentieux?: Map<ContentieuxId, Enquete[]>;
  contentieuxDefs?: ContentieuxDefinition[];
}

export const AudienceStats = ({ enquetes, selectedYear, contentieuxId, enquetesByContentieux, contentieuxDefs }: AudienceStatsProps) => {
  const [yearlyStats, setYearlyStats] = useState<AudienceStatsType | null>(null);
  const [monthlyStats, setMonthlyStats] = useState<{ [key: number]: AudienceStatsType | null }>({});

  const { audienceState } = useAudience();
  const { infractionsForEnquete } = useInfractionNatinf();
  const { getByCode } = useNatinf();
  // Clé canonique d'une infraction : code NATINF si rattaché, sinon libellé.
  // Regrouper par cette clé garde des comptes cohérents qu'un dossier soit migré
  // au NATINF (infractionNatinfCodes) ou encore en tags.
  const keyOf = (inf: { code?: string; label: string }) => inf.code ?? inf.label;
  // Clés canoniques d'un RÉSULTAT d'audience : codes NATINF dénormalisés si
  // présents, sinon libellés legacy. Sert au filtre « Interdictions de gérer »
  // (évolutif : les options viennent des résultats eux-mêmes, pas des tags).
  const resultInfractionKeys = (r: ResultatAudience): string[] => {
    if (r.infractionNatinfCodes?.length) return r.infractionNatinfCodes;
    if (r.typesInfraction?.length) return r.typesInfraction;
    return r.typeInfraction ? [r.typeInfraction] : [];
  };
  const labelForInfractionKey = (k: string) => getByCode(k)?.libelle ?? k;
  const [selectedGererTags, setSelectedGererTags] = useState<string[]>([]);
  const currentDate = new Date();

  // IDs des enquêtes du contentieux actif
  const enqueteIds = useMemo(() => new Set(enquetes.map(e => e.id)), [enquetes]);

  // Résultats d'audience scopés au contentieux actif (ou tous si global).
  // Les clés sont composites (`${contentieuxId}__${enqueteId}`) depuis le
  // refactor : on filtre sur `r.contentieuxId` (champ explicite) et on tombe
  // back sur `crimorg` pour les résultats legacy non migrés.
  const scopedResultats = useMemo(() => {
    const all = audienceState?.resultats || {};
    if (contentieuxId === 'global') return all;
    return Object.fromEntries(
      Object.entries(all).filter(([, r]) => {
        const ctx = r.contentieuxId || 'crimorg';
        // Inclure les procédures de permanence (résultats directs) : leur
        // enqueteId synthétique n'est pas dans la liste des enquêtes mais elles
        // relèvent bien du contentieux et sont comptées à l'export PDF.
        return ctx === contentieuxId && (r.isDirectResult === true || enqueteIds.has(r.enqueteId));
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

  // === Statistiques par contentieux (uniquement pour la vue globale) ===
  const isGlobal = contentieuxId === 'global' && enquetesByContentieux && contentieuxDefs;
  const enabledDefs = useMemo(() => (contentieuxDefs || []).filter(d => d.enabled !== false).sort((a, b) => a.order - b.order), [contentieuxDefs]);

  const condamnationsParContentieux = useMemo(() => {
    if (!isGlobal) return null;
    const allResultats = audienceState?.resultats || {};

    return enabledDefs.map(def => {
      const cEnquetes = enquetesByContentieux!.get(def.id) || [];
      const cEnqueteIds = new Set(cEnquetes.map(e => e.id));

      const cResultats = Object.fromEntries(
        Object.entries(allResultats).filter(([, r]) => {
          const ctx = r.contentieuxId || 'crimorg';
          return ctx === def.id && (r.isDirectResult === true || cEnqueteIds.has(r.enqueteId));
        })
      );

      // Même définition que la carte (getYearlyStats), pour que la somme des
      // contentieux colle au total affiché au-dessus.
      const total = getYearlyStats(cResultats, cEnquetes, selectedYear)?.nombreCondamnations || 0;

      return { def, total };
    });
  }, [isGlobal, enabledDefs, enquetesByContentieux, audienceState?.resultats, selectedYear]);

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
                <p className="text-xs text-gray-400 mt-1">
                  Déférés dans les dossiers jugés en {selectedYear} (rattachés à la date d'audience).
                  Ce total peut différer de la carte « Évolution des déférements », qui les compte
                  à leur date réelle de déférement, toutes enquêtes confondues.
                </p>
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
                          const value = context.raw as number;
                          const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
                          const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
                          return ` ${context.label}: ${value} (${percentage}%)`;
                        }
                      }
                    },
                    datalabels: {
                      color: '#fff',
                      font: { weight: 'bold', size: 11 },
                      formatter: (value: number, ctx: any) => {
                        const total = ctx.dataset.data.reduce((a: number, b: number) => a + b, 0);
                        const percentage = total > 0 ? ((value / total) * 100).toFixed(0) : '0';
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

        {/* Carte Condamnations — même source que les moyennes/taux (getYearlyStats),
            pour que le total, les mois et les pourcentages coïncident partout. */}
        <Card>
          <CardHeader>
            <CardTitle>Condamnations</CardTitle>
            <p className="text-sm text-gray-500">Toutes enquêtes confondues</p>
          </CardHeader>
          <CardContent>
            {(() => {
              const totalCondamnations = yearlyStats.nombreCondamnations;
              const totalAudiences = yearlyStats.nombreAudiences;
              return (
                <>
                  <div className="text-3xl font-bold">{totalCondamnations}</div>
                  <p className="text-sm text-gray-500">
                    Moyenne de {totalAudiences > 0 ? (totalCondamnations / totalAudiences).toFixed(1) : 0} par audience ({totalAudiences} audience{totalAudiences > 1 ? 's' : ''})
                  </p>
                  <div className="mt-4 pt-4 border-t space-y-1">
                    {getMonthsToShow().map(month => {
                      const count = monthlyStats[month]?.nombreCondamnations || 0;
                      return (
                        <div key={month} className="flex justify-between text-sm">
                          <span>{new Date(selectedYear, month).toLocaleString('default', { month: 'long' })}:</span>
                          <span className="font-medium">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                  {/* Subdivision par contentieux */}
                  {isGlobal && condamnationsParContentieux && condamnationsParContentieux.filter(s => s.total > 0).length > 0 && (
                    <div className="mt-4 pt-4 border-t">
                      <p className="text-xs font-medium text-gray-500 mb-2">Par contentieux</p>
                      <div className="space-y-1">
                        {condamnationsParContentieux.filter(s => s.total > 0).map(s => (
                          <div key={s.def.id} className="flex justify-between items-center text-sm">
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.def.color }} />
                              <span className="text-gray-700">{s.def.label}</span>
                            </div>
                            <span className="font-semibold">{s.total}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
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
              // Effectifs et moyennes issus de la MÊME source (getYearlyStats) :
              // avant, les effectifs refiltraient les résultats bruts (audiences
              // en attente et enquêtes non archivées comprises), d'où de possibles
              // écarts avec les moyennes affichées à côté.
              const totalCondamnations = yearlyStats.nombreCondamnations;
              const pctOf = (n: number) => totalCondamnations > 0 ? ((n / totalCondamnations) * 100).toFixed(1) : '0';

              // "12.5 + 6" (ferme + sursis) → décomposition pour l'affichage
              const splitMixte = (s: string): { ferme: number; sursis: number } => {
                const [ferme, sursis] = s.split(' + ').map(Number);
                return { ferme: ferme || 0, sursis: sursis || 0 };
              };
              const mixteProb = splitMixte(yearlyStats.moyenneMixtesProbation);
              const mixteSimple = splitMixte(yearlyStats.moyenneMixtesSimple);

              return (
                <div className="grid gap-3">
                  <div>
                    <div className="font-medium mb-1">Prison ferme uniquement</div>
                    <div className="text-2xl font-bold">{yearlyStats.moyennePrison} mois</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {yearlyStats.nombrePeinesFermes} condamnation{yearlyStats.nombrePeinesFermes > 1 ? 's' : ''} ({pctOf(yearlyStats.nombrePeinesFermes)}%)
                    </div>
                  </div>
                  <div>
                    <div className="font-medium mb-1">Sursis probatoire uniquement</div>
                    <div className="text-2xl font-bold">{yearlyStats.moyenneProbation} mois</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {yearlyStats.nombrePeinesProbation} condamnation{yearlyStats.nombrePeinesProbation > 1 ? 's' : ''} ({pctOf(yearlyStats.nombrePeinesProbation)}%)
                    </div>
                  </div>
                  <div>
                    <div className="font-medium mb-1">Sursis simple uniquement</div>
                    <div className="text-2xl font-bold">{yearlyStats.moyenneSimple} mois</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {yearlyStats.nombrePeinesSimple} condamnation{yearlyStats.nombrePeinesSimple > 1 ? 's' : ''} ({pctOf(yearlyStats.nombrePeinesSimple)}%)
                    </div>
                  </div>
                  <div>
                    <div className="font-medium mb-1">Mixte avec sursis probatoire</div>
                    <div className="text-2xl font-bold">
                      {(mixteProb.ferme + mixteProb.sursis).toFixed(1)} dont {mixteProb.sursis.toFixed(1)} avec sursis probatoire
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {yearlyStats.nombrePeinesMixtesProbation} condamnation{yearlyStats.nombrePeinesMixtesProbation > 1 ? 's' : ''} ({pctOf(yearlyStats.nombrePeinesMixtesProbation)}%)
                    </div>
                  </div>
                  <div>
                    <div className="font-medium mb-1">Mixte avec sursis simple</div>
                    <div className="text-lg">
                      {(mixteSimple.ferme + mixteSimple.sursis).toFixed(1)} dont {mixteSimple.sursis.toFixed(1)} avec sursis simple
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {yearlyStats.nombrePeinesMixtesSimple} condamnation{yearlyStats.nombrePeinesMixtesSimple > 1 ? 's' : ''} ({pctOf(yearlyStats.nombrePeinesMixtesSimple)}%)
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
            <div className="space-y-4">
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
              <div className="border-t pt-2 space-y-2">
                <div className="flex justify-between">
                  <span>Interdictions de gérer</span>
                  <span className="font-bold">{yearlyStats.totalInterdictionsGerer}</span>
                </div>
                <div className="text-sm text-gray-500">
                  {yearlyStats.nombreCondamnations > 0
                    ? ((yearlyStats.totalInterdictionsGerer / yearlyStats.nombreCondamnations) * 100).toFixed(1)
                    : 0}% des condamnations
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Carte Saisies (phase enquête) */}
        <Card>
          <CardHeader>
            <CardTitle>Saisies (enquête)</CardTitle>
            <p className="text-sm text-gray-500">Biens saisis par les services d'enquête</p>
          </CardHeader>
          <CardContent>
            {(() => {
              const hasSaisies = yearlyStats.totalSaisiesVehicules > 0 || yearlyStats.totalSaisiesImmeubles > 0 ||
                yearlyStats.totalSaisiesArgent > 0 || yearlyStats.totalSaisiesObjets > 0;
              const fmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
              if (!hasSaisies) {
                return <p className="text-sm text-gray-400 italic">Aucune saisie renseignée pour cette période</p>;
              }
              return (
                <div className="space-y-4">
                  <div className="space-y-2">
                    {yearlyStats.totalSaisiesVehicules > 0 && (
                      <div className="flex justify-between">
                        <span>Véhicules saisis</span>
                        <span className="font-bold">{yearlyStats.totalSaisiesVehicules}</span>
                      </div>
                    )}
                    {yearlyStats.totalSaisiesImmeubles > 0 && (
                      <div className="flex justify-between">
                        <span>Immeubles saisis</span>
                        <span className="font-bold">{yearlyStats.totalSaisiesImmeubles}</span>
                      </div>
                    )}
                  </div>
                  {(yearlyStats.totalSaisiesNumeraire > 0 || yearlyStats.totalSaisiesBancaire > 0 || yearlyStats.totalSaisiesCrypto > 0) && (
                    <div className="border-t pt-2 space-y-2">
                      <p className="text-xs text-gray-500 font-medium uppercase">Avoirs financiers saisis</p>
                      {yearlyStats.totalSaisiesNumeraire > 0 && (
                        <div className="flex justify-between">
                          <span>Numéraire (espèces)</span>
                          <span className="font-bold">{fmt.format(yearlyStats.totalSaisiesNumeraire)}</span>
                        </div>
                      )}
                      {yearlyStats.totalSaisiesBancaire > 0 && (
                        <div className="flex justify-between">
                          <span>Comptes bancaires</span>
                          <span className="font-bold">{fmt.format(yearlyStats.totalSaisiesBancaire)}</span>
                        </div>
                      )}
                      {yearlyStats.totalSaisiesCrypto > 0 && (
                        <div className="flex justify-between">
                          <span>Cryptomonnaies</span>
                          <span className="font-bold">{fmt.format(yearlyStats.totalSaisiesCrypto)}</span>
                        </div>
                      )}
                      <div className="flex justify-between border-t pt-1">
                        <span className="font-medium">Total avoirs saisis</span>
                        <span className="font-bold">{fmt.format(yearlyStats.totalSaisiesArgent)}</span>
                      </div>
                    </div>
                  )}
                  {yearlyStats.totalSaisiesObjets > 0 && (
                    <div className="border-t pt-2">
                      <div className="flex justify-between">
                        <span>Objets mobiliers saisis</span>
                        <span className="font-bold">{yearlyStats.totalSaisiesObjets}</span>
                      </div>
                    </div>
                  )}
                  {(yearlyStats.nombreRemisesAvantJugement > 0 ||
                    yearlyStats.nombreVentesAvantJugement > 0) && (
                    <div className="border-t pt-2 space-y-2">
                      <p className="text-xs text-gray-500 font-medium uppercase">
                        Disposition avant jugement
                      </p>
                      {yearlyStats.nombreRemisesAvantJugement > 0 && (
                        <div className="flex justify-between">
                          <span>Remises avant jugement</span>
                          <span className="font-bold">{yearlyStats.nombreRemisesAvantJugement}</span>
                        </div>
                      )}
                      {yearlyStats.nombreVentesAvantJugement > 0 && (
                        <div className="flex justify-between">
                          <span>Ventes avant jugement</span>
                          <span className="font-bold">{yearlyStats.nombreVentesAvantJugement}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </CardContent>
        </Card>

        {/* Carte Confiscations (résultats d'audience) */}
        <Card>
          <CardHeader>
            <CardTitle>Confiscations (audience)</CardTitle>
            <p className="text-sm text-gray-500">Biens confisqués par décision du tribunal</p>
          </CardHeader>
          <CardContent>
            {(() => {
              const hasConfiscations = yearlyStats.totalVehicules > 0 || yearlyStats.totalImmeubles > 0 ||
                yearlyStats.totalArgent > 0 || yearlyStats.totalObjets > 0 || yearlyStats.totalStupefiants > 0;
              const fmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
              if (!hasConfiscations) {
                return <p className="text-sm text-gray-400 italic">Aucune confiscation renseignée pour cette période</p>;
              }
              return (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span>Véhicules confisqués</span>
                      <span className="font-bold">{yearlyStats.totalVehicules}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Immeubles confisqués</span>
                      <span className="font-bold">{yearlyStats.totalImmeubles}</span>
                    </div>
                  </div>
                  <div className="border-t pt-2 space-y-2">
                    <p className="text-xs text-gray-500 font-medium uppercase">Avoirs financiers confisqués</p>
                    <div className="flex justify-between">
                      <span>Numéraire (espèces)</span>
                      <span className="font-bold">{fmt.format(yearlyStats.totalNumeraire)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Comptes bancaires</span>
                      <span className="font-bold">{fmt.format(yearlyStats.totalBancaire)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Cryptomonnaies</span>
                      <span className="font-bold">{fmt.format(yearlyStats.totalCrypto)}</span>
                    </div>
                    <div className="flex justify-between border-t pt-1">
                      <span className="font-medium">Total avoirs confisqués</span>
                      <span className="font-bold">{fmt.format(yearlyStats.totalArgent)}</span>
                    </div>
                  </div>
                  {(yearlyStats.totalObjets > 0 || yearlyStats.totalStupefiants > 0) && (
                    <div className="border-t pt-2 space-y-2">
                      {yearlyStats.totalObjets > 0 && (
                        <div className="flex justify-between">
                          <span>Objets mobiliers confisqués</span>
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
                    Ratio de {yearlyStats.ratioConfiscations.toFixed(2)} confiscations par condamnation
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>

        {/* Carte Delta Saisies vs Confiscations */}
        {(yearlyStats.totalSaisiesVehicules > 0 || yearlyStats.totalSaisiesArgent > 0 || yearlyStats.totalSaisiesImmeubles > 0 || yearlyStats.totalSaisiesObjets > 0 ||
          yearlyStats.totalVehicules > 0 || yearlyStats.totalArgent > 0 || yearlyStats.totalImmeubles > 0 || yearlyStats.totalObjets > 0) && (
          <Card>
            <CardHeader>
              <CardTitle>Delta saisies vs confiscations</CardTitle>
              <p className="text-sm text-gray-500">Comparaison entre les saisies (enquête) et les confiscations (audience)</p>
            </CardHeader>
            <CardContent>
              {(() => {
                const fmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
                const items: { label: string; saisie: number; confiscation: number; isAmount?: boolean }[] = [
                  { label: 'Véhicules', saisie: yearlyStats.totalSaisiesVehicules, confiscation: yearlyStats.totalVehicules },
                  { label: 'Immeubles', saisie: yearlyStats.totalSaisiesImmeubles, confiscation: yearlyStats.totalImmeubles },
                  { label: 'Numéraire', saisie: yearlyStats.totalSaisiesNumeraire, confiscation: yearlyStats.totalNumeraire, isAmount: true },
                  { label: 'Bancaire', saisie: yearlyStats.totalSaisiesBancaire, confiscation: yearlyStats.totalBancaire, isAmount: true },
                  { label: 'Crypto', saisie: yearlyStats.totalSaisiesCrypto, confiscation: yearlyStats.totalCrypto, isAmount: true },
                  { label: 'Objets mobiliers', saisie: yearlyStats.totalSaisiesObjets, confiscation: yearlyStats.totalObjets },
                ];
                const totalSaisiesFinancier = yearlyStats.totalSaisiesNumeraire + yearlyStats.totalSaisiesBancaire + yearlyStats.totalSaisiesCrypto;
                const totalConfiscationsFinancier = yearlyStats.totalNumeraire + yearlyStats.totalBancaire + yearlyStats.totalCrypto;

                return (
                  <div className="space-y-3">
                    <div className="grid grid-cols-4 gap-2 text-xs font-medium text-gray-500 border-b pb-1">
                      <span></span>
                      <span className="text-right">Saisi</span>
                      <span className="text-right">Confisqué</span>
                      <span className="text-right">Delta</span>
                    </div>
                    {items.map(({ label, saisie, confiscation, isAmount }) => {
                      const delta = saisie - confiscation;
                      const hasData = saisie > 0 || confiscation > 0;
                      if (!hasData) return null;
                      return (
                        <div key={label} className="grid grid-cols-4 gap-2 text-sm items-center">
                          <span>{label}</span>
                          <span className="text-right font-medium">{isAmount ? fmt.format(saisie) : saisie}</span>
                          <span className="text-right font-medium">{isAmount ? fmt.format(confiscation) : confiscation}</span>
                          <span className={`text-right font-bold ${delta > 0 ? 'text-orange-600' : delta < 0 ? 'text-green-600' : 'text-gray-500'}`}>
                            {delta > 0 ? '+' : ''}{isAmount ? fmt.format(delta) : delta}
                          </span>
                        </div>
                      );
                    })}
                    <div className="grid grid-cols-4 gap-2 text-sm items-center border-t pt-2 font-medium">
                      <span>Total avoirs</span>
                      <span className="text-right">{fmt.format(totalSaisiesFinancier)}</span>
                      <span className="text-right">{fmt.format(totalConfiscationsFinancier)}</span>
                      <span className={`text-right font-bold ${totalSaisiesFinancier - totalConfiscationsFinancier > 0 ? 'text-orange-600' : totalSaisiesFinancier - totalConfiscationsFinancier < 0 ? 'text-green-600' : 'text-gray-500'}`}>
                        {totalSaisiesFinancier - totalConfiscationsFinancier > 0 ? '+' : ''}{fmt.format(totalSaisiesFinancier - totalConfiscationsFinancier)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-2">
                      Orange = saisi non confisqué par le juge. Vert = confiscation {'>'} saisie.
                    </p>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        )}

        {/* Carte Interdictions de gérer par tag d'infraction */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Interdictions de gérer
              <Filter className="h-4 w-4 text-gray-400" />
            </CardTitle>
            <p className="text-sm text-gray-500">Pourcentage filtrable par type d'infraction</p>
          </CardHeader>
          <CardContent>
            {(() => {
              // Filtre multi-select — options dérivées des résultats de l'année
              // (clé NATINF ou libellé legacy), donc évolutif : plus de
              // dépendance aux tags « type d'infraction » d'avant migration.
              const allYearResults = Object.values(scopedResultats)
                .filter(r => r.dateAudience && new Date(r.dateAudience).getFullYear() === selectedYear && !r.isOI && !r.isClassement && !r.isAudiencePending);

              const availableKeys = [...new Set(allYearResults.flatMap(resultInfractionKeys))]
                .sort((a, b) => labelForInfractionKey(a).localeCompare(labelForInfractionKey(b), 'fr'));

              const filteredResults = selectedGererTags.length > 0
                ? allYearResults.filter(r => resultInfractionKeys(r).some(k => selectedGererTags.includes(k)))
                : allYearResults;

              const totalCondFiltered = filteredResults.reduce((acc, r) => acc + (r.condamnations || []).length, 0);
              const totalGererFiltered = filteredResults.reduce((acc, r) =>
                acc + (r.condamnations || []).filter(c => c.interdictionGerer).length, 0);
              const ratioFiltered = totalCondFiltered > 0 ? ((totalGererFiltered / totalCondFiltered) * 100).toFixed(1) : '0';

              return (
                <div className="space-y-4">
                  {/* Sélecteur d'infractions (année courante) */}
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">Filtrer par infractions (vide = toutes)</label>
                    <div className="flex flex-wrap gap-1.5">
                      {availableKeys.map(key => {
                        const isSelected = selectedGererTags.includes(key);
                        return (
                          <button
                            key={key}
                            onClick={() => {
                              setSelectedGererTags(prev =>
                                isSelected ? prev.filter(t => t !== key) : [...prev, key]
                              );
                            }}
                            className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                              isSelected
                                ? 'bg-purple-100 border-purple-300 text-purple-800'
                                : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                            }`}
                          >
                            {labelForInfractionKey(key)}
                          </button>
                        );
                      })}
                    </div>
                    {selectedGererTags.length > 0 && (
                      <button
                        onClick={() => setSelectedGererTags([])}
                        className="text-xs text-gray-400 hover:text-gray-600 mt-1"
                      >
                        Réinitialiser le filtre
                      </button>
                    )}
                  </div>

                  {/* Résultat */}
                  <div>
                    <div className="flex justify-between items-baseline">
                      <span className="text-2xl font-bold">{totalGererFiltered}</span>
                      <span className="text-lg font-medium text-purple-600">{ratioFiltered}%</span>
                    </div>
                    <p className="text-sm text-gray-500">
                      {totalGererFiltered} interdiction{totalGererFiltered > 1 ? 's' : ''} de gérer sur {totalCondFiltered} condamnation{totalCondFiltered > 1 ? 's' : ''}
                      {selectedGererTags.length > 0 && ` (filtré sur ${selectedGererTags.length} tag${selectedGererTags.length > 1 ? 's' : ''})`}
                    </p>
                  </div>

                  {/* Détail par infraction si pas de filtre */}
                  {selectedGererTags.length === 0 && (
                    <div className="border-t pt-2 space-y-1">
                      {Object.entries(
                        allYearResults.reduce<Record<string, { total: number; gerer: number }>>((acc, r) => {
                          const keys = resultInfractionKeys(r);
                          for (const key of keys.length > 0 ? keys : ['Non renseigné']) {
                            if (!acc[key]) acc[key] = { total: 0, gerer: 0 };
                            acc[key].total += r.condamnations.length;
                            acc[key].gerer += r.condamnations.filter(c => c.interdictionGerer).length;
                          }
                          return acc;
                        }, {})
                      )
                        .filter(([, v]) => v.gerer > 0)
                        .sort(([, a], [, b]) => b.gerer - a.gerer)
                        .map(([key, { total, gerer }]) => (
                          <div key={key} className="flex justify-between text-sm">
                            <span>{labelForInfractionKey(key)}</span>
                            <span className="font-medium">{gerer}/{total} ({total > 0 ? ((gerer / total) * 100).toFixed(0) : 0}%)</span>
                          </div>
                        ))
                      }
                    </div>
                  )}
                </div>
              );
            })()}
          </CardContent>
        </Card>

        {/* Carte Peines moyennes par type d'infraction (masquée en mode global) */}
        {contentieuxId !== 'global' && <Card className="col-span-full">
          <CardHeader>
            <CardTitle>Peines moyennes par type d'infraction (mois)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {yearlyStats.peinesParInfraction ?
                Object.entries(yearlyStats.peinesParInfraction).map(([key, stats]) => {
                  const entry = getByCode(key);
                  return (
                  <div key={key} className="bg-gray-50 p-4 rounded-lg">
                    <div className="font-medium mb-2 inline-flex items-center gap-1.5">
                      {entry?.libelle ?? key}
                      {entry && <NatinfBadge compact code={entry.code} nature={entry.nature} quantumLabel={entry.quantumLabel} />}
                    </div>
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
                  );
                })
                : <div>Aucune donnée disponible</div>
              }
            </div>
          </CardContent>
        </Card>}

        {/* Carte Peines moyennes par type d'audience (masquée en mode global) */}
        {contentieuxId !== 'global' && <Card>
          <CardHeader>
            <CardTitle>Peines moyennes par type d'audience</CardTitle>
            <p className="text-sm text-gray-500">Condamnations de l'année {selectedYear}</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {['CRPC-Def', 'CI', 'COPJ', 'CDD'].map(type => {
                // Filtré par année d'audience — avant, cette carte agrégeait
                // toutes les années confondues, insensible au sélecteur.
                const condamnationsOfType = Object.values(scopedResultats)
                  .filter(r => r.dateAudience && new Date(r.dateAudience).getFullYear() === selectedYear)
                  .flatMap(r => r.condamnations || [])
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
        </Card>}

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
              // Clé canonique → item représentatif (préférer celui qui a un code)
              // pour l'affichage (libellé + pastille NATINF).
              const infractionReps = new Map<string, ReturnType<typeof infractionsForEnquete>[number]>();

              classementResults.forEach(r => {
                const enquete = enquetes.find(e => e.id === r.enqueteId);
                if (enquete) {
                  const dateDebut = new Date(enquete.dateDebut);
                  const dateFin = new Date(r.dateAudience);
                  const ageJours = Math.floor((dateFin.getTime() - dateDebut.getTime()) / (1000 * 60 * 60 * 24));
                  if (ageJours >= 0) { totalAge += ageJours; countAge++; }
                  infractionsForEnquete(enquete).forEach(inf => {
                    const k = keyOf(inf);
                    if (!k) return;
                    infractionCounts[k] = (infractionCounts[k] || 0) + 1;
                    const existing = infractionReps.get(k);
                    if (!existing || (!existing.code && inf.code)) infractionReps.set(k, inf);
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
                        {sortedInfractions.map(([key, count]) => {
                          const rep = infractionReps.get(key);
                          return (
                          <div key={key} className="flex justify-between text-sm">
                            <span className="inline-flex items-center gap-1.5">
                              {rep?.label ?? key}
                              {rep?.code ? <NatinfBadge compact code={rep.code} nature={rep.nature} quantumLabel={rep.quantumLabel} /> : null}
                            </span>
                            <span className="font-medium">{count} ({totalInfractions > 0 ? ((count / totalInfractions) * 100).toFixed(0) : 0}%)</span>
                          </div>
                          );
                        })}
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
              // Clé canonique → item représentatif (préférer celui qui a un code)
              // pour l'affichage (libellé + pastille NATINF).
              const infractionReps = new Map<string, ReturnType<typeof infractionsForEnquete>[number]>();

              oiResults.forEach(r => {
                const enquete = enquetes.find(e => e.id === r.enqueteId);
                if (enquete) {
                  const dateDebut = new Date(enquete.dateDebut);
                  const dateFin = new Date(r.dateAudience);
                  const ageJours = Math.floor((dateFin.getTime() - dateDebut.getTime()) / (1000 * 60 * 60 * 24));
                  if (ageJours >= 0) { totalAge += ageJours; countAge++; }
                  infractionsForEnquete(enquete).forEach(inf => {
                    const k = keyOf(inf);
                    if (!k) return;
                    infractionCounts[k] = (infractionCounts[k] || 0) + 1;
                    const existing = infractionReps.get(k);
                    if (!existing || (!existing.code && inf.code)) infractionReps.set(k, inf);
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
                        {sortedInfractions.map(([key, count]) => {
                          const rep = infractionReps.get(key);
                          return (
                          <div key={key} className="flex justify-between text-sm">
                            <span className="inline-flex items-center gap-1.5">
                              {rep?.label ?? key}
                              {rep?.code ? <NatinfBadge compact code={rep.code} nature={rep.nature} quantumLabel={rep.quantumLabel} /> : null}
                            </span>
                            <span className="font-medium">{count} ({totalInfractions > 0 ? ((count / totalInfractions) * 100).toFixed(0) : 0}%)</span>
                          </div>
                          );
                        })}
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
