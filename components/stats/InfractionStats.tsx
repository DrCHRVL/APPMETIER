import React from 'react';
import { ChevronRight } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Enquete } from '@/types/interfaces';
import { useAudience } from '@/hooks/useAudience';
import { useInfractionNatinf, type EnqueteInfractionItem } from '@/hooks/useInfractionNatinf';
import { categoryForEntry } from '@/lib/natinf/nataff';
// Le comptage (une enquête = 1 par catégorie touchée) et le repli par grand
// titre vivent dans le module PARTAGÉ lib/stats/ecranCore.mjs — même source que
// le connecteur Claude web (outil `stats_ecran`).
import {
  repartitionCategoriesInfraction,
  enquetesEnCoursPourInfractions,
  enquetesTermineesPourInfractions,
} from '@/lib/stats/ecranCore.mjs';

/**
 * Répartition des enquêtes par catégorie d'infraction (taxonomie Mémento
 * parquet) : catégorie métier parlante (Vol, Stupéfiants, Proxénétisme…),
 * repliable sous son grand titre (Atteintes aux personnes / aux biens…). Une
 * enquête est comptée une fois par catégorie qu'elle touche, quel que soit le
 * nombre de NATINF qui s'y rattachent.
 */
const NataffBreakdownCard = ({
  title,
  subtitle,
  enquetes,
  infractionsForEnquete,
}: {
  title: string;
  subtitle?: string;
  enquetes: Enquete[];
  infractionsForEnquete: (e: Enquete) => EnqueteInfractionItem[];
}) => {
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  const { groups, unclassified } = React.useMemo(() => {
    const { groupes, nonClasse } = repartitionCategoriesInfraction(
      enquetes,
      infractionsForEnquete,
      (inf: EnqueteInfractionItem) => categoryForEntry(inf.entry),
    );
    return {
      groups: groupes as { code: string; grandTitre: string; total: number; categories: { code: string; categorie: string; count: number }[] }[],
      unclassified: nonClasse as number,
    };
  }, [enquetes, infractionsForEnquete]);

  const toggle = (code: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
      </CardHeader>
      <CardContent>
        {groups.length === 0 ? (
          <div className="text-center text-gray-500 py-4">Aucune enquête avec infraction répertoriée</div>
        ) : (
          <div className="space-y-1">
            {groups.map((g) => {
              const isOpen = expanded.has(g.code);
              return (
                <div key={g.code}>
                  <button
                    onClick={() => toggle(g.code)}
                    className="flex w-full items-center justify-between gap-2 rounded bg-gray-50 p-2 text-left hover:bg-gray-100 transition-colors"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <ChevronRight
                        className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                      />
                      <span className="truncate font-medium">{g.grandTitre}</span>
                    </span>
                    <span className="shrink-0 text-sm">
                      <span className="font-semibold">{g.total}</span> enquête{g.total > 1 ? 's' : ''}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="ml-6 mt-1 space-y-1 border-l border-gray-100 pl-3">
                      {g.categories.map(({ code, categorie, count }) => (
                        <div key={code} className="flex items-center justify-between gap-2 text-sm">
                          <span className="truncate text-gray-700">{categorie}</span>
                          <span className="shrink-0 font-medium">{count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {unclassified > 0 && (
              <div className="flex items-center justify-between gap-2 rounded bg-gray-50 p-2 text-sm text-gray-500">
                <span className="italic">Non classé (sans catégorie)</span>
                <span className="font-medium">{unclassified}</span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

interface InfractionStatsProps {
  enquetes: Enquete[];
  selectedYear: number;
  contentieuxId?: string;
}

export const InfractionStats = ({ enquetes, selectedYear, contentieuxId }: InfractionStatsProps) => {
  const { audienceState } = useAudience();
  const { infractionsForEnquete } = useInfractionNatinf();

  // Listes d'enquêtes (en cours / terminées) servant aux répartitions par
  // catégorie d'infraction (taxonomie NATAFF / Mémento parquet) — mêmes
  // populations que le connecteur, via ecranCore.
  const scopedResultats = React.useMemo(() => {
    const all = audienceState?.resultats || {};
    if (!contentieuxId || contentieuxId === 'global') return all;
    return Object.fromEntries(
      Object.entries(all).filter(([, r]) => (r.contentieuxId || 'crimorg') === contentieuxId),
    );
  }, [audienceState?.resultats, contentieuxId]);

  const enquetesEnCours: Enquete[] = React.useMemo(
    () => enquetesEnCoursPourInfractions(enquetes, selectedYear),
    [enquetes, selectedYear],
  );

  const enquetesTerminees: Enquete[] = React.useMemo(
    () => enquetesTermineesPourInfractions(scopedResultats, enquetes, selectedYear),
    [scopedResultats, enquetes, selectedYear],
  );

  return (
    <div className="space-y-6">
      {/* Répartition par catégorie d'infraction (taxonomie Mémento), repliable par grand titre */}
      <NataffBreakdownCard
        title={`Répartition des enquêtes en cours par catégorie d'infraction (${selectedYear})`}
        subtitle="Catégories du parquet, repliables par grand titre. Cliquer pour voir le détail."
        enquetes={enquetesEnCours}
        infractionsForEnquete={infractionsForEnquete}
      />
      <NataffBreakdownCard
        title={`Répartition des enquêtes terminées par catégorie d'infraction (${selectedYear})`}
        subtitle="Hors classements sans suite et ouvertures d'information."
        enquetes={enquetesTerminees}
        infractionsForEnquete={infractionsForEnquete}
      />
    </div>
  );
};
