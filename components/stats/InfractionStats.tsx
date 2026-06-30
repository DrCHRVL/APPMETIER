import React from 'react';
import { ChevronRight } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Enquete } from '@/types/interfaces';
import { useTags } from '@/hooks/useTags';
import { useAudience } from '@/hooks/useAudience';
import { useInfractionNatinf, type EnqueteInfractionItem } from '@/hooks/useInfractionNatinf';
import { NatinfBadge } from '../natinf/NatinfBadge';
import { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipContent } from '../ui/tooltip';
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
  const { getTagsByCategory } = useTags();
  const { audienceState } = useAudience();
  const { infractionsForEnquete } = useInfractionNatinf();

  // Clé canonique d'une infraction : code NATINF si rattaché, sinon libellé.
  // Regrouper par cette clé garantit des comptes cohérents qu'un dossier soit
  // migré au NATINF (infractionNatinfCodes) ou encore en tags.
  const keyOf = (inf: { code?: string; label: string }) => inf.code ?? inf.label;

  // Infractions réellement utilisées : clé canonique → item représentatif
  // (pour l'affichage : libellé + pastille NATINF).
  const infractionReps = React.useMemo(() => {
    const map = new Map<string, ReturnType<typeof infractionsForEnquete>[number]>();
    enquetes.forEach(e => {
      infractionsForEnquete(e).forEach(inf => {
        const k = keyOf(inf);
        if (!k) return;
        const existing = map.get(k);
        // Préférer un représentant rattaché au NATINF (libellé officiel).
        if (!existing || (!existing.code && inf.code)) map.set(k, inf);
      });
    });
    return map;
  }, [enquetes, infractionsForEnquete]);

  const infractions = React.useMemo(
    () => [...infractionReps.keys()].sort((a, b) =>
      (infractionReps.get(a)?.label || a).localeCompare(infractionReps.get(b)?.label || b, 'fr')),
    [infractionReps],
  );

  // Listes d'enquêtes (mêmes critères que les agrégats par NATINF ci-dessous),
  // pour la répartition par catégorie NATAFF.
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

  // Calculer les stats pour les enquêtes EN COURS
  const infractionStatsEnCours = infractions.reduce((acc, key) => {

    if (!key) return acc;

    // Filtrer les enquêtes en cours
    // Une enquête compte si :
    // 1. Elle est en_cours
    // 2. Elle a été créée avant ou pendant l'année sélectionnée
    const enquetesFiltered = enquetes.filter(e => {
      if (e.statut !== 'en_cours') return false;

      const creationYear = new Date(e.dateCreation).getFullYear();
      // L'enquête doit avoir été créée avant ou pendant l'année sélectionnée
      if (creationYear > selectedYear) return false;

      return infractionsForEnquete(e).some(inf => keyOf(inf) === key);
    });

    if (enquetesFiltered.length > 0) {
      acc[key] = {
        count: enquetesFiltered.length,
        enquetes: enquetesFiltered
      };
    }

    return acc;
  }, {} as Record<string, { count: number; enquetes: Enquete[] }>);

  // Calculer les stats pour les enquêtes TERMINÉES
  const infractionStatsTerminees = infractions.reduce((acc, key) => {

    if (!key) return acc;

    // Filtrer les enquêtes terminées avec date d'audience de l'année sélectionnée
    // Exclure les classements sans suite et les ouvertures d'information
    const enquetesFiltered = enquetes.filter(e => {
      if (e.statut !== 'archive') return false;

      // Filtrer par contentieuxId pour éviter qu'un id d'enquête identique entre
      // contentieux ne renvoie le résultat de l'autre contentieux.
      const audienceResult = Object.values(audienceState?.resultats || {})
        .find(r => {
          if (r.enqueteId !== e.id) return false;
          if (!contentieuxId || contentieuxId === 'global') return true;
          const ctx = r.contentieuxId || 'crimorg';
          return ctx === contentieuxId;
        });

      if (!audienceResult?.dateAudience) return false;
      if (audienceResult.isClassement || audienceResult.isOI) return false;

      return new Date(audienceResult.dateAudience).getFullYear() === selectedYear &&
        infractionsForEnquete(e).some(inf => keyOf(inf) === key);
    });

    if (enquetesFiltered.length > 0) {
      acc[key] = {
        count: enquetesFiltered.length,
        enquetes: enquetesFiltered
      };
    }

    return acc;
  }, {} as Record<string, { count: number; enquetes: Enquete[] }>);

  return (
    <div className="space-y-6">
      {/* Carte Enquêtes en cours */}
      <Card>
        <CardHeader>
          <CardTitle>Répartition des enquêtes en cours par type d'infraction ({selectedYear})</CardTitle>
        </CardHeader>
        <CardContent>
          {Object.keys(infractionStatsEnCours).length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <TooltipProvider>
                {Object.entries(infractionStatsEnCours).map(([key, data]) => {
                  const rep = infractionReps.get(key);
                  return (
                  <TooltipRoot key={key} delayDuration={300}>
                    <TooltipTrigger asChild>
                      <div className="flex justify-between items-center p-2 bg-gray-50 rounded hover:bg-gray-100 cursor-help transition-colors">
                        <span className="font-medium inline-flex items-center gap-1.5">
                          {rep?.label ?? key}
                          {rep?.code ? <NatinfBadge code={rep.code} nature={rep.nature} quantumLabel={rep.quantumLabel} /> : null}
                        </span>
                        <div className="text-right">
                          <div className="text-sm">
                            <span className="font-semibold">{data.count}</span> enquête{data.count > 1 ? 's' : ''}
                          </div>
                        </div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-md max-h-96 overflow-y-auto">
                      <div className="space-y-2">
                        <p className="font-semibold mb-2">{rep?.label ?? key} - Enquêtes en cours :</p>
                        {data.enquetes.map(e => (
                          <div key={e.id} className="text-xs">
                            • {e.numero}
                          </div>
                        ))}
                      </div>
                    </TooltipContent>
                  </TooltipRoot>
                  );
                })}
              </TooltipProvider>
            </div>
          ) : (
            <div className="text-center text-gray-500 py-4">
              Aucune enquête en cours avec infraction répertoriée
            </div>
          )}
        </CardContent>
      </Card>

      {/* Carte Enquêtes terminées */}
      <Card>
        <CardHeader>
          <CardTitle>Répartition des enquêtes terminées par type d'infraction ({selectedYear})</CardTitle>
          <p className="text-sm text-gray-500">Hors classements sans suite et ouvertures d'information</p>
        </CardHeader>
        <CardContent>
          {Object.keys(infractionStatsTerminees).length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <TooltipProvider>
                {Object.entries(infractionStatsTerminees).map(([key, data]) => {
                  const rep = infractionReps.get(key);
                  return (
                  <TooltipRoot key={key} delayDuration={300}>
                    <TooltipTrigger asChild>
                      <div className="flex justify-between items-center p-2 bg-gray-50 rounded hover:bg-gray-100 cursor-help transition-colors">
                        <span className="font-medium inline-flex items-center gap-1.5">
                          {rep?.label ?? key}
                          {rep?.code ? <NatinfBadge code={rep.code} nature={rep.nature} quantumLabel={rep.quantumLabel} /> : null}
                        </span>
                        <div className="text-right">
                          <div className="text-sm">
                            <span className="font-semibold">{data.count}</span> enquête{data.count > 1 ? 's' : ''}
                          </div>
                        </div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-md max-h-96 overflow-y-auto">
                      <div className="space-y-2">
                        <p className="font-semibold mb-2">{rep?.label ?? key} - Enquêtes terminées :</p>
                        {data.enquetes.map(e => (
                          <div key={e.id} className="text-xs">
                            • {e.numero}
                          </div>
                        ))}
                      </div>
                    </TooltipContent>
                  </TooltipRoot>
                  );
                })}
              </TooltipProvider>
            </div>
          ) : (
            <div className="text-center text-gray-500 py-4">
              Aucune enquête terminée avec infraction répertoriée
            </div>
          )}
        </CardContent>
      </Card>

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
