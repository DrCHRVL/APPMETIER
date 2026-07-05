import React from 'react';
import { ChevronRight } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Enquete } from '@/types/interfaces';
import { useAudience } from '@/hooks/useAudience';
import { useInfractionNatinf, type EnqueteInfractionItem } from '@/hooks/useInfractionNatinf';
import { categoryForEntry, GRAND_TITRES, STAT_CATEGORIES } from '@/lib/natinf/nataff';

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
    const gtSets = new Map<string, Set<number>>(); // code grand titre -> ids d'enquête
    const catSets = new Map<string, Set<number>>(); // code catégorie -> ids d'enquête
    const unclassifiedSet = new Set<number>();
    const add = (map: Map<string, Set<number>>, code: string, id: number) => {
      let s = map.get(code);
      if (!s) map.set(code, (s = new Set()));
      s.add(id);
    };
    enquetes.forEach((e) => {
      infractionsForEnquete(e).forEach((inf) => {
        const res = categoryForEntry(inf.entry);
        if (!res) {
          if (inf.label) unclassifiedSet.add(e.id);
          return;
        }
        add(gtSets, res.grandTitre.code, e.id);
        add(catSets, res.category.code, e.id);
      });
    });
    const built = GRAND_TITRES.map((gt) => ({
      gt,
      total: gtSets.get(gt.code)?.size || 0,
      children: STAT_CATEGORIES.filter(
        (c) => c.grandTitre === gt.code && (catSets.get(c.code)?.size || 0) > 0,
      )
        .map((c) => ({ category: c, count: catSets.get(c.code)!.size }))
        .sort((a, b) => b.count - a.count),
    }))
      .filter((g) => g.total > 0)
      .sort((a, b) => b.total - a.total);
    return { groups: built, unclassified: unclassifiedSet.size };
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
              const isOpen = expanded.has(g.gt.code);
              return (
                <div key={g.gt.code}>
                  <button
                    onClick={() => toggle(g.gt.code)}
                    className="flex w-full items-center justify-between gap-2 rounded bg-gray-50 p-2 text-left hover:bg-gray-100 transition-colors"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <ChevronRight
                        className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                      />
                      <span className="truncate font-medium">{g.gt.label}</span>
                    </span>
                    <span className="shrink-0 text-sm">
                      <span className="font-semibold">{g.total}</span> enquête{g.total > 1 ? 's' : ''}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="ml-6 mt-1 space-y-1 border-l border-gray-100 pl-3">
                      {g.children.map(({ category, count }) => (
                        <div key={category.code} className="flex items-center justify-between gap-2 text-sm">
                          <span className="truncate text-gray-700">{category.label}</span>
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
  // catégorie d'infraction (taxonomie NATAFF / Mémento parquet).
  const enquetesEnCours = React.useMemo(
    () => enquetes.filter((e) => {
      if (e.statut !== 'en_cours') return false;
      return new Date(e.dateCreation).getFullYear() <= selectedYear;
    }),
    [enquetes, selectedYear],
  );

  const enquetesTerminees = React.useMemo(
    () => enquetes.filter((e) => {
      if (e.statut !== 'archive') return false;
      const audienceResult = Object.values(audienceState?.resultats || {}).find((r) => {
        if (r.enqueteId !== e.id) return false;
        if (!contentieuxId || contentieuxId === 'global') return true;
        const ctx = r.contentieuxId || 'crimorg';
        return ctx === contentieuxId;
      });
      if (!audienceResult?.dateAudience) return false;
      if (audienceResult.isClassement || audienceResult.isOI) return false;
      return new Date(audienceResult.dateAudience).getFullYear() === selectedYear;
    }),
    [enquetes, selectedYear, audienceState?.resultats, contentieuxId],
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
