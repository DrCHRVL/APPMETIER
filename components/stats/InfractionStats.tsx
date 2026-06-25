import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Enquete } from '@/types/interfaces';
import { useTags } from '@/hooks/useTags';
import { useAudience } from '@/hooks/useAudience';
import { useInfractionNatinf } from '@/hooks/useInfractionNatinf';
import { NatinfBadge } from '../natinf/NatinfBadge';
import { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipContent } from '../ui/tooltip';

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
    </div>
  );
};
