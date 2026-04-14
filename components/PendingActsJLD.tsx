import React, { useMemo } from 'react';
import { Clock } from 'lucide-react';
import { Enquete } from '@/types/interfaces';

interface PendingActsJLDProps {
  enquetes: Enquete[];
  onOpenEnquete?: (enquete: Enquete) => void;
}

interface PendingActeItem {
  acteType: string;
  enquete: Enquete;
  daysSince: number;
  kind: 'autorisation' | 'prolongation';
}

export const PendingActsJLD = React.memo(({ enquetes, onOpenEnquete }: PendingActsJLDProps) => {
  const pendingActes = useMemo(() => {
    const now = Date.now();
    const dayMs = 1000 * 60 * 60 * 24;
    const items: PendingActeItem[] = [];

    for (const e of enquetes) {
      for (const a of e.actes || []) {
        if (a.statut === 'autorisation_pending') {
          items.push({ acteType: a.type || 'Acte', enquete: e, daysSince: Math.floor((now - new Date(a.dateDebut).getTime()) / dayMs), kind: 'autorisation' });
        } else if (a.statut === 'prolongation_pending') {
          items.push({ acteType: a.type || 'Acte', enquete: e, daysSince: Math.floor((now - new Date(a.prolongationDate || a.dateDebut).getTime()) / dayMs), kind: 'prolongation' });
        }
      }
      for (const a of e.ecoutes || []) {
        if (a.statut === 'autorisation_pending') {
          items.push({ acteType: `Écoute ${a.numero}`, enquete: e, daysSince: Math.floor((now - new Date(a.dateDebut).getTime()) / dayMs), kind: 'autorisation' });
        } else if (a.statut === 'prolongation_pending') {
          items.push({ acteType: `Écoute ${a.numero}`, enquete: e, daysSince: Math.floor((now - new Date(a.prolongationDate || a.dateDebut).getTime()) / dayMs), kind: 'prolongation' });
        }
      }
      for (const a of e.geolocalisations || []) {
        if (a.statut === 'autorisation_pending') {
          items.push({ acteType: `Géoloc ${a.objet}`, enquete: e, daysSince: Math.floor((now - new Date(a.dateDebut).getTime()) / dayMs), kind: 'autorisation' });
        } else if (a.statut === 'prolongation_pending') {
          items.push({ acteType: `Géoloc ${a.objet}`, enquete: e, daysSince: Math.floor((now - new Date(a.prolongationDate || a.dateDebut).getTime()) / dayMs), kind: 'prolongation' });
        }
      }
    }
    return items;
  }, [enquetes]);

  const totalCount = pendingActes.length;

  return (
    <div className="bg-purple-50 border border-purple-300 rounded-lg px-4 py-2 shadow-sm">
      <div className="flex flex-wrap gap-1.5 items-center">
        <Clock className="h-3.5 w-3.5 text-purple-600" />
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
          Attente JLD
        </span>

        {totalCount > 0 && (
          <span className="text-[10px] bg-purple-500 text-white px-1.5 py-0.5 rounded-full font-bold leading-none">
            {totalCount}
          </span>
        )}

        {pendingActes.map((item, idx) => (
          <div
            key={idx}
            className={`flex items-center gap-1 bg-white border border-purple-200 rounded-full px-2 py-0.5 group ${onOpenEnquete ? 'cursor-pointer hover:bg-purple-50 hover:border-purple-400 transition-colors' : ''}`}
            onClick={() => onOpenEnquete?.(item.enquete)}
            title={onOpenEnquete ? `Ouvrir l'enquête ${item.enquete.numero}` : undefined}
          >
            <span className={`text-[9px] font-semibold px-1 py-0.5 rounded leading-none ${item.kind === 'prolongation' ? 'bg-indigo-100 text-indigo-700' : 'bg-purple-100 text-purple-700'}`}>
              {item.kind === 'prolongation' ? 'Prolong.' : 'Autor.'}
            </span>
            <span className="text-[11px] text-gray-700 whitespace-nowrap select-none">
              {item.acteType}
              <span className="text-gray-400 ml-1 text-[10px]">
                ({item.enquete.numero})
              </span>
            </span>
            <span className={`text-[10px] font-semibold whitespace-nowrap ${
              item.daysSince >= 14 ? 'text-red-600' :
              item.daysSince >= 7 ? 'text-orange-600' :
              'text-purple-600'
            }`}>
              {item.daysSince}j
            </span>
          </div>
        ))}

        {totalCount === 0 && (
          <span className="text-[11px] text-gray-400 italic">Aucun acte en attente</span>
        )}
      </div>
    </div>
  );
});
