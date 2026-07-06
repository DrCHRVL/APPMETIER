import React, { useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Pie, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { AlertTriangle, Clock, Gavel, Users, FileText } from 'lucide-react';
import type { DossierInstruction } from '@/types/instructionTypes';
import { useInstructionStats } from '@/hooks/useInstructionStats';
import { useInstructionCabinets } from '@/hooks/useInstructionCabinets';
import { useNatinf } from '@/hooks/useNatinf';
import { categoryForEntry } from '@/lib/natinf/nataff';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, ChartDataLabels);

interface InstructionStatsProps {
  /** Dossiers déjà filtrés par contentieux en amont (cf. app/page.tsx). */
  dossiers: DossierInstruction[];
  selectedYear?: number;
}

const SURETE_COLORS = {
  detenu: '#dc2626',
  arse: '#f97316',
  cj: '#f59e0b',
  libre: '#16a34a',
};

const formatDays = (j: number): string => {
  if (!isFinite(j)) return '—';
  const r = Math.round(j);
  if (r < 60) return `${r} j`;
  const mois = Math.round(r / 30);
  return `${mois} mois`;
};

const formatNumber = (n: number, digits = 1): string =>
  Number.isInteger(n) ? String(n) : n.toFixed(digits);

export const InstructionStats: React.FC<InstructionStatsProps> = ({ dossiers }) => {
  // NB : ces statistiques sont une photographie du STOCK ACTUEL des dossiers
  // d'instruction — elles ne dépendent pas de l'année sélectionnée sur la page
  // (contrairement aux stats d'enquêtes/audiences). Une note l'indique à l'écran.
  const stats = useInstructionStats(dossiers);
  const { allCabinets } = useInstructionCabinets();
  const { getByCode } = useNatinf();

  const cabinetLabel = (id: string) =>
    allCabinets.find(c => c.id === id)?.label || (id === 'inconnu' ? 'Cabinet inconnu' : id);
  const cabinetColor = (id: string) =>
    allCabinets.find(c => c.id === id)?.color || '#94a3b8';

  // Top 8 catégories d'infraction (taxonomie NATINF / Mémento parquet) des
  // chefs de mise en examen des dossiers actifs. On abandonne l'ancien
  // regroupement par libellé de tag : chaque chef est résolu vers sa catégorie
  // NATINF (Vol, Stupéfiants, Blanchiment…). Un dossier est compté une fois par
  // catégorie qu'il touche, quel que soit le nombre de chefs concernés.
  const topFaits = useMemo(() => {
    const counts: Record<string, number> = {};
    dossiers
      .filter(d => !d.archived)
      .forEach(d => {
        const categories = new Set<string>();
        (d.misEnExamen || []).forEach(m => {
          (m.infractions || []).forEach(inf => {
            const entry = inf.natinfCode ? getByCode(inf.natinfCode) : undefined;
            // À défaut d'entrée au référentiel, on tente le classement par
            // libellé (repli mot-clé de categoryForEntry).
            const resolved = categoryForEntry(
              entry ?? { code: inf.natinfCode || '', libelle: inf.qualification || '', theme: undefined },
            );
            categories.add(resolved?.category.label ?? 'Autres / non classé');
          });
        });
        categories.forEach(c => {
          counts[c] = (counts[c] || 0) + 1;
        });
      });
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8);
  }, [dossiers, getByCode]);

  const sureteData = {
    labels: ['Détenu', 'ARSE', 'Contrôle judiciaire', 'Libre'],
    datasets: [
      {
        data: [stats.nbDetenus, stats.nbARSE, stats.nbCJ, stats.nbLibres],
        backgroundColor: [
          SURETE_COLORS.detenu,
          SURETE_COLORS.arse,
          SURETE_COLORS.cj,
          SURETE_COLORS.libre,
        ],
      },
    ],
  };

  const faitsData = {
    labels: topFaits.map(([q]) => (q.length > 35 ? q.slice(0, 35) + '…' : q)),
    datasets: [
      {
        label: 'Nb de dossiers',
        data: topFaits.map(([, v]) => v),
        backgroundColor: '#3498db',
      },
    ],
  };

  const cabinetEntries = Object.entries(stats.ageMoyenClotureParCabinet)
    .sort(([, a], [, b]) => a.agePondereParMexJours - b.agePondereParMexJours);

  return (
    <div className="space-y-6">
      <p className="text-xs text-gray-500 -mb-2">
        Photographie du stock actuel des dossiers d'instruction — indépendante de l'année sélectionnée.
      </p>

      {/* Ligne 1 — Compteurs principaux */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="w-4 h-4 text-slate-500" />
              Dossiers d'instruction
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.nbDossiersActifs}</div>
            <p className="text-xs text-gray-500 mt-1">
              actifs · {stats.nbDossiersArchives} archivés · {stats.nbDossiers} au total
            </p>
            <div className="mt-3 pt-3 border-t space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Au règlement</span>
                <span className="font-semibold">{stats.nbDossiersAuReglement}</span>
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>· 175 reçu</span>
                <span>{stats.nbDossiers175Recu}</span>
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>· Réq. déf. rédigées</span>
                <span>{stats.nbDossiersReqDef}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="w-4 h-4 text-slate-500" />
              Mis en examen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.nbMisEnExamen}</div>
            <p className="text-xs text-gray-500 mt-1">total dossiers actifs</p>
            <div className="mt-3 pt-3 border-t space-y-1 text-sm">
              <div className="flex justify-between">
                <span style={{ color: SURETE_COLORS.detenu }} className="font-medium">Détenus</span>
                <span className="font-semibold">{stats.nbDetenus}</span>
              </div>
              <div className="flex justify-between text-gray-700">
                <span>ARSE</span><span>{stats.nbARSE}</span>
              </div>
              <div className="flex justify-between text-gray-700">
                <span>Contrôle judiciaire</span><span>{stats.nbCJ}</span>
              </div>
              <div className="flex justify-between text-gray-700">
                <span>Libres</span><span>{stats.nbLibres}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="w-4 h-4 text-slate-500" />
              Âge des dossiers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{formatDays(stats.ageMoyenDossiersActifs)}</div>
            <p className="text-xs text-gray-500 mt-1">âge moyen dossiers actifs</p>
            <div className="mt-3 pt-3 border-t space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Au règlement</span>
                <span className="font-semibold">{formatDays(stats.ageMoyenAuReglement)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Dossier le plus ancien</span>
                <span className="font-semibold">{formatDays(stats.ageMaxDossierActif)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="w-4 h-4 text-slate-500" />
              Volume procédural
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{formatNumber(stats.cotesMoyennes)}</div>
            <p className="text-xs text-gray-500 mt-1">cotes/tomes par dossier (moyenne)</p>
            <div className="mt-3 pt-3 border-t space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Cotes totales</span>
                <span className="font-semibold">{stats.cotesTotal}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">DML / dossier</span>
                <span className="font-semibold">{formatNumber(stats.dmlMoyenParDossier, 2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">DML en attente</span>
                <span className="font-semibold">{stats.nbDmlEnAttente}</span>
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>DML total</span>
                <span>{stats.nbDmlTotal}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Ligne 2 — Art. 175 à régler + Mesures de sûreté */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Gavel className="w-4 h-4 text-purple-600" />
              Dossiers à régler (art. 175 CPP)
            </CardTitle>
            <p className="text-xs text-gray-500">
              175 rendu = avis de fin d'information. Délai de règlement 1 mois si détenu.
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-4">
              <div>
                <div className="text-3xl font-bold">{stats.dossiersARegler.total}</div>
                <p className="text-xs text-gray-500">175 rendu</p>
              </div>
              <div>
                <div className="text-2xl font-semibold text-red-600">
                  {stats.dossiersARegler.avecDetenu}
                </div>
                <p className="text-xs text-gray-500">dont avec détenu</p>
              </div>
            </div>

            {stats.dossiersARegler.urgents.length > 0 && (
              <div className="mt-4 pt-4 border-t">
                <p className="text-xs font-medium text-gray-600 mb-2 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  Échéances (détenu, 1 mois après 175 rendu)
                </p>
                <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                  {stats.dossiersARegler.urgents.map(u => {
                    const enRetard = u.joursRestants < 0;
                    return (
                      <div
                        key={u.dossierId}
                        className="flex justify-between items-center text-xs px-2 py-1 rounded bg-slate-50"
                      >
                        <span className="font-mono truncate" title={u.numeroInstruction}>
                          {u.numeroInstruction}
                        </span>
                        <span
                          className={`font-semibold ${
                            enRetard ? 'text-red-600' : u.joursRestants <= 7 ? 'text-amber-600' : 'text-gray-700'
                          }`}
                          title={u.approx ? "Date du 175 non renseignée : échéance estimée depuis la dernière modification du dossier" : undefined}
                        >
                          {u.approx ? '≈ ' : ''}{enRetard ? `Retard ${-u.joursRestants} j` : `${u.joursRestants} j restants`}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {stats.dossiersARegler.urgents.some(u => u.approx) && (
                  <p className="text-[11px] text-gray-400 mt-1.5">
                    ≈ : date du 175 non renseignée sur le dossier — échéance estimée.
                    Renseignez l'événement « 175 rendu » pour une échéance exacte.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Répartition des mesures de sûreté</CardTitle>
            <p className="text-xs text-gray-500">Mis en examen — dossiers actifs</p>
          </CardHeader>
          <CardContent>
            {stats.nbMisEnExamen > 0 ? (
              <div style={{ maxHeight: 240 }}>
                <Pie
                  data={sureteData}
                  options={{
                    maintainAspectRatio: false,
                    plugins: {
                      legend: { position: 'bottom' as const },
                      datalabels: {
                        color: '#fff',
                        font: { weight: 'bold' as const },
                        formatter: (v: number) => (v > 0 ? v : ''),
                      },
                    },
                  }}
                />
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">Aucun mis en examen.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Ligne 3 — Faits et cabinets */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Principales catégories d'infraction</CardTitle>
            <p className="text-xs text-gray-500">Top 8 — catégories NATINF des MEX (dossiers actifs)</p>
          </CardHeader>
          <CardContent>
            {topFaits.length > 0 ? (
              <div style={{ maxHeight: 320 }}>
                <Bar
                  data={faitsData}
                  options={{
                    indexAxis: 'y' as const,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: { display: false },
                      datalabels: {
                        anchor: 'end' as const,
                        align: 'end' as const,
                        color: '#1f2937',
                        font: { weight: 'bold' as const },
                      },
                    },
                    scales: {
                      x: { beginAtZero: true, ticks: { precision: 0 } },
                    },
                  }}
                />
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">Aucune infraction renseignée.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Délai moyen de clôture par cabinet</CardTitle>
            <p className="text-xs text-gray-500">
              Dossiers archivés — pondération par nombre de mis en examen
            </p>
          </CardHeader>
          <CardContent>
            {cabinetEntries.length > 0 ? (
              <div className="space-y-2">
                {cabinetEntries.map(([cab, v]) => (
                  <div key={cab} className="border rounded-lg p-2">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: cabinetColor(cab) }}
                        />
                        <span className="text-sm font-medium">{cabinetLabel(cab)}</span>
                      </div>
                      <span className="text-xs text-gray-500">
                        {v.nbDossiers} dossier{v.nbDossiers > 1 ? 's' : ''} · {v.nbMexTotal} MEX
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-600">Âge moyen brut</span>
                      <span className="font-semibold">{formatDays(v.ageMoyenJours)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-600">Pondéré par nb MEX</span>
                      <span className="font-semibold text-slate-800">
                        {formatDays(v.agePondereParMexJours)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">
                Aucun dossier archivé pour ce contentieux.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
