import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Enquete } from '@/types/interfaces';
import { useTags } from '@/hooks/useTags';
import { useAudience } from '@/hooks/useAudience';
import { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipContent } from '../ui/tooltip';

interface InfractionStatsProps {
  enquetes: Enquete[];
  selectedYear: number;
}

export const InfractionStats = ({ enquetes, selectedYear }: InfractionStatsProps) => {
  const { getTagsByCategory } = useTags();
  const { audienceState } = useAudience();

  // Récupérer TOUTES les infractions réellement utilisées dans les enquêtes
  const infractions = React.useMemo(() => {
    const infractionSet = new Set<string>();
    
    enquetes.forEach(e => {
      e.tags
        .filter(tag => tag.category === 'infractions')
        .forEach(tag => {
          if (tag.value) {
            infractionSet.add(tag.value);
          }
        });
    });
    
    return Array.from(infractionSet).sort();
  }, [enquetes]);

  // Calculer les stats pour les enquêtes EN COURS
  const infractionStatsEnCours = infractions.reduce((acc, infractionValue) => {
    
    if (!infractionValue) return acc;

    // Filtrer les enquêtes en cours
    // Une enquête compte si :
    // 1. Elle est en_cours
    // 2. Elle a été créée avant ou pendant l'année sélectionnée
    const enquetesFiltered = enquetes.filter(e => {
      if (e.statut !== 'en_cours') return false;
      
      const creationYear = new Date(e.dateCreation).getFullYear();
      // L'enquête doit avoir été créée avant ou pendant l'année sélectionnée
      if (creationYear > selectedYear) return false;
      
      return e.tags.some(tag => 
        tag.category === 'infractions' && 
        tag.value === infractionValue
      );
    });

    if (enquetesFiltered.length > 0) {
      acc[infractionValue] = {
        count: enquetesFiltered.length,
        enquetes: enquetesFiltered
      };
    }

    return acc;
  }, {} as Record<string, { count: number; enquetes: Enquete[] }>);

  // Calculer les stats pour les enquêtes TERMINÉES
  const infractionStatsTerminees = infractions.reduce((acc, infractionValue) => {
    
    if (!infractionValue) return acc;

    // Filtrer les enquêtes terminées avec date d'audience de l'année sélectionnée
    // Exclure les classements sans suite et les ouvertures d'information
    const enquetesFiltered = enquetes.filter(e => {
      if (e.statut !== 'archive') return false;

      const audienceResult = Object.values(audienceState?.resultats || {})
        .find(r => r.enqueteId === e.id);

      if (!audienceResult?.dateAudience) return false;
      if (audienceResult.isClassement || audienceResult.isOI) return false;

      return new Date(audienceResult.dateAudience).getFullYear() === selectedYear &&
        e.tags.some(tag =>
          tag.category === 'infractions' &&
          tag.value === infractionValue
        );
    });

    if (enquetesFiltered.length > 0) {
      acc[infractionValue] = {
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
                {Object.entries(infractionStatsEnCours).map(([infraction, data]) => (
                  <TooltipRoot key={infraction} delayDuration={300}>
                    <TooltipTrigger asChild>
                      <div className="flex justify-between items-center p-2 bg-gray-50 rounded hover:bg-gray-100 cursor-help transition-colors">
                        <span className="font-medium">{infraction}</span>
                        <div className="text-right">
                          <div className="text-sm">
                            <span className="font-semibold">{data.count}</span> enquête{data.count > 1 ? 's' : ''}
                          </div>
                        </div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-md max-h-96 overflow-y-auto">
                      <div className="space-y-2">
                        <p className="font-semibold mb-2">{infraction} - Enquêtes en cours :</p>
                        {data.enquetes.map(e => (
                          <div key={e.id} className="text-xs">
                            • {e.numero}
                          </div>
                        ))}
                      </div>
                    </TooltipContent>
                  </TooltipRoot>
                ))}
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
                {Object.entries(infractionStatsTerminees).map(([infraction, data]) => (
                  <TooltipRoot key={infraction} delayDuration={300}>
                    <TooltipTrigger asChild>
                      <div className="flex justify-between items-center p-2 bg-gray-50 rounded hover:bg-gray-100 cursor-help transition-colors">
                        <span className="font-medium">{infraction}</span>
                        <div className="text-right">
                          <div className="text-sm">
                            <span className="font-semibold">{data.count}</span> enquête{data.count > 1 ? 's' : ''}
                          </div>
                        </div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-md max-h-96 overflow-y-auto">
                      <div className="space-y-2">
                        <p className="font-semibold mb-2">{infraction} - Enquêtes terminées :</p>
                        {data.enquetes.map(e => (
                          <div key={e.id} className="text-xs">
                            • {e.numero}
                          </div>
                        ))}
                      </div>
                    </TooltipContent>
                  </TooltipRoot>
                ))}
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
